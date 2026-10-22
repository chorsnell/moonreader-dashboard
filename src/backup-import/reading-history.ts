import { posix } from 'node:path';
import { dateFromEpochDays, daysBetween, localDateTime, round1 } from '../common/time';
import { parseIsbn } from '../metadata/isbn';
import type {
  BookHistory,
  BookInfo,
  BookStatus,
  CatalogueEntry,
  DayEntry,
  HistoryInput,
  HistoryResult,
  ReadEntry,
  SyncedPositionFile,
  UnopenedBook,
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
  info: BookInfo;
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

/** A catalogue entry's ISBN, from isbn13, isbn10 or isbn, whichever is valid first. */
function entryIsbns(entry: CatalogueEntry | undefined) {
  if (!entry) return null;
  return parseIsbn(entry.isbn13) ?? parseIsbn(entry.isbn10) ?? parseIsbn(entry.isbn);
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

  const identify = (path: string, note = true): BookInfo | null => {
    const base = basename(path).toLowerCase();
    if (!path || exclude.has(base)) return null;
    const entry = known[base];
    const isbn = entryIsbns(entry) ?? parseIsbn(input.isbns?.get(path.toLowerCase()));
    const ids = {
      isbn13: isbn?.isbn13 ?? null,
      isbn10: isbn?.isbn10 ?? null,
      work_id: entry?.work_id ? String(entry.work_id).trim() || null : null,
    };
    if (entry) {
      return {
        title: entry.title ?? '',
        author: entry.author ?? '',
        series: entry.series ?? null,
        series_no: entry.series_no ?? null,
        genre: entry.genre ?? 'Untagged',
        subgenre: entry.subgenre ?? 'Untagged',
        ...ids,
      };
    }
    let [title, author] = input.bookMeta.get(path.toLowerCase()) ?? ['', ''];
    if (!title) {
      title = titleFromFileName(path);
      if (!/\p{Lu}/u.test(title)) title = titleCase(title);
    }
    if (note) untagged.add(`${base}  ->  ${title}`);
    return {
      title,
      author,
      series: null,
      series_no: null,
      genre: 'Untagged',
      subgenre: 'Untagged',
      ...ids,
    };
  };

  // copies of a book are one book when they share a title and author, a work id or an ISBN
  const bookFor = (path: string): WorkingBook | null => {
    const info = identify(path);
    if (!info) return null;
    const keys = [`${info.title}|${info.author}`.toLowerCase()];
    if (info.work_id) keys.push(`work:${info.work_id.toLowerCase()}`);
    if (info.isbn13) keys.push(`isbn:${info.isbn13}`);
    let book = keys.map((k) => books.get(k)).find(Boolean);
    if (!book) {
      book = { info, files: new Set(), days: new Map(), ms: 0, words: 0, finals: [] };
    } else {
      // an edition may know what the first copy didn't
      book.info.isbn13 ??= info.isbn13;
      book.info.isbn10 ??= info.isbn10;
      book.info.work_id ??= info.work_id;
    }
    for (const k of keys) if (!books.has(k)) books.set(k, book);
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

  const {
    applied: syncedApplied,
    unreadable: unreadableSyncs,
    unmatched: unmatchedSyncs,
    byTitle: titleMatchedSyncs,
  } = applySyncedPositions(input.synced, byFile, bookFor);
  const estimatedDays = applyPositionLog(input.positionLog ?? [], byFile);

  // when each file was added to Moon+, by file name
  const addedByFile = new Map<string, string>();
  for (const [path, day] of input.added ?? []) {
    const k = basename(path).toLowerCase();
    if (!addedByFile.has(k) || day < addedByFile.get(k)!) addedByFile.set(k, day);
  }
  const out: BookHistory[] = [];
  for (const b of new Set(books.values())) {
    const history = toHistory(b);
    if (!history) continue;
    const added = [...b.files]
      .map((f) => addedByFile.get(f.toLowerCase()))
      .filter((d): d is string => !!d)
      .sort()[0];
    if (added) history.added = added;
    out.push(history);
  }

  // books in Moon+'s library that were never opened: on the to-read pile
  const unopened: UnopenedBook[] = [];
  const seenUnopened = new Set<string>();
  for (const path of input.bookMeta.keys()) {
    const file = basename(path).toLowerCase();
    if (byFile.has(file) || seenUnopened.has(file)) continue;
    const info = identify(path, false);
    if (!info) continue;
    seenUnopened.add(file);
    unopened.push({ ...info, file, added: addedByFile.get(file) ?? null });
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
  return {
    books: out,
    untagged: [...untagged].sort(),
    syncedApplied,
    unreadableSyncs,
    unmatchedSyncs,
    titleMatchedSyncs,
    estimatedDays,
    unopened,
  };
}

/**
 * Attaches the newest position from the .po files Moon+ syncs over WebDAV to each book.
 * Returns how many were applied, and the files that weren't understood.
 */
function applySyncedPositions(
  files: SyncedPositionFile[],
  byFile: Map<string, WorkingBook>,
  bookFor: (path: string) => WorkingBook | null,
): { applied: number; unreadable: string[]; unmatched: string[]; byTitle: string[] } {
  const stems = new Map<string, WorkingBook>();
  for (const [name, b] of byFile) if (!stems.has(stem(name))) stems.set(stem(name), b);
  const inBackup = new Set(byFile.values());
  const titles = titleIndex(inBackup);
  let applied = 0;
  const unreadable: string[] = [];
  const unmatched: string[] = [];
  const byTitle: string[] = [];
  for (const file of files) {
    const m = POSITION.exec(file.text);
    if (!m) {
      unreadable.push(`${file.name}: ${JSON.stringify(file.text.trim().slice(0, 60))}`);
      continue;
    }
    const stamped = m[1] ? Number(m[1]) * (m[1].length === 13 ? 1 : 1000) : null;
    const bookFile = file.name.slice(0, -3);
    const name = bookFile.toLowerCase();
    let b = byFile.get(name) ?? stems.get(name) ?? stems.get(stem(name)) ?? null;
    if (!b) {
      // a copy named differently from the one in the backup: match it by title
      b = matchByTitle(bookFile, titles);
      if (b) byTitle.push(`${file.name}  ->  ${b.info.title}`);
    }
    if (!b) {
      // a book the backup doesn't have yet (or one the catalogue knows by this file name)
      b = bookFor(bookFile);
      if (!b) continue; // excluded in catalogue.json
      if (!inBackup.has(b))
        unmatched.push(`${file.name}  ->  ${b.info.title} (no match in the backup)`);
    }
    const lastLogged = [...b.days.keys()].sort().at(-1) ?? null;
    const ms = syncTime(stamped, file.mtimeMs, lastLogged);
    const when = new Date(ms);
    if (!b.sync || localDateTime(when) > b.sync.time) {
      b.sync = {
        date: localDateTime(when).slice(0, 10),
        time: localDateTime(when, 'minutes'),
        progress: Number(m[2]),
      };
      applied++;
    }
  }
  return { applied, unreadable, unmatched, byTitle };
}

/**
 * When a synced position was saved. Moon+'s own time, but it can be months stale (seen: a
 * March stamp on a position uploaded in October), and a position stamped before the last day
 * the backup logged for the book would be thrown away, so then when it reached this server.
 */
function syncTime(stamped: number | null, arrived: number, lastLogged: string | null): number {
  const ms = stamped ?? arrived;
  if (lastLogged && localDateTime(new Date(ms)).slice(0, 10) < lastLogged) {
    return Math.max(ms, arrived);
  }
  return ms;
}

const lastLoggedDay = (b: WorkingBook): string | null => [...b.days.keys()].sort().at(-1) ?? null;

/**
 * Fills in the days after the last backup from the log of synced positions: for each book, one
 * day per local date a position arrived on, with the furthest progress synced that day. Words
 * are estimated from the progress made and the book's own words-per-percent in the backup;
 * there are no minutes. Days the backup already logged are left alone, so a newer backup
 * replaces these. Returns how many days were added.
 */
function applyPositionLog(log: SyncedPositionFile[], byFile: Map<string, WorkingBook>): number {
  if (!log.length) return 0;
  const stems = new Map<string, WorkingBook>();
  for (const [name, b] of byFile) if (!stems.has(stem(name))) stems.set(stem(name), b);
  const books = new Set(byFile.values());
  const titles = titleIndex(books);
  const found = new Map<string, WorkingBook | null>();
  const resolve = (bookFile: string): WorkingBook | null => {
    const name = bookFile.toLowerCase();
    if (!found.has(name)) {
      found.set(
        name,
        byFile.get(name) ??
          stems.get(name) ??
          stems.get(stem(name)) ??
          matchByTitle(bookFile, titles),
      );
    }
    return found.get(name)!;
  };

  // book -> local date -> the progress at the end of that day (the latest one synced)
  const byBook = new Map<WorkingBook, Map<string, { at: number; progress: number }>>();
  for (const entry of log) {
    const m = POSITION.exec(entry.text);
    if (!m || !entry.name.toLowerCase().endsWith('.po')) continue;
    const b = resolve(entry.name.slice(0, -3));
    if (!b) continue;
    const progress = Number(m[2]);
    if (!Number.isFinite(progress)) continue;
    const stamped = m[1] ? Number(m[1]) * (m[1].length === 13 ? 1 : 1000) : null;
    const at = syncTime(stamped, entry.mtimeMs, lastLoggedDay(b));
    const date = localDateTime(new Date(at)).slice(0, 10);
    let days = byBook.get(b);
    if (!days) byBook.set(b, (days = new Map()));
    const prev = days.get(date);
    if (!prev || at >= prev.at) days.set(date, { at, progress });
  }

  let added = 0;
  for (const [b, synced] of byBook) {
    const logged = [...b.days.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
    const lastLogged = logged.at(-1)?.date ?? '';
    const wpp = wordsPerPercent(logged);
    let prev = [...logged].reverse().find((d) => d.progress !== null)?.progress ?? null;
    for (const date of [...synced.keys()].sort()) {
      if (date <= lastLogged) continue;
      const { progress } = synced.get(date)!;
      // no forward progress: opened, or another device catching up, not a day of reading
      if (prev !== null && progress <= prev) continue;
      const gained = prev !== null ? progress - prev : null;
      b.days.set(date, {
        date,
        minutes: null,
        words: wpp !== null && gained !== null ? Math.round(gained * wpp) : null,
        progress,
        estimated: true,
      });
      prev = progress;
      added++;
    }
  }
  return added;
}

/**
 * Words per 1% of the book, from logged days that moved the progress on: the words read
 * those days over the progress they made. Null without at least 1% of such reading.
 */
function wordsPerPercent(days: DayEntry[]): number | null {
  let words = 0;
  let percent = 0;
  let prev: number | null = null;
  for (const d of days) {
    if (d.progress === null) continue;
    if (prev !== null && d.progress > prev && d.words) {
      words += d.words;
      percent += d.progress - prev;
    }
    prev = d.progress;
  }
  return percent >= 1 ? words / percent : null;
}

/** A title for matching: lower case, no accents or punctuation, no leading article. */
function matchKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

/** Shorter titles than this only match a synced file name exactly ("It" shouldn't match "It Ends…"). */
const MIN_PARTIAL_TITLE = 6;

/** Every title each book goes by: its own, and one from each of its file names. */
function titleIndex(books: Iterable<WorkingBook>): [string, WorkingBook][] {
  const out: [string, WorkingBook][] = [];
  for (const b of books) {
    const keys = new Set([
      matchKey(b.info.title),
      ...[...b.files].map((f) => matchKey(titleFromFileName(f))),
    ]);
    for (const k of keys) if (k) out.push([k, b]);
  }
  return out;
}

/**
 * The one book whose title matches a synced file's name, exactly or with an author before or
 * after it ("The Talisman - Stephen King"). The longest matching title wins; a tie between
 * different books is no match.
 */
function matchByTitle(bookFile: string, titles: [string, WorkingBook][]): WorkingBook | null {
  const want = matchKey(titleFromFileName(bookFile));
  if (!want) return null;
  let best = 0;
  let found = new Set<WorkingBook>();
  for (const [key, b] of titles) {
    const hit =
      key === want ||
      (key.length >= MIN_PARTIAL_TITLE && (want.startsWith(`${key} `) || want.endsWith(` ${key}`)));
    if (!hit) continue;
    const score = key === want ? Infinity : key.length;
    if (score > best) {
      best = score;
      found = new Set([b]);
    } else if (score === best) found.add(b);
  }
  return found.size === 1 ? [...found][0] : null;
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
    isbn13: info.isbn13,
    isbn10: info.isbn10,
    work_id: info.work_id,
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
