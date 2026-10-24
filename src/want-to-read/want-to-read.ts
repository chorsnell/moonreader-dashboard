/**
 * The owner's own want-to-read list (BOO-102): library/want_to_read.json. Books typed in or
 * picked from an Open Library search on the To read tab, and books kept from a Goodreads or
 * StoryGraph to-read shelf so they outlast the shelf. `hidden` holds pile rows (by book_id)
 * the owner doesn't want on the pile. No import ever writes this file. Pure functions for
 * checking what the admin sends; the build reads the file in src/imports/to-read.ts.
 */
import { bookKey } from '../common/book-match';
import { parseIsbn } from '../metadata/isbn';

export const WANT_FROM = [
  'search',
  'goodreads',
  'storygraph',
  'moonplus',
  'author',
  'series',
  'genre',
  'manual',
] as const;
export type WantFrom = (typeof WANT_FROM)[number];

/** One book on the list. */
export interface WantBook {
  /** "mine:<slug of the title>", -2, -3… when titles clash. */
  id: string;
  title: string;
  author: string;
  series: string | null;
  series_no: number | null;
  isbn13: string | null;
  pages: number | null;
  published_year: number | null;
  /** Open Library work id (OL…W). */
  work_id: string | null;
  genre: string;
  subgenre: string;
  /** The owner's own note. Never served to visitors. */
  note: string;
  /** YYYY-MM-DD */
  added: string;
  from: WantFrom;
}

export interface WantFile {
  schema_version: 1;
  books: WantBook[];
  /** book_ids of pile rows to leave off the pile ("goodreads:123", a Moon+ file's slug). */
  hidden: string[];
}

/** What the admin sent was wrong: a 400 with this message. */
export class WantError extends Error {}

export const MAX_BOOKS = 5000;
export const MAX_HIDDEN = 5000;
const LIMITS = { title: 300, author: 200, series: 200, genre: 100, note: 2000 } as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UNTAGGED = 'Untagged';

export const emptyWant = (): WantFile => ({ schema_version: 1, books: [], hidden: [] });

export const wantSlug = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '') || 'book';

/** A free id for a title: mine:<slug>, then mine:<slug>-2, -3… */
export function wantId(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `mine:${wantSlug(title)}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

const text = (v: unknown, name: keyof typeof LIMITS, label: string = name): string => {
  if (v == null) return '';
  if (typeof v !== 'string' && typeof v !== 'number')
    throw new WantError(`The ${label} must be text.`);
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (s.length > LIMITS[name]) throw new WantError(`That ${label} is too long.`);
  return s;
};
const note = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v !== 'string') throw new WantError('The note must be text.');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s.length > LIMITS.note) throw new WantError('That note is too long.');
  return s;
};
const num = (v: unknown, label: string, min: number, max: number, int = true): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    throw new WantError(`The ${label} must be a number from ${min} to ${max}.`);
  }
  return n;
};
const isbn = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const p = parseIsbn(v);
  if (!p) throw new WantError('That ISBN isn’t valid.');
  return p.isbn13;
};
const workId = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const id = String(v).replace(/^\/?works\//, '');
  if (!/^OL\d{1,12}W$/.test(id)) throw new WantError('That Open Library work id isn’t valid.');
  return id;
};

/** The editable fields of a book, from a request body. Only the fields present are returned. */
function fields(body: Record<string, unknown>): Partial<WantBook> {
  const out: Partial<WantBook> = {};
  const has = (k: string) => Object.hasOwn(body, k);
  if (has('title')) out.title = text(body.title, 'title');
  if (has('author')) out.author = text(body.author, 'author');
  if (has('series')) out.series = text(body.series, 'series') || null;
  if (has('series_no'))
    out.series_no = num(body.series_no, 'number in the series', 0, 10000, false);
  if (has('isbn13')) out.isbn13 = isbn(body.isbn13);
  if (has('pages')) out.pages = num(body.pages, 'page count', 1, 50000);
  if (has('published_year')) out.published_year = num(body.published_year, 'year', -3000, 2200);
  if (has('work_id')) out.work_id = workId(body.work_id);
  if (has('genre')) out.genre = text(body.genre, 'genre') || UNTAGGED;
  if (has('subgenre')) out.subgenre = text(body.subgenre, 'genre', 'subgenre') || UNTAGGED;
  if (has('note')) out.note = note(body.note);
  return out;
}

const asObject = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new WantError('Send the book as a JSON object.');
  }
  return body as Record<string, unknown>;
};

/** A new book from what the admin sent (POST). `today` is the local date. */
export function toNewBook(raw: unknown, file: WantFile, today: string): WantBook {
  const body = asObject(raw);
  const f = fields(body);
  if (!f.title) throw new WantError('Give the book a title.');
  const from = body.from == null || body.from === '' ? 'manual' : body.from;
  if (!WANT_FROM.includes(from as WantFrom)) throw new WantError('Unknown "from".');
  // a book kept from a shelf keeps the day it went on the shelf
  const added =
    typeof body.added === 'string' && DAY.test(body.added) && body.added <= today
      ? body.added
      : today;
  return {
    id: wantId(
      f.title,
      file.books.map((b) => b.id),
    ),
    title: f.title,
    author: f.author ?? '',
    series: f.series ?? null,
    series_no: f.series_no ?? null,
    isbn13: f.isbn13 ?? null,
    pages: f.pages ?? null,
    published_year: f.published_year ?? null,
    work_id: f.work_id ?? null,
    genre: f.genre ?? UNTAGGED,
    subgenre: f.subgenre ?? UNTAGGED,
    note: f.note ?? '',
    added,
    from: from as WantFrom,
  };
}

/** A book with the admin's edits (PUT). The id, added day and source stay. */
export function editBook(book: WantBook, raw: unknown): WantBook {
  const f = fields(asObject(raw));
  if (Object.hasOwn(f, 'title') && !f.title) throw new WantError('Give the book a title.');
  return { ...book, ...f };
}

/** The book already on the list that `book` is a copy of (same ISBN, or title and author). */
export function duplicateOf(book: WantBook, file: WantFile): WantBook | null {
  const key = bookKey(book.title, book.author);
  return (
    file.books.find(
      (b) =>
        b.id !== book.id &&
        ((book.isbn13 && b.isbn13 === book.isbn13) || bookKey(b.title, b.author) === key),
    ) ?? null
  );
}

/** A pile row's key for `hidden`. */
export function toHiddenKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (!key || key.length > 300 || /[\u0000-\u001f]/.test(key)) {
    throw new WantError('Say which book to hide.');
  }
  if (key.startsWith('mine:')) throw new WantError('Remove a book on your list instead.');
  return key;
}

/** Reads the file leniently: anything malformed is dropped rather than failing the build. */
export function normaliseWant(raw: unknown): WantFile {
  const file = emptyWant();
  if (!raw || typeof raw !== 'object') return file;
  const r = raw as { books?: unknown; hidden?: unknown };
  const ids = new Set<string>();
  for (const b of Array.isArray(r.books) ? r.books : []) {
    if (!b || typeof b !== 'object') continue;
    const o = b as Record<string, unknown>;
    if (typeof o.title !== 'string' || !o.title.trim()) continue;
    let id = typeof o.id === 'string' && o.id.startsWith('mine:') ? o.id : '';
    if (!id || ids.has(id)) id = wantId(o.title, ids);
    ids.add(id);
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    file.books.push({
      id,
      title: o.title.trim(),
      author: str(o.author) ?? '',
      series: str(o.series) || null,
      series_no: n(o.series_no),
      isbn13: str(o.isbn13) || null,
      pages: n(o.pages),
      published_year: n(o.published_year),
      work_id: str(o.work_id) || null,
      genre: str(o.genre) || UNTAGGED,
      subgenre: str(o.subgenre) || UNTAGGED,
      note: str(o.note) ?? '',
      added: typeof o.added === 'string' && DAY.test(o.added) ? o.added : '1970-01-01',
      from: WANT_FROM.includes(o.from as WantFrom) ? (o.from as WantFrom) : 'manual',
    });
  }
  file.hidden = [
    ...new Set((Array.isArray(r.hidden) ? r.hidden : []).filter((k) => typeof k === 'string')),
  ];
  return file;
}
