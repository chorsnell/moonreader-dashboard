import { daysBetween, round1 } from '../common/time';
import type {
  BookHistory,
  BookStatus,
  Catalogue,
  DayEntry,
  DaySource,
  ReadEntry,
} from '../backup-import/reading-history.types';
import { parseIsbn } from '../metadata/isbn';
import { bookKey as matchKey, SERIES_SUFFIX } from '../common/book-match';
import type { ImportedBook, ImportedHighlight, ImportFile, ImportSource } from './imports.types';

/** An imported read this close to one Moon+ already has is the same read. */
export const SAME_READ_DAYS = 30;

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

/** An imported highlight, tied to the book it now belongs to. */
export interface MergedHighlight extends ImportedHighlight {
  book_id: string;
  source: ImportSource;
}

export interface MergeResult {
  /** Imported books matched to one Moon+ (or an earlier import) already had. */
  matched: number;
  /** Books only the imports know about, now in the library. */
  added: number;
  /** Books on to-read shelves (or excluded in the catalogue), left out of the library. */
  skipped: number;
  highlights: MergedHighlight[];
  /** The to-read shelves' books, kept for the to-read pile (src/imports/to-read.ts). */
  toRead: ToReadImport[];
}

/** A book an import has on a to-read shelf and nothing else knows. */
export interface ToReadImport {
  source: ImportSource;
  /** The source's id for it. */
  id: string;
  title: string;
  author: string;
  series: string | null;
  series_no: number | null;
  genre: string;
  subgenre: string;
  isbn13: string | null;
  pages: number | null;
  /** When it went on the shelf (YYYY-MM-DD), when the export says. */
  added: string | null;
  shelves: string[];
}

/**
 * Adds imported books to the reading history, in place. A book matches one already there
 * by ISBN, then by title and author; it brings its rating, shelves, reading time, reads Moon+
 * didn't have, and highlights. Time from different sources on one day adds up. Books nothing else knows become books of their own (source
 * set), unless they're only on a to-read shelf.
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
    if (b.series && b.genre !== 'Untagged') {
      seriesGenres.set(b.series.toLowerCase(), [b.genre, b.subgenre]);
    }
  }
  const exclude = new Set(catalogue.exclude);
  const result: MergeResult = { matched: 0, added: 0, skipped: 0, highlights: [], toRead: [] };

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
      const suffix = SERIES_SUFFIX.exec(ib.title);
      const title = entry?.title || ib.title.replace(SERIES_SUFFIX, '');
      const author = entry ? entry.author : ib.author;
      const match =
        (isbn.isbn13 && byIsbn.get(isbn.isbn13)) ||
        byKey.get(matchKey(title, author)) ||
        byKey.get(matchKey(ib.title, ib.author));
      if (match) {
        result.matched++;
        enrich(match, ib, file.source, isbn, result.highlights);
        continue;
      }
      const status = STATUS[ib.shelf];
      const series = ib.series ?? suffix?.[1].trim() ?? null;
      const seriesNo = ib.series ? (ib.series_no ?? null) : suffix ? Number(suffix[2]) : null;
      const shelfGenre =
        (series && seriesGenres.get(series.toLowerCase())) ||
        ib.shelves.map((s) => genres.get(s.toLowerCase().replace(/[-_]+/g, ' '))).find(Boolean);
      if (!status && !ib.reads.length && !ib.daily?.length && !ib.highlights?.length) {
        result.skipped++;
        if (ib.shelf === 'to-read') {
          result.toRead.push({
            source: file.source,
            id: ib.id,
            title,
            author,
            series: entry ? (entry.series ?? null) : series,
            series_no: entry ? (entry.series_no ?? null) : seriesNo,
            genre: entry?.genre ?? shelfGenre?.[0] ?? 'Untagged',
            subgenre: entry?.subgenre ?? shelfGenre?.[1] ?? 'Untagged',
            isbn13: isbn.isbn13,
            pages: entry?.pages ?? ib.pages,
            added: ib.date_added,
            shelves: ib.shelves,
          });
        }
        continue;
      }
      let id = slug(title);
      for (let n = 2; ids.has(id); n++) id = `${slug(title)}-${n}`;
      ids.add(id);
      const book: BookHistory = {
        id,
        title,
        author,
        series: entry ? (entry.series ?? null) : series,
        series_no: entry ? (entry.series_no ?? null) : seriesNo,
        genre: entry?.genre ?? shelfGenre?.[0] ?? 'Untagged',
        subgenre: entry?.subgenre ?? shelfGenre?.[1] ?? 'Untagged',
        isbn13: isbn.isbn13,
        isbn10: isbn.isbn10,
        work_id: entry?.work_id ?? null,
        status: status ?? (ib.reads.at(-1)?.finished ? 'finished' : 'unknown'),
        progress: status === 'finished' ? 100 : (ib.progress ?? null),
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
      enrich(book, ib, file.source, isbn, result.highlights);
      books.push(book);
      index(book);
      result.added++;
    }
  }
  return result;
}

const sum = (xs: (number | null)[]) => round1(xs.reduce<number>((s, x) => s + (x ?? 0), 0));
/** Adds two figures a source may not have: null only when neither does. */
const plus = (a: number | null, b: number | null) =>
  a === null && b === null ? null : round1((a ?? 0) + (b ?? 0));
const highest = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

/**
 * Adds one source's days to a book: minutes and words are added to what other sources have for
 * the date, progress is the furthest. A rebuild starts again from each source's own data (one
 * import file per source), so nothing is counted twice.
 */
function addDays(b: BookHistory, days: DayEntry[], source: DaySource): void {
  const byDate = new Map(b.daily.map((d) => [d.date, d]));
  for (const d of days) {
    let day = byDate.get(d.date);
    if (!day) {
      day = { date: d.date, minutes: null, words: null, progress: null, by_source: {} };
      byDate.set(d.date, day);
      b.daily.push(day);
    }
    // a day no import has touched yet is Moon+'s
    day.by_source ??= { moonplus: { minutes: day.minutes, words: day.words } };
    const had = day.by_source[source];
    day.by_source[source] = {
      minutes: plus(had?.minutes ?? null, d.minutes),
      words: plus(had?.words ?? null, d.words),
    };
    day.minutes = plus(day.minutes, d.minutes);
    day.words = plus(day.words, d.words);
    day.progress = highest(day.progress, d.progress);
  }
  b.daily.sort((x, y) => (x.date < y.date ? -1 : 1));
  b.total_minutes = round1(b.total_minutes + sum(days.map((d) => d.minutes)));
  b.total_words += days.reduce((s, d) => s + (d.words ?? 0), 0);
}

/** The days a book has within a read, and their minutes. */
function within(b: BookHistory, r: ReadEntry): { days: number; minutes: number } {
  const days = b.daily.filter((d) => d.date >= r.start && d.date <= r.end);
  return { days: days.length, minutes: sum(days.map((d) => d.minutes)) };
}

/** Gives a book what an import knows: rating, shelves, ISBN, days, reads and highlights. */
function enrich(
  b: BookHistory,
  ib: ImportedBook,
  source: ImportSource,
  isbn: { isbn13: string | null; isbn10: string | null },
  highlights: MergedHighlight[],
): void {
  b.imports = { ...b.imports, [source]: ib.id };
  // when it first went on a shelf anywhere
  if (ib.date_added && (!b.added || ib.date_added < b.added)) b.added = ib.date_added;
  b.rating ??= ib.rating;
  if (ib.shelves.length) b.shelves = [...new Set([...(b.shelves ?? []), ...ib.shelves])];
  b.isbn13 ??= isbn.isbn13;
  b.isbn10 ??= isbn.isbn10;
  for (const h of ib.highlights ?? []) highlights.push({ ...h, book_id: b.id, source });

  // what each read's days came to before this import, to add only what it brings
  const before = new Map(b.reads.map((r) => [r, within(b, r)]));
  let days = ib.daily ?? [];
  // an older KOReader import may still hold copies of Moon+ days: only fill the gaps
  if (source === 'koreader' && !ib.synthetic_removed) {
    const have = new Set(b.daily.map((d) => d.date));
    days = days.filter((d) => !have.has(d.date));
  }
  const timed = !!ib.daily?.length;
  let changed = days.length > 0;
  if (days.length) addDays(b, days, source);

  const near = (r: ReadEntry, day: string) =>
    daysBetween(r.end, day) <= SAME_READ_DAYS && daysBetween(day, r.start) <= SAME_READ_DAYS;
  /** Reads this import carried at least as far as they'd got. */
  const carried = new Set<ReadEntry>();
  for (const r of ib.reads) {
    const start = r.start ?? r.end;
    // a read with no day data (Kobo without events) still has its time
    if (!timed && r.minutes) b.total_minutes = round1(b.total_minutes + r.minutes);
    const same = b.reads.find((x) => near(x, start) || near(x, r.end));
    if (same) {
      // the same read, carried on (or finished) in another app
      if (r.end >= same.end) {
        carried.add(same);
        if (r.progress != null) same.progress = highest(same.progress, r.progress);
      }
      if (start < same.start) same.start = start;
      if (r.end > same.end) same.end = r.end;
      if (r.finished === true && same.finished !== true) {
        same.finished = true;
        same.progress = 100;
      }
      if (!timed && r.minutes) same.minutes = plus(same.minutes, r.minutes);
      changed = true;
      continue;
    }
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
    changed = true;
  }
  if (changed && b.reads.length) {
    b.reads.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
    b.reads.forEach((r, i) => {
      r.read_no = i + 1;
      const now = within(b, r);
      const was = before.get(r);
      if (was) {
        if (now.days > was.days) r.days_read = now.days;
        const added = round1(now.minutes - was.minutes);
        if (added > 0) r.minutes = plus(r.minutes, added);
      } else if (now.days) {
        // a new read: its days, plus its own time when that isn't among them
        r.days_read = now.days;
        r.minutes = plus(timed ? 0 : r.minutes, now.minutes) || r.minutes;
      }
    });
    const first = [b.reads[0].start, b.daily[0]?.date ?? b.reads[0].start].sort()[0];
    const last = [...b.reads.map((r) => r.end), b.daily.at(-1)?.date ?? ''].sort().at(-1)!;
    b.first_read = b.first_read && b.first_read < first ? b.first_read : first;
    b.last_read = b.last_read && b.last_read > last ? b.last_read : last;
    // finished in another app after Moon+ last saw it
    const latest = b.reads.at(-1)!;
    if (latest.finished === true && b.status !== 'finished') {
      b.status = 'finished';
      b.progress = 100;
    } else if (
      b.status !== 'finished' &&
      ib.progress != null &&
      (latest.source === source || carried.has(latest))
    ) {
      b.progress = Math.max(b.progress ?? 0, ib.progress);
      if (b.status === 'unknown' || b.status === 'not_started') b.status = 'in_progress';
    }
  } else if (b.source && !b.reads.length && ib.highlights?.length) {
    // only highlights (Kindle clippings): their dates say when it was read
    const dates = ib.highlights.map((h) => h.time?.slice(0, 10)).filter((d): d is string => !!d);
    if (dates.length) {
      dates.sort();
      b.first_read = dates[0];
      b.last_read = dates[dates.length - 1];
    }
  }
  b.times_read = Math.max(b.reads.length, b.source ? ib.read_count : 0, b.times_read);
}
