/**
 * Builds the static demo site: a made-up reading history of public-domain classics, run
 * through the real backup import, with the page from web/.
 *
 *   npm run demo -- [OUT_DIR]        # default: ./site
 *
 * It writes a fake Moon+ backup, turns it into data/*.json, looks up covers on Open Library
 * (skipped with COVER_LOOKUP=off), and adds static stand-ins for /api/config and /api/covers
 * so the page works on any static host, such as GitHub Pages. The history always ends
 * yesterday, so "this year" is never empty. DEMO_SEED picks another made-up history, and
 * DEMO_TODAY=YYYY-MM-DD builds it as if run on that day (for repeatable screenshots).
 */
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { exists } from '../common/files';
import { localDate } from '../common/time';
import { BackupImportService } from '../backup-import/backup-import.service';
import type { Catalogue } from '../backup-import/reading-history.types';
import { CoverLookupService } from '../covers/cover-lookup.service';
import { WEB_DIR } from '../paths';
import { withFeatures } from '../web/features';
import { writeDemoBackup } from './demo-backup';
import { simulateHighlights } from './demo-highlights';
import { DemoModule } from './demo.module';
import { BOOKS, fileName, ISBN } from './demo-books';
import { Random } from './random';
import { simulate } from './simulate';

const DAY_MS = 86_400_000;

async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? 'site');
  const seed = Number(process.env.DEMO_SEED ?? 7);
  const { log, days } = simulate(new Random(seed));
  const highlights = simulateHighlights(log, seed);
  const today = process.env.DEMO_TODAY || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(Date.parse(today))) {
    throw new Error(`DEMO_TODAY must be a date as YYYY-MM-DD, not ${today}`);
  }
  const yesterday = Date.parse(today) / DAY_MS - 1;
  let firstDay = yesterday - days + 1;
  firstDay -= firstDay % 7; // keep simulated weekends on real weekends (day 0 is a Thursday)
  const lastDay = firstDay + days - 1;

  // a library of our own, so the import runs exactly as on the server
  const lib = await mkdtemp(join(tmpdir(), 'demo-library-'));
  try {
    const covers = join(lib, 'covers');
    if (await exists(join(out, 'covers'))) {
      await cp(join(out, 'covers'), covers, { recursive: true }); // the lookup is slow: keep them
    }
    const catalogue: Catalogue = {
      exclude: [],
      books: Object.fromEntries(
        BOOKS.map(([title, author, genre, subgenre, series, seriesNo]) => [
          fileName(title, author).toLowerCase(),
          { title, author, series, series_no: seriesNo, genre, subgenre, isbn: ISBN[title] },
        ]),
      ),
    };
    await writeFile(join(lib, 'catalogue.json'), JSON.stringify(catalogue), 'utf8');
    const backup = join(lib, 'demo-library.mrpro');
    await writeDemoBackup(backup, log, firstDay, highlights);

    process.env.LIBRARY = lib; // read when the app context starts
    const app = await NestFactory.createApplicationContext(DemoModule, {
      logger: ['error', 'warn'],
    });
    try {
      const summary = await app.get(BackupImportService).importBackup(backup);
      summary.lines.forEach((line) => console.log(line));
      await app.get(CoverLookupService).run();
    } finally {
      await app.close();
    }

    await rm(out, { recursive: true, force: true });
    await cp(WEB_DIR, out, { recursive: true });
    const page = await readFile(join(out, 'index.html'), 'utf8');
    await writeFile(join(out, 'index.html'), await withFeatures(page, WEB_DIR));
    await cp(join(lib, 'data'), join(out, 'data'), { recursive: true });
    await mkdir(join(out, 'covers'), { recursive: true });
    const coverUrls: Record<string, string> = {};
    for (const f of (await readdir(covers)).sort()) {
      const m = /^(.+)\.(jpg|png)$/.exec(f);
      if (!m) continue; // dot files such as .misses.json stay behind
      await cp(join(covers, f), join(out, 'covers', f));
      coverUrls[m[1]] = `covers/${f}`;
    }

    // static stand-ins for the server's JSON endpoints
    const meta: unknown = JSON.parse(await readFile(join(out, 'data', 'meta.json'), 'utf8'));
    await mkdir(join(out, 'api'), { recursive: true });
    await writeFile(
      join(out, 'api', 'config'),
      JSON.stringify({ uploads: false, webdav: false, has_data: true, demo: true, meta }),
    );
    await writeFile(join(out, 'api', 'covers'), JSON.stringify(coverUrls));
    await writeFile(join(out, '.nojekyll'), '');
    const iso = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);
    console.log(
      `Demo site in ${out}: ${log.size} books, ${Object.keys(coverUrls).length} covers, ` +
        `${iso(firstDay)} to ${iso(lastDay)}`,
    );
  } finally {
    await rm(lib, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
