import { parseIsbn } from '../metadata/isbn';
import { csvRecords, toCsv } from './csv';
import type { ImportedBook, ImportedRead, ImportSource } from './imports.types';

/** The status shelves; every other shelf or tag is the reader's own. */
const STATUS_SHELVES = new Set([
  'read',
  'currently-reading',
  'to-read',
  'did-not-finish',
  'paused',
]);

/** "2021/03/14" or "2021-03-14" as 2021-03-14; anything else is null. */
export function exportDate(raw: string | undefined): string | null {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec((raw ?? '').trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(date)) ? null : date;
}

/** Goodreads writes ISBNs as ="0141439513" so spreadsheets keep the leading zero. */
const unwrap = (s: string | undefined) => (s ?? '').replace(/^="?/, '').replace(/"$/, '').trim();

const number = (s: string | undefined) => {
  const n = Number((s ?? '').trim());
  return (s ?? '').trim() && Number.isFinite(n) ? n : null;
};

const shelfList = (s: string | undefined) =>
  [
    ...new Set(
      (s ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].filter((x) => !STATUS_SHELVES.has(x.toLowerCase()));

function isbns(...raw: (string | undefined)[]) {
  for (const r of raw) {
    const p = parseIsbn(unwrap(r));
    if (p) return p;
  }
  return { isbn13: null, isbn10: null };
}

function goodreadsBook(r: Record<string, string>): ImportedBook | null {
  const title = r['Title'] ?? '';
  if (!title) return null;
  const shelf = (r['Exclusive Shelf'] || 'read').toLowerCase();
  const dateRead = exportDate(r['Date Read']);
  const rating = number(r['My Rating']);
  // the export only has the latest read's end; a book on the read shelf with no date
  // is still finished, just at an unknown time
  const reads: ImportedRead[] = dateRead ? [{ start: null, end: dateRead, finished: true }] : [];
  return {
    id: r['Book Id'] || title,
    title,
    author: r['Author'] ?? '',
    ...isbns(r['ISBN13'], r['ISBN']),
    rating: rating && rating > 0 ? rating : null,
    shelves: shelfList(r['Bookshelves']),
    shelf,
    read_count: Math.max(number(r['Read Count']) ?? 0, shelf === 'read' ? 1 : 0),
    date_added: exportDate(r['Date Added']),
    pages: number(r['Number of Pages']),
    reads,
  };
}

/** StoryGraph's "Dates Read": "2023/01/05-2023/01/20, 2024/02/01-2024/02/09" (start optional). */
function storyGraphReads(raw: string, last: string | null, status: string): ImportedRead[] {
  const reads: ImportedRead[] = [];
  for (const part of raw.split(/,\s*/)) {
    const days = [...part.matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g)].map((m) => exportDate(m[0]));
    const end = days.at(-1);
    if (end) reads.push({ start: days.length > 1 ? days[0] : null, end, finished: true });
  }
  if (!reads.length && last) reads.push({ start: null, end: last, finished: true });
  // the newest read of a book not finished isn't finished either
  if (status !== 'read' && reads.length) reads[reads.length - 1].finished = false;
  return reads.sort((a, b) => (a.end < b.end ? -1 : 1));
}

function storyGraphBook(r: Record<string, string>): ImportedBook | null {
  const title = r['Title'] ?? '';
  if (!title) return null;
  const shelf = (r['Read Status'] || 'read').toLowerCase();
  const rating = number(r['Star Rating']);
  const reads = storyGraphReads(r['Dates Read'] ?? '', exportDate(r['Last Date Read']), shelf);
  return {
    id: r['ISBN/UID'] || title,
    title,
    // "Authors" may list several; the first is the author
    author: (r['Authors'] ?? '').split(',')[0].trim(),
    ...isbns(r['ISBN/UID']),
    rating: rating && rating > 0 ? rating : null,
    shelves: shelfList(r['Tags']),
    shelf,
    read_count: Math.max(number(r['Read Count']) ?? 0, reads.filter((x) => x.finished).length),
    date_added: exportDate(r['Date Added']),
    pages: null,
    reads,
  };
}

/**
 * Reads a Goodreads library export or a StoryGraph export (told apart by their columns).
 * Throws when the file is neither.
 */
export function parseReadingExport(text: string): { source: ImportSource; books: ImportedBook[] } {
  const { header, records } = csvRecords(text);
  const has = (...names: string[]) => names.every((n) => header.includes(n));
  if (has('Book Id', 'Title', 'Author', 'Exclusive Shelf')) {
    return { source: 'goodreads', books: records.map(goodreadsBook).filter((b) => b !== null) };
  }
  if (has('Title', 'Authors', 'Read Status')) {
    return { source: 'storygraph', books: records.map(storyGraphBook).filter((b) => b !== null) };
  }
  throw new Error(
    "That isn't a Goodreads or StoryGraph export. Goodreads: My Books → Import and export → Export library.",
  );
}

/** A book and its finished reads, as the export to Goodreads needs them. */
export interface FinishedBook {
  title: string;
  author: string;
  isbn10: string | null;
  isbn13: string | null;
  rating: number | null;
  shelves: string[];
  /** YYYY-MM-DD of each finished read, oldest first. */
  finished: string[];
  first_read: string | null;
}

const slashDate = (d: string | null) => (d ? d.replace(/-/g, '/') : '');

/** Finished books as a CSV in Goodreads' own export layout, which its import reads back. */
export function goodreadsCsv(books: FinishedBook[]): string {
  return toCsv(
    [
      'Title',
      'Author',
      'ISBN',
      'ISBN13',
      'My Rating',
      'Date Read',
      'Date Added',
      'Bookshelves',
      'Exclusive Shelf',
      'Read Count',
    ],
    books.map((b) => [
      b.title,
      b.author,
      b.isbn10 ? `="${b.isbn10}"` : '',
      b.isbn13 ? `="${b.isbn13}"` : '',
      b.rating ? Math.round(b.rating) : 0,
      slashDate(b.finished.at(-1) ?? null),
      slashDate(b.first_read),
      b.shelves.join(', '),
      'read',
      Math.max(1, b.finished.length),
    ]),
  );
}
