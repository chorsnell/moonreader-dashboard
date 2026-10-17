import { posix } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { localDateTime, round1 } from '../common/time';
import type { BookHistory } from './reading-history.types';

/**
 * One row of Moon+'s notes table: highlights, notes and bookmarks. Every field is optional
 * because older (or newer) versions of the app may not have every column; see
 * docs/moonplus-backup.md.
 */
export interface NoteRow {
  id: number | null;
  filename: string | null;
  /** Chapter index, counted from 0 (front matter counts). */
  lastChapter: number | null;
  lastSplitIndex: number | null;
  /** Character offset within the chapter. */
  lastPosition: number | null;
  highlightLength: number | null;
  /** An Android colour: a signed 32-bit ARGB integer. */
  highlightColor: number | null;
  /** When it was made, ms since 1970. */
  time: number | null;
  bookmark: string | null;
  note: string | null;
  original: string | null;
  underline: number | null;
  strikethrough: number | null;
}

export type HighlightKind = 'highlight' | 'note' | 'bookmark';

/** One row of data/highlights.json. */
export interface Highlight {
  id: number;
  book_id: string;
  date: string | null;
  time: string | null;
  progress: number | null;
  chapter: number | null;
  text: string;
  note: string | null;
  colour: string | null;
  kind: HighlightKind;
}

const COLUMNS: (keyof NoteRow)[] = [
  'filename',
  'lastChapter',
  'lastSplitIndex',
  'lastPosition',
  'highlightLength',
  'highlightColor',
  'time',
  'bookmark',
  'note',
  'original',
  'underline',
  'strikethrough',
];
const NUMERIC = new Set<keyof NoteRow>([
  'lastChapter',
  'lastSplitIndex',
  'lastPosition',
  'highlightLength',
  'highlightColor',
  'time',
  'underline',
  'strikethrough',
]);

/**
 * The notes table, reading only the columns this backup has. A backup without the table
 * (or without a file name column to tie notes to books) gives no notes rather than failing.
 */
export function readNotes(db: DatabaseSync): NoteRow[] {
  try {
    const have = new Set(
      db
        .prepare('pragma table_info(notes)')
        .all()
        .map((c) => String(c.name)),
    );
    if (!have.has('filename')) return [];
    const cols = COLUMNS.filter((c) => have.has(c));
    const idCol = have.has('_id') ? '_id' : 'rowid';
    const rows = db.prepare(`select ${idCol} as id, ${cols.join(', ')} from notes`).all();
    return rows.map((r) => {
      const out = { id: num(r.id) } as NoteRow;
      for (const c of COLUMNS) {
        const v = r[c];
        (out as unknown as Record<string, unknown>)[c] = NUMERIC.has(c)
          ? num(v)
          : v == null
            ? null
            : String(v);
      }
      return out;
    });
  } catch {
    return [];
  }
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "#rrggbb" from an Android ARGB colour (alpha dropped). */
export function colourFromArgb(n: number | null): string | null {
  if (n == null) return null;
  return '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

/** Moon+ keeps line breaks in highlighted text as <BR>. */
const clean = (s: string | null) =>
  (s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

/** A timestamp in ms; a 10-digit one is taken as seconds. */
const toMs = (t: number | null) => (!t || t <= 0 ? null : t < 1e11 ? t * 1000 : t);

/**
 * Ties notes to the books of a reading history (by book file name, so files the catalogue
 * excludes are dropped with their books) and estimates how far through each book it was
 * made: the notes table has a chapter and an offset but not the book's length, so a note
 * is placed within the progress made on the day it was written (see docs/moonplus-backup.md).
 */
export function buildHighlights(
  books: BookHistory[],
  notes: NoteRow[],
): { highlights: Highlight[]; unmatched: number } {
  const byFile = new Map<string, BookHistory>();
  for (const b of books) for (const f of b.source_files) byFile.set(f.toLowerCase(), b);

  const out: (Highlight & { order: number[] })[] = [];
  let unmatched = 0;
  notes.forEach((n, i) => {
    const book = byFile.get(posix.basename(n.filename ?? '').toLowerCase());
    if (!book) {
      unmatched++;
      return;
    }
    const original = clean(n.original);
    const bookmark = clean(n.bookmark);
    const note = clean(n.note);
    if (!original && !bookmark && !note) return;
    const kind: HighlightKind = note ? 'note' : original ? 'highlight' : 'bookmark';
    const ms = toMs(n.time);
    const when = ms === null ? null : localDateTime(new Date(ms));
    out.push({
      id: n.id ?? i + 1,
      book_id: book.id,
      date: when ? when.slice(0, 10) : null,
      time: when,
      progress: null,
      chapter: n.lastChapter == null ? null : n.lastChapter + 1,
      text: original || bookmark,
      note: note || null,
      colour: kind === 'bookmark' ? null : colourFromArgb(n.highlightColor),
      kind,
      order: [n.lastChapter ?? 0, n.lastSplitIndex ?? 0, n.lastPosition ?? 0],
    });
  });

  // progress: spread each day's notes, in book order, across that day's progress
  const books1 = new Map(books.map((b) => [b.id, b]));
  const groups = new Map<string, (Highlight & { order: number[] })[]>();
  for (const h of out) {
    if (!h.date) continue;
    const k = `${h.book_id}|${h.date}`;
    groups.set(k, [...(groups.get(k) ?? []), h]);
  }
  for (const group of groups.values()) {
    const range = dayRange(books1.get(group[0].book_id)!, group[0].date!);
    if (!range) continue;
    group.sort((a, b) => compareOrder(a.order, b.order));
    const [from, to] = range;
    group.forEach((h, i) => {
      h.progress = round1(from + ((to - from) * (i + 1)) / (group.length + 1));
    });
  }

  const highlights = out
    .map(({ order: _order, ...h }) => h)
    .sort(
      (a, b) =>
        (a.time ?? '').localeCompare(b.time ?? '') ||
        a.book_id.localeCompare(b.book_id) ||
        a.id - b.id,
    );
  return { highlights, unmatched };
}

function compareOrder(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * The progress a book went from and to on a day: from the day before's progress (0 on a
 * read's first day) to that day's. A day with no log falls back to the last known progress.
 */
function dayRange(book: BookHistory, date: string): [number, number] | null {
  const days = book.daily;
  let prev: number | null = null;
  const readStart = new Set(book.reads.map((r) => r.start));
  for (const d of days) {
    if (readStart.has(d.date)) prev = 0;
    if (d.date === date) {
      if (d.progress === null) return prev === null ? null : [prev, prev];
      return [Math.min(prev ?? d.progress, d.progress), d.progress];
    }
    if (d.date > date) return prev === null ? null : [prev, prev];
    if (d.progress !== null) prev = d.progress;
  }
  return prev === null ? null : [prev, prev];
}
