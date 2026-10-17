/**
 * A library folder holding the demo's made-up history, imported exactly as on the server:
 * a catalogue.json, a fake Moon+ backup and the data/*.json the import writes from it.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { BackupImportService, type ImportSummary } from '../backup-import/backup-import.service';
import type { Catalogue } from '../backup-import/reading-history.types';
import { CoverLookupService } from '../covers/cover-lookup.service';
import { parseReadingExport } from '../imports/goodreads';
import { servedPrices } from '../prices/prices';
import { writeDemoBackup } from './demo-backup';
import { BOOKS, fileName, ISBN } from './demo-books';
import { demoGoodreadsCsv } from './demo-goodreads';
import { simulateHighlights } from './demo-highlights';
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
 * serve. The history always ends the day before `today` (YYYY-MM-DD).
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
  // what the metadata lookup would find, so the demo needs no network for it
  await writeFile(join(lib, 'metadata.json'), JSON.stringify(demoMetadata()), 'utf8');
  const backup = join(lib, 'demo-library.mrpro');
  await writeDemoBackup(backup, log, firstDay, highlights);
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
  const summary = await importInto(lib, backup, { lookUpCovers });
  // what the server writes from library/prices.json
  const prices = servedPrices(demoPrices(log, firstDay, seed));
  await writeFile(join(lib, 'data', 'prices.json'), JSON.stringify(prices));
  return { log, firstDay, lastDay, summary };
}

/** Imports a backup into the library at `lib`, as a rebuild would. */
export async function importInto(
  lib: string,
  backup: string,
  { lookUpCovers }: { lookUpCovers: boolean },
): Promise<ImportSummary> {
  process.env.LIBRARY = lib; // read when the app context starts
  const app = await NestFactory.createApplicationContext(DemoModule, {
    logger: ['error', 'warn'],
  });
  try {
    const summary = await app.get(BackupImportService).importBackup(backup);
    if (lookUpCovers) await app.get(CoverLookupService).run();
    return summary;
  } finally {
    await app.close();
  }
}
