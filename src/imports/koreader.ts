import { DatabaseSync } from 'node:sqlite';
import { daysBetween, localDate, round1 } from '../common/time';
import { FINISHED, GAP_DAYS } from '../backup-import/reading-history';
import type { DayEntry } from '../backup-import/reading-history.types';
import type { ImportedBook, ImportedRead } from './imports.types';

/**
 * KOReader records the time spent on each page, capped at a few minutes; a single entry
 * longer than this is the device left on a page (or a broken clock), so it's left out.
 */
export const MAX_ENTRY_SECONDS = 4 * 60 * 60;

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** KOReader writes "N/A" when a book has no author or series. */
const str = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === 'N/A' ? '' : s;
};

function columns(db: DatabaseSync, table: string): Set<string> {
  try {
    return new Set(
      db
        .prepare(`pragma table_info(${table})`)
        .all()
        .map((c) => String(c.name)),
    );
  } catch {
    return new Set();
  }
}

/** Whether a SQLite file is KOReader's statistics database (it has book and page_stat_data). */
export function isKoreaderDb(path: string): boolean {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    return false;
  }
  try {
    const names = new Set(
      db
        .prepare("select name from sqlite_master where type = 'table'")
        .all()
        .map((r) => String(r.name)),
    );
    return names.has('book') && names.has('page_stat_data');
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** "Discworld #3" -> Discworld and 3; "Discworld" -> Discworld and no number. */
export function koreaderSeries(raw: string): { series: string; series_no: number | null } | null {
  const s = str(raw);
  if (!s) return null;
  const m = /^(.*?)\s*#\s*([\d.]+)\s*$/.exec(s);
  if (m && m[1]) return { series: m[1], series_no: Number(m[2]) };
  return { series: s, series_no: null };
}

/** Several authors, one per line as KOReader keeps them, become "A & B". */
const authors = (raw: unknown) =>
  str(raw)
    .split(/\r?\n/)
    .map((a) => a.trim())
    .filter((a) => a && a !== 'N/A')
    .join(' & ');

/**
 * The books in KOReader's reading statistics (koreader/settings/statistics.sqlite3 on the
 * device): minutes and progress per day from the time spent on each page, and reads split
 * where a book was left for a year, like Moon+'s. Books never read are left out.
 */
export function readKoreader(path: string): ImportedBook[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const bookCols = columns(db, 'book');
    const statCols = columns(db, 'page_stat_data');
    if (!bookCols.has('id') || !statCols.has('id_book')) {
      throw new Error("That database isn't KOReader's statistics.sqlite3.");
    }
    const pick = (have: Set<string>, c: string, as = c) =>
      have.has(c) ? `"${c}" as "${as}"` : `null as "${as}"`;
    // older databases have no total_pages per entry: the book's page count stands in
    const rows = db
      .prepare(
        `select s.id_book as id_book, s.page as page, s.start_time as start_time,
          s.duration as duration, ${statCols.has('total_pages') ? 's.total_pages' : 'null'}
          as total_pages
        from page_stat_data s order by s.start_time`,
      )
      .all();
    const days = new Map<string, Map<string, DayEntry>>();
    const pages = new Map<string, number | null>();
    const bookRows = db
      .prepare(
        `select ${['id', 'title', 'authors', 'series', 'pages', 'md5']
          .map((c) => pick(bookCols, c))
          .join(', ')} from book`,
      )
      .all();
    for (const b of bookRows) pages.set(String(b.id), num(b.pages));
    for (const r of rows) {
      const start = num(r.start_time);
      const seconds = num(r.duration);
      if (start === null || seconds === null || seconds <= 0 || seconds > MAX_ENTRY_SECONDS) {
        continue;
      }
      const when = new Date(start * 1000);
      if (when.getUTCFullYear() < 2000) continue;
      const id = String(r.id_book);
      const date = localDate(when);
      const book = days.get(id) ?? new Map<string, DayEntry>();
      days.set(id, book);
      const d = book.get(date) ?? { date, minutes: 0, words: null, progress: null };
      d.minutes = (d.minutes ?? 0) + seconds / 60;
      const total = num(r.total_pages) || pages.get(id) || null;
      const page = num(r.page);
      if (total && total > 0 && page !== null && page > 0) {
        const p = round1(Math.min(100, (page / total) * 100));
        d.progress = Math.max(d.progress ?? 0, p);
      }
      book.set(date, d);
    }

    const books: ImportedBook[] = [];
    const ids = new Set<string>();
    for (const b of bookRows) {
      const map = days.get(String(b.id));
      const title = str(b.title);
      if (!map?.size || !title) continue;
      const daily = [...map.values()]
        .map((d) => ({ ...d, minutes: round1(d.minutes ?? 0) }))
        .sort((x, y) => (x.date < y.date ? -1 : 1));
      const reads: ImportedRead[] = [];
      let run: DayEntry[] = [];
      const close = () => {
        if (!run.length) return;
        const known = run.map((d) => d.progress).filter((p): p is number => p !== null);
        const progress = known.length ? Math.max(...known) : null;
        reads.push({
          start: run[0].date,
          end: run[run.length - 1].date,
          finished: progress !== null ? progress >= FINISHED : null,
          progress,
          minutes: round1(run.reduce((s, d) => s + (d.minutes ?? 0), 0)),
        });
        run = [];
      };
      for (const d of daily) {
        if (run.length && daysBetween(run[run.length - 1].date, d.date) >= GAP_DAYS) close();
        run.push(d);
      }
      close();
      const latest = reads.at(-1)!;
      const finished = latest.finished === true;
      const series = koreaderSeries(str(b.series));
      // the file's md5 stays the same across devices and resets; the row id doesn't
      let id = str(b.md5) || String(b.id);
      if (ids.has(id)) id = `${id}-${String(b.id)}`;
      ids.add(id);
      books.push({
        id,
        title,
        author: authors(b.authors),
        isbn13: null,
        isbn10: null,
        rating: null,
        shelves: [],
        shelf: finished ? 'read' : 'currently-reading',
        read_count: reads.filter((r) => r.finished === true).length,
        date_added: null,
        pages: num(b.pages) || null,
        reads,
        daily,
        progress: finished ? 100 : (latest.progress ?? null),
        ...series,
      });
    }
    return books;
  } finally {
    db.close();
  }
}
