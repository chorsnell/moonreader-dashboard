import { posix } from 'node:path';
import { dateFromEpochDays, daysBetween, localDateTime, round1 } from '../common/time';
import type {
  BookHistory,
  BookStatus,
  CatalogueEntry,
  DayEntry,
  HistoryInput,
  HistoryResult,
  ReadEntry,
  SyncedPositionFile,
} from './reading-history.types';

// The rules. Change them here; every chart's own calculation is in web/calcs.js.
/** A return to a book after this many days starts a new read. */
export const GAP_DAYS = 365;
/** Progress (%) that counts as finished. */
export const FINISHED = 99.0;

const EPOCH = '1970-01-01';
/** "<ms timestamp>*<chapter>@<split>#<position>:<percent>%", the timestamp being optional. */
const POSITION = /(?:(\d{10,13})\*)?\d+@\d+#\d+:([\d.]+)%/;
const DAY_TOKEN = /^(\d+)(?:\|(\d+)(?:@(\d+))?)?$/;

/** Moon+ paths are Android paths, whatever the server runs on. */
const basename = (p: string) => posix.basename(p);
const stem = (p: string) => p.slice(0, p.length - posix.extname(p).length);

/** The last position a copy of the book reached, and whether the reading log covers that day. */
interface Final {
  day: string;
  progress: number;
  logged: boolean;
}

interface Sync {
  date: string;
  time: string;
  progress: number;
}

interface WorkingBook {
  info: Required<CatalogueEntry>;
  files: Set<string>;
  days: Map<string, DayEntry>;
  ms: number;
  words: number;
  finals: Final[];
  sync?: Sync;
}

/** A readable title from a book's file name, with the usual download-site junk removed. */
export function titleFromFileName(fileName: string): string {
  return stem(basename(fileName))
    .replace(/\s*--\s*[0-9a-f]{32}.*$/, '')
    .replace(/\s*-\s*libgen\.li$/, '')
    .replace(/\s*z-lib\.org$/, '')
    .replace(/\((BookSee|Booksee)\.(org|Org)\)/g, '')
    .replace(/_/g, ' ')
    .trim();
}

/** Like Python's str.title(): capitalise the first letter of every word. */
function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, before: string, letter: string) => {
    return before + letter.toUpperCase();
  });
}

/** Python-style float parsing: an empty or malformed string is null, not 0. */
function parseNumber(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** Orders finals like Python tuples: by day, then progress, then logged. */
function compareFinals(a: Final, b: Final): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.progress !== b.progress) return a.progress - b.progress;
  return Number(a.logged) - Number(b.logged);
}

/** Splits a book's reading days into reads, separated by gaps of GAP_DAYS or more. */
function splitIntoReads(days: DayEntry[]): DayEntry[][] {
  let reads: DayEntry[][] = [];
  for (const d of days) {
    const last = reads.at(-1);
    if (!last || daysBetween(last[last.length - 1].date, d.date) >= GAP_DAYS) reads.push([]);
    reads[reads.length - 1].push(d);
  }
  // a lone day of reading only counts as its own read if nothing longer exists
  if (reads.some((r) => r.length > 1)) reads = reads.filter((r) => r.length > 1);
  else if (reads.length > 1) reads = [reads.flat()];
  return reads;
}

/**
 * Turns what Moon+ recorded (its statistics table, last positions and synced positions)
 * into a reading history: every book, every read of it and every day it was read.
 */
export function buildReadingHistory(input: HistoryInput): HistoryResult {
  const known = input.catalogue.books;
  const exclude = new Set(input.catalogue.exclude);
  const untagged = new Set<string>();
  const books = new Map<string, WorkingBook>();
  const byFile = new Map<string, WorkingBook>();

  const identify = (path: string): Required<CatalogueEntry> | null => {
    const base = basename(path).toLowerCase();
    if (!path || exclude.has(base)) return null;
    const entry = known[base];
    if (entry) {
      return {
        title: entry.title ?? '',
        author: entry.author ?? '',
        series: entry.series ?? null,
        series_no: entry.series_no ?? null,
        genre: entry.genre ?? 'Untagged',
        subgenre: entry.subgenre ?? 'Untagged',
      };
    }
    let [title, author] = input.bookMeta.get(path.toLowerCase()) ?? ['', ''];
    if (!title) {
      title = titleFromFileName(path);
      if (!/\p{Lu}/u.test(title)) title = titleCase(title);
    }
    untagged.add(`${base}  ->  ${title}`);
    return {
      title,
      author,
      series: null,
      series_no: null,
      genre: 'Untagged',
      subgenre: 'Untagged',
    };
  };

  const bookFor = (path: string): WorkingBook | null => {
    const info = identify(path);
    if (!info) return null;
    const key = `${info.title}|${info.author}`.toLowerCase();
    let book = books.get(key);
    if (!book) {
      book = { info, files: new Set(), days: new Map(), ms: 0, words: 0, finals: [] };
      books.set(key, book);
    }
    book.files.add(basename(path));
    byFile.set(basename(path).toLowerCase(), book);
    return book;
  };

  // the reading log: one line of day tokens per book file
  for (const row of input.statistics) {
    const path = row.filename ?? '';
    const book = bookFor(path);
    if (!book) continue;
    book.ms += row.usedTime ?? 0;
    book.words += row.readWords ?? 0;
    let last: DayEntry | null = null;
    let fileLast: string | null = null;
    for (const tok of (row.dates ?? '').split(/\s+/).filter(Boolean)) {
      if (tok.startsWith('#')) {
        const p = parseNumber(tok.slice(1).replace(/%+$/, ''));
        if (p !== null && last) last.progress = p;
        continue;
      }
      const m = DAY_TOKEN.exec(tok);
      if (!m) continue;
      const date = dateFromEpochDays(Number(m[1]));
      let d = book.days.get(date);
      if (!d) {
        d = { date, minutes: null, words: null, progress: null };
        book.days.set(date, d);
      }
      if (m[2]) d.minutes = round1((d.minutes ?? 0) + Number(m[2]) / 60000);
      if (m[3]) d.words = (d.words ?? 0) + Number(m[3]);
      last = d;
      fileLast = date;
    }
    const p = input.positions.get(path.toLowerCase());
    if (p !== undefined) {
      book.finals.push({ day: fileLast ?? EPOCH, progress: p, logged: fileLast !== null });
    }
  }

  // books with a position but no reading log
  const statPaths = new Set(input.statistics.map((r) => (r.filename ?? '').toLowerCase()));
  for (const [path, p] of input.positions) {
    if (statPaths.has(path) || p <= 0) continue;
    bookFor(path)?.finals.push({ day: EPOCH, progress: p, logged: false });
  }

  const { applied: syncedApplied, unreadable: unreadableSyncs } = applySyncedPositions(
    input.synced,
    byFile,
    bookFor,
  );

  const out: BookHistory[] = [];
  for (const b of books.values()) {
    const history = toHistory(b);
    if (history) out.push(history);
  }
  out.sort((a, b) =>
    (b.last_read ?? '') > (a.last_read ?? '')
      ? 1
      : (b.last_read ?? '') < (a.last_read ?? '')
        ? -1
        : 0,
  );
  const seen = new Map<string, number>();
  for (const b of out) {
    const n = (seen.get(b.id) ?? 0) + 1;
    seen.set(b.id, n);
    if (n > 1) b.id += `-${n}`;
  }
  return { books: out, untagged: [...untagged].sort(), syncedApplied, unreadableSyncs };
}

/**
 * Attaches the newest position from the .po files Moon+ syncs over WebDAV to each book.
 * Returns how many were applied, and the files that weren't understood.
 */
function applySyncedPositions(
  files: SyncedPositionFile[],
  byFile: Map<string, WorkingBook>,
  bookFor: (path: string) => WorkingBook | null,
): { applied: number; unreadable: string[] } {
  const stems = new Map<string, WorkingBook>();
  for (const [name, b] of byFile) if (!stems.has(stem(name))) stems.set(stem(name), b);
  let applied = 0;
  const unreadable: string[] = [];
  for (const file of files) {
    const m = POSITION.exec(file.text);
    if (!m) {
      unreadable.push(`${file.name}: ${JSON.stringify(file.text.trim().slice(0, 60))}`);
      continue;
    }
    const ms = m[1] ? Number(m[1]) * (m[1].length === 13 ? 1 : 1000) : file.mtimeMs;
    const when = new Date(ms);
    const bookFile = file.name.slice(0, -3);
    const name = bookFile.toLowerCase();
    const b = byFile.get(name) ?? stems.get(name) ?? stems.get(stem(name)) ?? bookFor(bookFile);
    if (!b) continue;
    if (!b.sync || localDateTime(when) > b.sync.time) {
      b.sync = {
        date: localDateTime(when).slice(0, 10),
        time: localDateTime(when, 'minutes'),
        progress: Number(m[2]),
      };
      applied++;
    }
  }
  return { applied, unreadable };
}

function toHistory(b: WorkingBook): BookHistory | null {
  const days = [...b.days.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  const reads = splitIntoReads(days);

  // furthest progress any copy reached during the latest read; copies with no reading log
  // only count when there's a single read (so an old finished copy can't mark a re-read in
  // progress as finished)
  let final: number | null = null;
  if (b.finals.length) {
    const start = reads.length ? reads[reads.length - 1][0].date : EPOCH;
    const candidates = b.finals
      .filter((f) => (f.logged && f.day >= start) || (!f.logged && reads.length <= 1))
      .map((f) => f.progress);
    final = candidates.length
      ? Math.max(...candidates)
      : [...b.finals].sort(compareFinals)[b.finals.length - 1].progress;
  }
  if (!days.length && final === null && !b.sync) return null;

  const rl: ReadEntry[] = reads.map((r, i) => {
    const mins = r.map((x) => x.minutes).filter((m): m is number => !!m);
    let progress = [...r].reverse().find((x) => x.progress !== null)?.progress ?? null;
    if (progress === null && i === reads.length - 1) progress = final;
    return {
      read_no: i + 1,
      start: r[0].date,
      end: r[r.length - 1].date,
      days_read: r.length,
      minutes: mins.length ? round1(mins.reduce((s, m) => s + m, 0)) : null,
      progress,
      finished: progress !== null ? progress >= FINISHED : null,
    };
  });

  let lastRead = days.length ? days[days.length - 1].date : null;
  const sync = b.sync;
  if (sync && (!lastRead || sync.date >= lastRead)) {
    // a position synced from the app after the backup was made
    final = sync.progress;
    const r = rl.at(-1);
    if (r) {
      r.end = r.end > sync.date ? r.end : sync.date;
      r.progress = final;
      r.finished = final >= FINISHED;
    } else {
      rl.push({
        read_no: 1,
        start: sync.date,
        end: sync.date,
        days_read: 0,
        minutes: null,
        progress: final,
        finished: final >= FINISHED,
      });
    }
    lastRead = (lastRead ?? '') > sync.date ? lastRead : sync.date;
  }

  let status: BookStatus;
  if (final !== null && final >= FINISHED) status = 'finished';
  else if (final) status = 'in_progress';
  else if (final === 0 || !days.length) status = 'not_started';
  else status = 'unknown';

  const { info } = b;
  return {
    id: info.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
    title: info.title,
    author: info.author,
    series: info.series,
    series_no: info.series_no,
    genre: info.genre,
    subgenre: info.subgenre,
    status,
    progress: final,
    total_minutes: round1(b.ms / 60000),
    total_words: b.words,
    times_read: rl.length,
    first_read: days.length ? days[0].date : (rl[0]?.start ?? null),
    last_read: lastRead,
    reads: rl,
    daily: days,
    synced: sync ? sync.time : null,
    source_files: [...b.files].sort(),
  };
}
