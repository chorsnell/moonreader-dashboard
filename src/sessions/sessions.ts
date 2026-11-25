/**
 * data/sessions.json: what KOReader's page-by-page statistics add to the daily totals
 * (docs/api.md "Page-level reading"). Sessions, time of day, speed and finish estimates, and
 * progress through each book. Daily totals stay the source of truth; nothing here feeds them.
 * Pure: the page entries come from page-entries.ts.
 */
import { daysBetween, localDate, localDateTime, round1 } from '../common/time';
import { FINISHED } from '../backup-import/reading-history';

/** A gap longer than this between page turns ends a session. */
export const SESSION_GAP_SECONDS = 10 * 60;
/** The finish estimate's pace: the minutes read on the book in this many days. */
export const RECENT_DAYS = 14;
/** The share of the quickest and of the slowest pages left out of the reading speed. */
export const TRIM = 0.1;
/** Fewer timed pages than this say too little about a reading speed. */
export const MIN_SPEED_PAGES = 10;
/** A page glanced at for less than this isn't a re-read. */
export const REREAD_MIN_SECONDS = 10;
/**
 * A stall: at least this long on one page, and STALL_FACTOR times the book's typical page.
 * KOReader records at most 2 minutes a page by default, so nearly that long counts too
 * when the page is still half as long again as usual.
 */
export const STALL_MIN_SECONDS = 60;
export const STALL_FACTOR = 3;
export const STALL_CAPPED_SECONDS = 115;
/** Caps that keep the file small. */
export const MAX_SESSIONS = 3000;
export const MAX_PROGRESS_POINTS = 200;
export const MAX_REREAD_RANGES = 100;
export const MAX_STALLS = 20;
/** A finish further off than this isn't worth naming a date for. */
const MAX_FINISH_DAYS = 365;

/** One page turn, tied to its dashboard book. */
export interface PageEntry {
  book_id: string;
  page: number;
  /** Unix seconds. */
  start: number;
  seconds: number;
  /** The book's page count when the page was read (it changes with the font size). */
  total: number | null;
  device: string | null;
}

/** What the rest of the dashboard knows about a book. */
export interface SessionBook {
  id: string;
  status: string;
  progress: number | null;
  last_read: string | null;
}

export interface Session {
  book_id: string;
  device: string | null;
  start: string;
  end: string;
  minutes: number;
  /** Different pages read. */
  pages: number;
  first_page: number | null;
  last_page: number | null;
  total_pages: number | null;
}

/** [weekday (0 Monday), hour (0-23), minutes] */
export type TimeCell = [number, number, number];

export interface Eta {
  minutes_left: number;
  /** Minutes read on this book in the last RECENT_DAYS days. */
  recent_minutes: number;
  minutes_per_day: number;
  /** The date it would be finished at that pace; null with no recent reading. */
  finish: string | null;
}

export interface BookPages {
  book_id: string;
  since: string;
  until: string;
  minutes: number;
  total_pages: number | null;
  page: number | null;
  pages_left: number | null;
  minutes_per_page: number | null;
  pages_per_hour: number | null;
  eta: Eta | null;
  /** [local time to the minute, % through the book] */
  progress: [string, number][];
  reread: { pages: number; ranges: [number, number, number][] };
  stalls: { page: number; minutes: number; date: string }[];
  time_of_day: TimeCell[];
}

export interface SessionsFile {
  schema_version: 1;
  generated: string;
  session_gap_minutes: number;
  recent_days: number;
  coverage: {
    since: string | null;
    until: string | null;
    books: number;
    /** The first day in `sessions`: later than `since` when old sessions are left out. */
    sessions_since: string | null;
  };
  sessions: Session[];
  /** Minutes by weekday (0 Monday) then hour. */
  time_of_day: number[][];
  books: BookPages[];
}

interface Run {
  entries: PageEntry[];
  device: string | null;
  end: number;
}

/** Splits one book's page turns (in time order) at long gaps, and where the device changes. */
export function splitSessions(entries: PageEntry[]): Run[] {
  const runs: Run[] = [];
  let run: Run | undefined;
  for (const e of entries) {
    const otherDevice = run?.device && e.device && run.device !== e.device;
    if (!run || e.start - run.end > SESSION_GAP_SECONDS || otherDevice) {
      run = { entries: [], device: null, end: 0 };
      runs.push(run);
    }
    run.entries.push(e);
    run.device ??= e.device;
    run.end = Math.max(run.end, e.start + e.seconds);
  }
  return runs;
}

/** A page of a `total`-page layout as the same place in a `pages`-page one. */
export function rescalePage(page: number, total: number, pages: number): number {
  return Math.min(pages, Math.max(1, Math.ceil((page * pages) / total - 1e-9)));
}

/** A stay on one page, in the book's current page numbers. */
interface Visit {
  page: number;
  seconds: number;
  /** How many current pages the time covers (an old layout's page may be more or less than one). */
  width: number;
  start: number;
}

function visits(entries: PageEntry[], pages: number): Visit[] {
  const out: Visit[] = [];
  let source = '';
  for (const e of entries) {
    if (!e.total) continue;
    const page = rescalePage(e.page, e.total, pages);
    const width = pages / e.total;
    const from = `${e.page}/${e.total}`;
    const last = out.at(-1);
    if (last?.page === page) {
      last.seconds += e.seconds;
      // another of an old layout's smaller pages covers more; the same one again doesn't
      if (from !== source) last.width += width;
    } else {
      out.push({ page, seconds: e.seconds, width, start: e.start });
    }
    source = from;
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Seconds a page: the mean with the quickest and slowest tenth left out (flicked past, or
 * left open), or null with too few pages to say. Entries over four hours never get here.
 */
export function trimmedSeconds(perPage: number[]): number | null {
  if (perPage.length < MIN_SPEED_PAGES) return null;
  const s = [...perPage].sort((a, b) => a - b);
  const cut = Math.floor(s.length * TRIM);
  const kept = s.slice(cut, s.length - cut);
  return kept.reduce((sum, x) => sum + x, 0) / kept.length;
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/** How long is left, and when it would end at the pace of the last RECENT_DAYS days. */
export function estimate(
  pagesLeft: number,
  secondsPerPage: number,
  entries: PageEntry[],
  today: string,
): Eta {
  const minutesLeft = (pagesLeft * secondsPerPage) / 60;
  let recent = 0;
  for (const e of entries) {
    const ago = daysBetween(localDate(new Date(e.start * 1000)), today);
    if (ago >= 0 && ago < RECENT_DAYS) recent += e.seconds / 60;
  }
  const perDay = recent / RECENT_DAYS;
  const days = perDay > 0 ? Math.max(1, Math.ceil(minutesLeft / perDay)) : null;
  return {
    minutes_left: Math.round(minutesLeft),
    recent_minutes: round1(recent),
    minutes_per_day: round1(perDay),
    finish: days !== null && days <= MAX_FINISH_DAYS ? addDays(today, days) : null,
  };
}

/** Evenly spaced picks, always keeping the first and the last. */
export function downsample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  return Array.from({ length: max }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (max - 1))]);
}

/** Minutes by weekday and local hour, a page read across the hour split between the two. */
function timeCells(entries: PageEntry[]): TimeCell[] {
  const cells = new Map<number, number>();
  for (const e of entries) {
    let t = e.start;
    let left = e.seconds;
    while (left > 0) {
      const d = new Date(t * 1000);
      const part = Math.min(left, 3600 - d.getMinutes() * 60 - d.getSeconds());
      const key = ((d.getDay() + 6) % 7) * 24 + d.getHours();
      cells.set(key, (cells.get(key) ?? 0) + part);
      t += part;
      left -= part;
    }
  }
  return [...cells]
    .sort((a, b) => a[0] - b[0])
    .map(([key, s]): TimeCell => [Math.floor(key / 24), key % 24, round1(s / 60)])
    .filter((c) => c[2] > 0);
}

/** The books' time of day added up: a row per weekday (Monday first), a column per hour. */
export function sumTimeOfDay(books: Pick<BookPages, 'time_of_day'>[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const b of books) {
    for (const [day, hour, minutes] of b.time_of_day) grid[day][hour] += minutes;
  }
  return grid.map((row) => row.map(round1));
}

/** What the file says it covers, from what's in it. */
export function coverage(
  books: Pick<BookPages, 'since' | 'until'>[],
  sessions: Pick<Session, 'start'>[],
): SessionsFile['coverage'] {
  const first = (xs: string[]) => xs.reduce<string | null>((m, x) => (!m || x < m ? x : m), null);
  return {
    since: first(books.map((b) => b.since)),
    until: books.reduce<string | null>((m, b) => (!m || b.until > m ? b.until : m), null),
    books: books.length,
    sessions_since: first(sessions.map((s) => s.start.slice(0, 10))),
  };
}

function toSession(run: Run): Session {
  const timed = run.entries.filter((e) => e.total);
  const pages = timed.at(-1)?.total ?? null;
  const at = (e: PageEntry | undefined) =>
    e && pages ? rescalePage(e.page, e.total!, pages) : null;
  return {
    book_id: run.entries[0].book_id,
    device: run.device,
    start: localDateTime(new Date(run.entries[0].start * 1000)),
    end: localDateTime(new Date(run.end * 1000)),
    minutes: round1(run.entries.reduce((s, e) => s + e.seconds, 0) / 60),
    pages: new Set(run.entries.map((e) => `${e.page}/${e.total}`)).size,
    first_page: at(timed[0]),
    last_page: at(timed.at(-1)),
    total_pages: pages,
  };
}

function rereads(all: Visit[]): BookPages['reread'] {
  // glances are dropped first, so flicking back and forth doesn't count either page twice
  const times = new Map<number, number>();
  let last: number | null = null;
  for (const v of all) {
    if (v.seconds < REREAD_MIN_SECONDS) continue;
    if (v.page !== last) times.set(v.page, (times.get(v.page) ?? 0) + 1);
    last = v.page;
  }
  const again = [...times].filter(([, n]) => n > 1).sort((a, b) => a[0] - b[0]);
  const ranges: [number, number, number][] = [];
  for (const [page, n] of again) {
    const r = ranges.at(-1);
    if (r && r[1] === page - 1 && r[2] === n) r[1] = page;
    else ranges.push([page, page, n]);
  }
  return { pages: again.length, ranges: ranges.slice(0, MAX_REREAD_RANGES) };
}

/** Pages stayed on far longer than usual, the longest stay on each. */
function stalls(inSessions: Visit[]): BookPages['stalls'] {
  if (inSessions.length < MIN_SPEED_PAGES) return [];
  const per = (v: Visit) => v.seconds / Math.max(1, v.width);
  const typical = median(inSessions.map(per));
  const limit = Math.max(
    STALL_MIN_SECONDS,
    1.5 * typical,
    Math.min(STALL_FACTOR * typical, STALL_CAPPED_SECONDS),
  );
  const longest = new Map<number, Visit>();
  for (const v of inSessions) {
    const had = longest.get(v.page);
    if (per(v) >= limit && (!had || v.seconds > had.seconds)) longest.set(v.page, v);
  }
  return [...longest.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MAX_STALLS)
    .sort((a, b) => a.page - b.page)
    .map((v) => ({
      page: v.page,
      minutes: round1(v.seconds / 60),
      date: localDate(new Date(v.start * 1000)),
    }));
}

function bookPages(book: SessionBook, entries: PageEntry[], runs: Run[], today: string): BookPages {
  const latest = entries.findLast((e) => e.total);
  const total = latest?.total ?? null;
  const all = total ? visits(entries, total) : [];
  const since = localDate(new Date(entries[0].start * 1000));
  const until = localDate(new Date(entries.at(-1)!.start * 1000));
  const perPage = trimmedSeconds(all.map((v) => v.seconds / v.width));

  // where the reader is: the last page turned, unless they've read on elsewhere since
  let at = latest && total ? rescalePage(latest.page, total, total) / total : null;
  if (at !== null && book.progress !== null && (book.last_read ?? '') > until) {
    at = Math.max(at, book.progress / 100);
  }
  const done = book.status === 'finished' || (at !== null && at * 100 >= FINISHED);
  const page = total && at !== null ? Math.round(at * total) : null;
  const left = total && page !== null ? (done ? 0 : total - page) : null;

  return {
    book_id: book.id,
    since,
    until,
    minutes: round1(entries.reduce((s, e) => s + e.seconds, 0) / 60),
    total_pages: total,
    page,
    pages_left: left,
    minutes_per_page: perPage === null ? null : Math.round((perPage / 60) * 100) / 100,
    pages_per_hour: perPage === null ? null : round1(3600 / perPage),
    eta: perPage !== null && left && !done ? estimate(left, perPage, entries, today) : null,
    progress: downsample(
      all.map((v): [string, number] => [
        localDateTime(new Date(v.start * 1000), 'minutes'),
        round1((v.page / total!) * 100),
      ]),
      MAX_PROGRESS_POINTS,
    ),
    reread: rereads(all),
    stalls: total ? stalls(runs.flatMap((r) => visits(r.entries, total))) : [],
    time_of_day: timeCells(entries),
  };
}

/**
 * The whole file from every book's page turns. Entries for books not in `books` are left
 * out, so nothing is served that the privacy filter couldn't tie to a book.
 */
export function buildSessions(
  entries: PageEntry[],
  books: SessionBook[],
  now = new Date(),
): SessionsFile {
  const byId = new Map(books.map((b) => [b.id, b]));
  const byBook = new Map<string, PageEntry[]>();
  for (const e of entries) {
    if (!byId.has(e.book_id)) continue;
    const list = byBook.get(e.book_id);
    if (list) list.push(e);
    else byBook.set(e.book_id, [e]);
  }
  const today = localDate(now);
  const rows: BookPages[] = [];
  const sessions: Session[] = [];
  for (const [id, list] of byBook) {
    list.sort((a, b) => a.start - b.start || a.page - b.page);
    const runs = splitSessions(list);
    for (const r of runs) sessions.push(toSession(r));
    rows.push(bookPages(byId.get(id)!, list, runs, today));
  }
  sessions.sort((a, b) => a.start.localeCompare(b.start) || a.book_id.localeCompare(b.book_id));
  const kept = sessions.slice(-MAX_SESSIONS);
  rows.sort((a, b) => b.until.localeCompare(a.until) || a.book_id.localeCompare(b.book_id));
  return {
    schema_version: 1,
    generated: localDateTime(now),
    session_gap_minutes: SESSION_GAP_SECONDS / 60,
    recent_days: RECENT_DAYS,
    coverage: coverage(rows, kept),
    sessions: kept,
    time_of_day: sumTimeOfDay(rows),
    books: rows,
  };
}
