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
 * MIXPANEL_TOKEN (and MIXPANEL_API_HOST) turn on the page's analytics, as on the server.
 * DEMO_URL (the site's public address) makes the link preview tags absolute, as most sites
 * that show previews need.
 */
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exists } from '../common/files';
import { localDate } from '../common/time';
import { WEB_DIR } from '../paths';
import { loadPageCalcs } from '../stats/page-sandbox';
import { bundleJson, computeStats, readInputs } from '../stats/stats';
import { collage } from '../share/collage';
import { shareCard, shareTags, withShareTags } from '../share/share-card';
import { withFeatures } from '../web/features';
import { writeStaticClubs, writeStaticFriends } from './demo-friends-site';
import { buildDemoLibrary } from './demo-library';

const DAY_MS = 86_400_000;

/** The same `analytics` block /api/config gives when MIXPANEL_TOKEN is set. */
function analytics() {
  const token = process.env.MIXPANEL_TOKEN?.trim();
  const host = process.env.MIXPANEL_API_HOST?.trim().replace(/\/+$/, '');
  return token
    ? { analytics: { mixpanel_token: token, api_host: host || 'https://api-js.mixpanel.com' } }
    : {};
}

async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? 'site');
  const seed = Number(process.env.DEMO_SEED ?? 7);
  const today = process.env.DEMO_TODAY || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(Date.parse(today))) {
    throw new Error(`DEMO_TODAY must be a date as YYYY-MM-DD, not ${today}`);
  }

  // a library of our own, so the import runs exactly as on the server
  const lib = await mkdtemp(join(tmpdir(), 'demo-library-'));
  try {
    const covers = join(lib, 'covers');
    if (await exists(join(out, 'covers'))) {
      await cp(join(out, 'covers'), covers, { recursive: true }); // the lookup is slow: keep them
    }
    const { log, firstDay, lastDay, summary } = await buildDemoLibrary(lib, seed, {
      lookUpCovers: true,
      today,
    });
    summary.lines.forEach((line) => console.log(line));

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
      JSON.stringify({
        uploads: false,
        webdav: false,
        has_data: true,
        has_books: true,
        has_media: true,
        demo: true,
        meta,
        ...analytics(),
      }),
    );
    await writeFile(join(out, 'api', 'covers'), JSON.stringify(coverUrls));
    // the stats the server would work out, so the demo page takes the same path
    const pageCalcs = await loadPageCalcs(WEB_DIR);
    const stats = computeStats(
      pageCalcs,
      await readInputs(join(out, 'data'), pageCalcs.files, null),
    );
    const generated = (meta as { generated?: string }).generated ?? null;
    const version = createHash('sha256')
      .update(JSON.stringify(stats.rows))
      .digest('base64url')
      .slice(0, 22);
    await mkdir(join(out, 'api', 'stats'), { recursive: true });
    const bundle = (ids?: string[]) => bundleJson(version, generated, stats.rows, ids);
    await writeFile(join(out, 'api', 'stats', 'all'), bundle());
    await writeFile(join(out, 'api', 'stats', 'page'), bundle(stats.page));
    for (const [id, value] of Object.entries(stats.rows)) {
      await writeFile(join(out, 'api', 'stats', id), JSON.stringify(value));
    }
    await writeShareCard(out, coverUrls, stats.rows.as_of);
    const friends = await writeStaticFriends(lib, out);
    await writeStaticClubs(lib, out);
    await writeFile(join(out, '.nojekyll'), '');
    const iso = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);
    console.log(
      `Demo site in ${out}: ${log.size} books, ${Object.keys(coverUrls).length} covers, ` +
        `${Object.keys(stats.rows).length} calcs worked out ahead (${stats.page.length} for the page), ` +
        `${iso(firstDay)} to ${iso(lastDay)}, friends ${friends.join(', ')}`,
    );
  } finally {
    await rm(lib, { recursive: true, force: true });
  }
}

/** The link preview: tags in index.html and the collage beside it, as the server makes them. */
async function writeShareCard(
  out: string,
  coverUrls: Record<string, string>,
  asOfRows: unknown,
): Promise<void> {
  const read = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(join(out, 'data', name), 'utf8'));
  const asOf = (asOfRows as { date?: string }[] | undefined)?.[0]?.date ?? null;
  const card = shareCard(await read('books.json'), await read('reads.json'), asOf);
  const files = card.coverIds.flatMap((id) => (coverUrls[id] ? [coverUrls[id]] : [])).slice(0, 32);
  const jpeg = collage(await Promise.all(files.map((f) => readFile(join(out, f)))));
  if (jpeg) await writeFile(join(out, 'share.jpg'), jpeg);
  const site = process.env.DEMO_URL?.trim().replace(/\/+$/, '');
  const url = site ? `${site}/` : null;
  const image = jpeg ? `${url ?? ''}share.jpg` : null;
  const page = await readFile(join(out, 'index.html'), 'utf8');
  const tags = shareTags({ title: card.title, description: card.description, url, image });
  await writeFile(join(out, 'index.html'), withShareTags(page, tags));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
