import { DatabaseSync } from 'node:sqlite';
import { localDate, localDateTime, round1 } from '../common/time';
import { parseIsbn } from '../metadata/isbn';
import type { DayEntry } from '../backup-import/reading-history.types';
import type { ImportedBook, ImportedHighlight, ImportedRead } from './imports.types';

/** Every SQLite file starts with this. */
export const SQLITE_MAGIC = 'SQLite format 3\0';

/** content.ContentType for a whole book (chapters and other parts have other types). */
const BOOK = 6;

/** Kobo keeps times in UTC, with or without a "Z": as a Date, or null. */
export function koboTime(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 ? null : d;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** A JSON object from Kobo's text columns, with lower-case keys; {} if it isn't one. */
function jsonObject(raw: unknown): Record<string, unknown> {
  try {
    const o = JSON.parse(String(raw)) as unknown;
    if (!o || typeof o !== 'object') return {};
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  } catch {
    return {};
  }
}

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

/** Selects the columns a table has (a missing one comes back as null). */
function select(db: DatabaseSync, table: string, want: string[], where = '') {
  const have = columns(db, table);
  if (!have.size) return [];
  const list = want.map((c) => (have.has(c) ? `"${c}"` : `null as "${c}"`)).join(', ');
  return db.prepare(`select ${list} from ${table} ${where}`).all();
}

/**
 * Per-day reading from AnalyticsEvents: Kobo logs a LeaveContent event with the seconds read
 * and the progress each time a book is closed. The device keeps them only until it syncs
 * with Kobo, so many databases have none.
 */
function koboDays(db: DatabaseSync): Map<string, DayEntry[]> {
  const days = new Map<string, Map<string, DayEntry>>();
  for (const e of select(db, 'AnalyticsEvents', ['Type', 'Timestamp', 'Attributes', 'Metrics'])) {
    if (str(e.Type) !== 'LeaveContent') continue;
    const when = koboTime(e.Timestamp);
    const attrs = jsonObject(e.Attributes);
    const metrics = jsonObject(e.Metrics);
    const volume = str(attrs.volumeid);
    const seconds = num(metrics.secondsread);
    if (!when || !volume || !seconds || seconds <= 0) continue;
    const date = localDate(when);
    const book = days.get(volume) ?? new Map<string, DayEntry>();
    days.set(volume, book);
    const d = book.get(date) ?? { date, minutes: 0, words: null, progress: null };
    d.minutes = round1((d.minutes ?? 0) + seconds / 60);
    const p = num(attrs.progress);
    if (p !== null) d.progress = Math.max(d.progress ?? 0, p);
    book.set(date, d);
  }
  return new Map(
    [...days].map(([v, m]) => [v, [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1))]),
  );
}

function koboHighlights(db: DatabaseSync): Map<string, ImportedHighlight[]> {
  const out = new Map<string, ImportedHighlight[]>();
  const rows = select(db, 'Bookmark', [
    'VolumeID',
    'Text',
    'Annotation',
    'DateCreated',
    'Type',
    'Hidden',
  ]);
  for (const r of rows) {
    if (str(r.Hidden) === 'true' || num(r.Hidden) === 1) continue;
    const text = str(r.Text);
    const note = str(r.Annotation);
    const dogear = str(r.Type).toLowerCase() === 'dogear';
    if (!text && !note && !dogear) continue;
    const when = koboTime(r.DateCreated);
    const list = out.get(str(r.VolumeID)) ?? [];
    list.push({
      time: when ? localDateTime(when) : null,
      progress: null,
      chapter: null,
      location: null,
      text: text || note || 'Bookmark',
      note: note && text ? note : null,
      kind: note ? 'note' : text ? 'highlight' : 'bookmark',
    });
    out.set(str(r.VolumeID), list);
  }
  return out;
}

/**
 * The books in a Kobo e-reader's KoboReader.sqlite (.kobo/KoboReader.sqlite on the device):
 * progress, time spent, when last read and finished, highlights, and days when the device
 * still has them. Unread books on the device are left out.
 */
export function readKobo(path: string): ImportedBook[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (!columns(db, 'content').has('ContentID')) {
      throw new Error("That database isn't a KoboReader.sqlite (it has no content table).");
    }
    const days = koboDays(db);
    const highlights = koboHighlights(db);
    const rows = select(
      db,
      'content',
      [
        'ContentID',
        'ContentType',
        'Title',
        'Attribution',
        'ISBN',
        'Series',
        'SeriesNumber',
        '___PercentRead',
        'ReadStatus',
        'DateLastRead',
        'TimeSpentReading',
        'LastTimeStartedReading',
        'LastTimeFinishedReading',
        'DateAdded',
        '___NumPages',
      ],
      `where ContentType = ${BOOK}`,
    );
    const books: ImportedBook[] = [];
    for (const r of rows) {
      const id = str(r.ContentID);
      const title = str(r.Title);
      if (!id || !title) continue;
      const status = num(r.ReadStatus) ?? 0;
      const daily = days.get(id) ?? [];
      const notes = highlights.get(id) ?? [];
      if (status === 0 && !daily.length && !notes.length) continue; // on the device, never opened
      const finished = status === 2;
      const progress = finished ? 100 : (num(r.___PercentRead) ?? null);
      const last = koboTime(r.DateLastRead);
      const started = koboTime(r.LastTimeStartedReading);
      const done = koboTime(r.LastTimeFinishedReading);
      const seconds = num(r.TimeSpentReading) ?? 0;
      const reads: ImportedRead[] = [];
      const end = (finished && done) || last || done;
      const firstDay = daily[0]?.date;
      if (end) {
        const startDay = started ? localDate(started) : (firstDay ?? localDate(end));
        reads.push({
          start: startDay < localDate(end) ? startDay : localDate(end),
          end: localDate(end),
          finished,
          progress,
          minutes: seconds > 0 ? round1(seconds / 60) : null,
        });
      }
      const series = str(r.Series);
      books.push({
        id,
        title,
        author: str(r.Attribution),
        ...(parseIsbn(str(r.ISBN)) ?? { isbn13: null, isbn10: null }),
        rating: null,
        shelves: [],
        shelf: finished ? 'read' : 'currently-reading',
        read_count: finished ? 1 : 0,
        date_added: (() => {
          const d = koboTime(r.DateAdded);
          return d ? localDate(d) : null;
        })(),
        pages: num(r.___NumPages),
        reads,
        daily,
        progress,
        highlights: notes,
        ...(series ? { series, series_no: num(r.SeriesNumber) } : {}),
      });
    }
    return books;
  } finally {
    db.close();
  }
}
