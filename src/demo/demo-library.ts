/**
 * A library folder holding the demo's made-up history, imported exactly as on the server:
 * a catalogue.json, a fake Moon+ backup and the data/*.json the import writes from it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { BackupImportService, type ImportSummary } from '../backup-import/backup-import.service';
import type { Catalogue } from '../backup-import/reading-history.types';
import { CoverLookupService } from '../covers/cover-lookup.service';
import { parseReadingExport } from '../imports/goodreads';
import { MediaBuildService } from '../media/media-build.service';
import { servedPrices } from '../prices/prices';
import { DEFAULT_CHALLENGES } from '../challenges/challenges';
import { writeDemoBackup } from './demo-backup';
import { BOOKS, fileName, ISBN, UNOPENED } from './demo-books';
import { writeDemoFriends } from './demo-friends-site';
import { demoGoodreadsCsv } from './demo-goodreads';
import { demoKobo } from './demo-kobo';
import { anniversaryHighlight, simulateHighlights } from './demo-highlights';
import { demoMediaCatalogue, simulateAudiobookshelf, simulateNetflix } from './demo-media';
import { demoMetadata } from './demo-metadata';
import { demoPrices } from './demo-prices';
import { DemoModule } from './demo.module';
import { Random } from './random';
import { simulate, type DemoDay } from './simulate';

const DAY_MS = 86_400_000;

export interface DemoLibrary {
  log: Map<string, DemoDay[]>;
  /** The first and last simulated days, as days since 1970. */
  firstDay: number;
  lastDay: number;
  summary: ImportSummary;
}

/**
 * Writes the demo's backup into `lib` and imports it, then adds the prices the server would
 * serve and two friends. The history always ends the day before `today` (YYYY-MM-DD).
 */
export async function buildDemoLibrary(
  lib: string,
  seed: number,
  { lookUpCovers, today }: { lookUpCovers: boolean; today: string },
): Promise<DemoLibrary> {
  const { log, days } = simulate(new Random(seed));
  const highlights = simulateHighlights(log, seed);
  const yesterday = Date.parse(today) / DAY_MS - 1;
  let firstDay = yesterday - days + 1;
  firstDay -= firstDay % 7; // keep simulated weekends on real weekends (day 0 is a Thursday)
  const lastDay = firstDay + days - 1;
  // a highlight on today's date in an earlier year, for the Overview's "On this day"
  anniversaryHighlight(log, highlights, firstDay, today);
  const catalogue: Catalogue = {
    exclude: [],
    books: Object.fromEntries(
      BOOKS.map(([title, author, genre, subgenre, series, seriesNo]) => [
        fileName(title, author).toLowerCase(),
        { title, author, series, series_no: seriesNo, genre, subgenre, isbn: ISBN[title] },
      ]),
    ),
  };
  // the Kobo books' genres, set in the catalogue as the admin would for imported books
  for (const [id, title, author] of [
    ['kobo-demo-1', 'The Secret Garden', 'Frances Hodgson Burnett'],
    ['kobo-demo-2', 'The Railway Children', 'E. Nesbit'],
  ]) {
    catalogue.books[`kobo:${id}`] = { title, author, genre: 'Classics', subgenre: 'Coming of Age' };
  }
  // the files never opened are catalogued too, as the admin would have done
  for (const [title, author, genre, subgenre, series, seriesNo] of UNOPENED) {
    catalogue.books[fileName(title, author).toLowerCase()] = {
      title,
      author,
      series,
      series_no: seriesNo,
      genre,
      subgenre,
    };
  }
  await writeFile(join(lib, 'catalogue.json'), JSON.stringify(catalogue), 'utf8');
  // what the metadata lookup would find, so the demo needs no network for it
  await writeFile(join(lib, 'metadata.json'), JSON.stringify(demoMetadata()), 'utf8');
  const backup = join(lib, 'demo-library.mrpro');
  await writeDemoBackup(backup, log, firstDay, highlights, lastDay);
  // a Kobo's database, as if uploaded on the admin page: two books read on the Kobo
  const kobo = { ...demoKobo(firstDay, lastDay, seed), imported: `${today}T09:00:00` };
  await writeFile(join(lib, 'kobo.json'), JSON.stringify(kobo), 'utf8');
  // a Goodreads export, as if uploaded on the admin page: ratings and a few paper books
  const goodreads = parseReadingExport(demoGoodreadsCsv(log, firstDay, lastDay, seed));
  await writeFile(
    join(lib, 'goodreads.json'),
    JSON.stringify({
      schema_version: 1,
      source: goodreads.source,
      file: 'goodreads_library_export.csv',
      imported: `${today}T09:00:00`,
      books: goodreads.books,
    }),
    'utf8',
  );
  await writeDemoMedia(lib, seed, log, firstDay, days);
  const summary = await importInto(lib, backup, { lookUpCovers, media: true });
  // what the server writes from library/prices.json
  const prices = servedPrices(demoPrices(log, firstDay, seed));
  await writeFile(join(lib, 'data', 'prices.json'), JSON.stringify(prices));
  // the default reading challenges, as the server publishes them from settings.json
  await writeFile(join(lib, 'data', 'challenges.json'), JSON.stringify(DEFAULT_CHALLENGES));
  // two friends to compare with, as if their share files had been added
  await writeDemoFriends(lib, firstDay, lastDay);
  return { log, firstDay, lastDay, summary };
}

/**
 * TV and film, as a Netflix export of two profiles (the demo's own is "You"), with a media
 * catalogue for genres and episode counts, and a Netflix plan with a price rise halfway; and a
 * few audiobooks, as the sessions an Audiobookshelf pull would have cached.
 */
async function writeDemoMedia(
  lib: string,
  seed: number,
  log: Map<string, DemoDay[]>,
  firstDay: number,
  days: number,
): Promise<void> {
  const readingMinutes = new Map<number, number>();
  for (const entries of log.values()) {
    for (const e of entries)
      readingMinutes.set(e.day, (readingMinutes.get(e.day) ?? 0) + e.minutes);
  }
  const media = join(lib, 'media');
  await mkdir(join(media, 'inbox', 'netflix'), { recursive: true });
  await writeFile(
    join(media, 'inbox', 'netflix', 'ViewingActivity.csv'),
    simulateNetflix(seed, firstDay, days, readingMinutes),
  );
  await writeFile(join(media, 'catalogue.json'), JSON.stringify(demoMediaCatalogue(), null, 1));
  await mkdir(join(media, 'cache'), { recursive: true });
  await writeFile(
    join(media, 'cache', 'audiobookshelf.json'),
    JSON.stringify(simulateAudiobookshelf(seed, firstDay, days)),
  );
  const month = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 7);
  const half = firstDay + Math.floor(days / 2);
  const settings = {
    netflix: { profiles: ['You'] },
    subscriptions: [
      {
        service: 'Netflix',
        monthly: 10.99,
        currency: 'GBP',
        from: month(firstDay),
        to: month(half - 31),
      },
      { service: 'Netflix', monthly: 12.99, currency: 'GBP', from: month(half), to: null },
    ],
  };
  await writeFile(join(media, 'settings.json'), JSON.stringify(settings, null, 2));
}

/** Imports a backup into the library at `lib`, as a rebuild would (and the media, when asked). */
export async function importInto(
  lib: string,
  backup: string,
  { lookUpCovers, media = false }: { lookUpCovers: boolean; media?: boolean },
): Promise<ImportSummary> {
  process.env.LIBRARY = lib; // read when the app context starts
  const app = await NestFactory.createApplicationContext(DemoModule, {
    logger: ['error', 'warn'],
  });
  try {
    const summary = await app.get(BackupImportService).importBackup(backup);
    if (media) summary.lines.push(...(await app.get(MediaBuildService).build()).lines);
    if (lookUpCovers) await app.get(CoverLookupService).run();
    return summary;
  } finally {
    await app.close();
  }
}
