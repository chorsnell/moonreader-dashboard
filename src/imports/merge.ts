import { daysBetween } from '../common/time';
import type {
  BookHistory,
  BookStatus,
  Catalogue,
  ReadEntry,
} from '../backup-import/reading-history.types';
import { parseIsbn } from '../metadata/isbn';
import type { ImportedBook, ImportFile, ImportSource } from './imports.types';

/** An imported read this close to one Moon+ already has is the same read. */
export const SAME_READ_DAYS = 30;

/** "The Colour of Magic (Discworld, #1)" -> series Discworld, number 1. */
const SERIES_SUFFIX = /\s*\(([^()#]+?),?\s*#\s*([\d.]+)[^()]*\)\s*$/;

/** A title as a match key: no series suffix, subtitle, leading article or punctuation. */
export function titleKey(title: string): string {
  return title
    .replace(SERIES_SUFFIX, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .split(/[:;]/)[0]
    .toLowerCase()
    .replace(/&/g, 'and')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** An author as a match key: the surname, so "J.R.R. Tolkien" and "Tolkien, J. R. R." agree. */
export function authorKey(author: string): string {
  const a = author.split(/\s+(?:and|&)\s+|;/)[0].trim();
  const surname = a.includes(',')
    ? a.split(',')[0]
    : (a
        .replace(/,?\s+(jr|sr|ii|iii)\.?$/i, '')
        .split(/\s+/)
        .at(-1) ?? '');
  return surname
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, '');
}

const matchKey = (title: string, author: string) => `${titleKey(title)}|${authorKey(author)}`;

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'book';

const STATUS: Record<string, BookStatus> = {
  read: 'finished',
  'currently-reading': 'in_progress',
  paused: 'in_progress',
  'did-not-finish': 'unknown',
};

export interface MergeResult {
  /** Imported books matched to one Moon+ (or an earlier import) already had. */
  matched: number;
  /** Books only the imports know about, now in the library. */
  added: number;
  /** Books on to-read shelves (or excluded in the catalogue), left out. */
  skipped: number;
}

/**
 * Adds imported books to the reading history, in place. A book matches one already there
 * by ISBN, then by title and author; it brings its rating, shelves and any read that
 * doesn't overlap one already known. Books nothing else knows become books of their own
 * (source set) with reads but no days, unless they're only on a to-read shelf.
 */
export function mergeImports(
  books: BookHistory[],
  imports: ImportFile[],
  catalogue: Catalogue,
): MergeResult {
  const byIsbn = new Map<string, BookHistory>();
  const byKey = new Map<string, BookHistory>();
  const ids = new Set(books.map((b) => b.id));
  const index = (b: BookHistory) => {
    if (b.isbn13 && !byIsbn.has(b.isbn13)) byIsbn.set(b.isbn13, b);
    const k = matchKey(b.title, b.author);
    if (!byKey.has(k)) byKey.set(k, b);
  };
  books.forEach(index);
  // genres the library already uses, so a shelf called "science-fiction" can give one
  const genres = new Map<string, [string, string]>();
  for (const b of books) {
    if (b.genre === 'Untagged') continue;
    genres.set(b.genre.toLowerCase(), [b.genre, 'Untagged']);
  }
  for (const b of books) {
    if (b.subgenre !== 'Untagged' && !genres.has(b.subgenre.toLowerCase())) {
      genres.set(b.subgenre.toLowerCase(), [b.genre, b.subgenre]);
    }
  }
  // and a book in a series the library has takes that series' genre
  const seriesGenres = new Map<string, [string, string]>();
  for (const b of books) {
    if (b.series && b.genre !== 'Untagged')
      seriesGenres.set(b.series.toLowerCase(), [b.genre, b.subgenre]);
  }
  const exclude = new Set(catalogue.exclude);
  const result: MergeResult = { matched: 0, added: 0, skipped: 0 };

  for (const file of imports) {
    for (const ib of file.books) {
      const pseudo = `${file.source}:${ib.id}`.toLowerCase();
      if (exclude.has(pseudo)) {
        result.skipped++;
        continue;
      }
      const entry = catalogue.books[pseudo];
      const isbn = parseIsbn(entry?.isbn13 ?? entry?.isbn ?? entry?.isbn10) ?? {
        isbn13: ib.isbn13,
        isbn10: ib.isbn10,
      };
      const series = SERIES_SUFFIX.exec(ib.title);
      const title = entry?.title || ib.title.replace(SERIES_SUFFIX, '');
      const author = entry ? entry.author : ib.author;
      const match =
        (isbn.isbn13 && byIsbn.get(isbn.isbn13)) ||
        byKey.get(matchKey(title, author)) ||
        byKey.get(matchKey(ib.title, ib.author));
      if (match) {
        result.matched++;
        enrich(match, ib, file.source, isbn);
        continue;
      }
      const status = STATUS[ib.shelf];
      if (!status && !ib.reads.length) {
        result.skipped++;
        continue;
      }
      const shelfGenre =
        (series && seriesGenres.get(series[1].trim().toLowerCase())) ||
        ib.shelves.map((s) => genres.get(s.toLowerCase().replace(/[-_]+/g, ' '))).find(Boolean);
      let id = slug(title);
      for (let n = 2; ids.has(id); n++) id = `${slug(title)}-${n}`;
      ids.add(id);
      const book: BookHistory = {
        id,
        title,
        author,
        series: entry ? (entry.series ?? null) : (series?.[1].trim() ?? null),
        series_no: entry ? (entry.series_no ?? null) : series ? Number(series[2]) : null,
        genre: entry?.genre ?? shelfGenre?.[0] ?? 'Untagged',
        subgenre: entry?.subgenre ?? shelfGenre?.[1] ?? 'Untagged',
        isbn13: isbn.isbn13,
        isbn10: isbn.isbn10,
        work_id: entry?.work_id ?? null,
        status: status ?? (ib.reads.at(-1)?.finished ? 'finished' : 'unknown'),
        progress: status === 'finished' ? 100 : null,
        total_minutes: 0,
        total_words: 0,
        times_read: 0,
        first_read: null,
        last_read: null,
        reads: [],
        daily: [],
        synced: null,
        source_files: [`${file.source}:${ib.id}`],
        source: file.source,
        rating: null,
        shelves: [],
      };
      enrich(book, ib, file.source, isbn);
      books.push(book);
      index(book);
      result.added++;
    }
  }
  return result;
}

/** Gives a book what an import knows: rating, shelves, ISBN and reads it didn't have. */
function enrich(
  b: BookHistory,
  ib: ImportedBook,
  source: ImportSource,
  isbn: { isbn13: string | null; isbn10: string | null },
): void {
  b.imports = { ...b.imports, [source]: ib.id };
  b.rating ??= ib.rating;
  if (ib.shelves.length) b.shelves = [...new Set([...(b.shelves ?? []), ...ib.shelves])];
  b.isbn13 ??= isbn.isbn13;
  b.isbn10 ??= isbn.isbn10;

  const near = (r: ReadEntry, day: string) =>
    daysBetween(r.end, day) <= SAME_READ_DAYS && daysBetween(day, r.start) <= SAME_READ_DAYS;
  let added = false;
  for (const r of ib.reads) {
    const start = r.start ?? r.end;
    if (b.reads.some((x) => near(x, start) || near(x, r.end))) continue;
    b.reads.push({
      read_no: 0,
      start,
      end: r.end,
      days_read: 0,
      minutes: r.minutes ?? null,
      progress: r.progress ?? (r.finished ? 100 : null),
      finished: r.finished,
      source,
    });
    added = true;
  }
  if (added) {
    b.reads.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
    b.reads.forEach((r, i) => (r.read_no = i + 1));
    const first = b.reads[0].start;
    const last = b.reads.reduce((m, r) => (r.end > m ? r.end : m), '');
    b.first_read = b.first_read && b.first_read < first ? b.first_read : first;
    b.last_read = b.last_read && b.last_read > last ? b.last_read : last;
    // a book Moon+ hasn't seen finished, finished elsewhere later on
    const latest = b.reads.at(-1)!;
    if (latest.source && latest.finished && b.status !== 'finished') {
      b.status = 'finished';
      b.progress = 100;
    }
  }
  b.times_read = Math.max(b.reads.length, b.source ? ib.read_count : 0, b.times_read);
}
