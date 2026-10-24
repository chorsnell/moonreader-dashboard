import { open, readFile } from 'node:fs/promises';
import { csvRecords } from './csv';
import { parseReadingExport } from './goodreads';
import type { ImportedBook, ImportSource } from './imports.types';
import {
  ASIN,
  parseClippings,
  parseKindleSessions,
  parseKindleTitles,
  SESSION_MILLIS,
  SESSION_START,
} from './kindle';
import { readKobo, SQLITE_MAGIC } from './kobo';
import { isKoreaderDb, readKoreader } from './koreader';

/** Text exports are small; a Kobo or KOReader database can be large. */
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;

export type Detected =
  | { kind: 'books'; source: ImportSource; books: ImportedBook[] }
  | { kind: 'titles'; titles: Map<string, { title: string; author: string }> };

const UNKNOWN =
  "That file isn't one the dashboard can import. It takes a Goodreads or StoryGraph export (.csv), a Kobo's KoboReader.sqlite, KOReader's statistics.sqlite3, a Kindle's My Clippings.txt, or Amazon's Kindle reading sessions (.csv).";

/**
 * Works out what an uploaded file is from its contents, not its name, and reads it:
 * a Kobo or KOReader database, Kindle clippings, Kindle reading sessions or a list of Kindle titles,
 * or a Goodreads / StoryGraph export.
 */
export async function detectUpload(
  path: string,
  titles: Map<string, { title: string; author: string }> = new Map(),
): Promise<Detected> {
  const head = Buffer.alloc(16);
  const fh = await open(path, 'r');
  try {
    await fh.read(head, 0, 16, 0);
  } finally {
    await fh.close();
  }
  if (head.toString('latin1') === SQLITE_MAGIC) {
    if (isKoreaderDb(path)) {
      return { kind: 'books', source: 'koreader', books: readKoreader(path) };
    }
    return { kind: 'books', source: 'kobo', books: readKobo(path) };
  }
  const buf = await readFile(path);
  if (buf.length > MAX_TEXT_BYTES) throw new Error('That file is too large (20 MB at most).');
  const text = buf.toString('utf8');
  if (/^==========\s*$/m.test(text) && /Your (Highlight|Note|Bookmark)/i.test(text)) {
    return { kind: 'books', source: 'kindle_clippings', books: parseClippings(text) };
  }
  const { header, records } = csvRecords(text);
  const has = (names: string[]) => names.some((n) => header.includes(n));
  if (has(ASIN) && has(SESSION_START) && has(SESSION_MILLIS)) {
    return { kind: 'books', source: 'kindle', books: parseKindleSessions(records, titles) };
  }
  if (has(ASIN) && has(['Title', 'title', 'Product Name', 'product_name', 'ProductName'])) {
    return { kind: 'titles', titles: parseKindleTitles(records) };
  }
  try {
    return { kind: 'books', ...parseReadingExport(text) };
  } catch {
    throw new Error(UNKNOWN);
  }
}
