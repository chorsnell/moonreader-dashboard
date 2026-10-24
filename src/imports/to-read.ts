/**
 * The to-read pile's server side (BOO-76): books you have but haven't started, written to
 * data/to_read.json. Sources only the build can see go in here: books on a Goodreads or
 * StoryGraph to-read shelf, book files in Moon+'s library that were never opened, and the
 * owner's own want-to-read list (BOO-102, library/want_to_read.json). The page
 * (web/features/to-read.js) adds the rest: books Moon+ shows as not started, priced books
 * never opened, and friends' favourites.
 */
import type { BookHistory, UnopenedBook } from '../backup-import/reading-history.types';
import { bookKey } from '../common/book-match';
import type { WantFile } from '../want-to-read/want-to-read';
import type { ToReadImport } from './merge';

/** One row of data/to_read.json. */
export interface ToReadRow {
  /** Your own id for it: catalogue-style "<source>:<id>" for imports, a slug for Moon+ files. */
  book_id: string;
  title: string;
  author: string;
  series: string | null;
  series_no: number | null;
  genre: string;
  subgenre: string;
  isbn13: string | null;
  pages: number | null;
  /** The day it was added to a shelf or to Moon+ (YYYY-MM-DD), when known. */
  added: string | null;
  /** Where it's waiting: moonplus, goodreads, storygraph, mine (your own list). */
  sources: string[];
  /** Your own shelves or tags for it, from the imports. */
  shelves: string[];
  /** From your own list: its id there, your note (never served to visitors) and the work. */
  want_id?: string;
  note?: string;
  work_id?: string | null;
  published_year?: number | null;
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'book';

/**
 * The pile, one row per book: Moon+'s unopened files first, then the to-read shelves, then
 * your own list, the same book from two places merged (by ISBN, then title and author). A
 * book that's in the library already (read, or being read) isn't on the pile, and nor is one
 * you hid (`want.hidden`: the book_id of any row merged into it), unless it's on your list.
 */
export function buildToRead(
  books: BookHistory[],
  unopened: UnopenedBook[],
  shelved: ToReadImport[],
  want: WantFile | null = null,
): ToReadRow[] {
  const hidden = new Set(want?.hidden ?? []);
  const ids = new Set(books.map((b) => b.id));
  const have = new Set(books.map((b) => bookKey(b.title, b.author)));
  const haveIsbn = new Set(books.map((b) => b.isbn13).filter(Boolean));
  const byKey = new Map<string, ToReadRow>();
  const byIsbn = new Map<string, ToReadRow>();
  const out: ToReadRow[] = [];
  // every row's own id and the ids of the rows merged into it, for hiding
  const merged = new Map<ToReadRow, string[]>();

  const add = (row: ToReadRow) => {
    const key = bookKey(row.title, row.author);
    if (have.has(key) || (row.isbn13 && haveIsbn.has(row.isbn13))) return;
    const same = (row.isbn13 && byIsbn.get(row.isbn13)) || byKey.get(key);
    if (same) {
      merged.get(same)!.push(row.book_id);
      same.sources = [...new Set([...same.sources, ...row.sources])];
      same.shelves = [...new Set([...same.shelves, ...row.shelves])];
      if (row.added && (!same.added || row.added < same.added)) same.added = row.added;
      same.isbn13 ??= row.isbn13;
      same.pages ??= row.pages;
      same.series ??= row.series;
      same.series_no ??= row.series_no;
      if (same.genre === 'Untagged' && row.genre !== 'Untagged') {
        same.genre = row.genre;
        same.subgenre = row.subgenre;
      }
      if (row.want_id) {
        same.want_id = row.want_id;
        same.note = row.note;
        same.work_id ??= row.work_id;
        same.published_year ??= row.published_year;
      }
      return;
    }
    out.push(row);
    merged.set(row, [row.book_id]);
    byKey.set(key, row);
    if (row.isbn13) byIsbn.set(row.isbn13, row);
  };

  for (const u of unopened) {
    let id = slug(u.title);
    for (let n = 2; ids.has(id); n++) id = `${slug(u.title)}-${n}`;
    ids.add(id);
    add({
      book_id: id,
      title: u.title,
      author: u.author,
      series: u.series,
      series_no: u.series_no,
      genre: u.genre,
      subgenre: u.subgenre,
      isbn13: u.isbn13,
      pages: null,
      added: u.added,
      sources: ['moonplus'],
      shelves: [],
    });
  }
  for (const s of shelved) {
    add({
      book_id: `${s.source}:${s.id}`.toLowerCase(),
      title: s.title,
      author: s.author,
      series: s.series,
      series_no: s.series_no,
      genre: s.genre,
      subgenre: s.subgenre,
      isbn13: s.isbn13,
      pages: s.pages,
      added: s.added,
      sources: [s.source],
      shelves: s.shelves,
    });
  }
  for (const w of want?.books ?? []) {
    add({
      book_id: w.id,
      title: w.title,
      author: w.author,
      series: w.series,
      series_no: w.series_no,
      genre: w.genre || 'Untagged',
      subgenre: w.subgenre || 'Untagged',
      isbn13: w.isbn13,
      pages: w.pages,
      added: w.added,
      sources: ['mine'],
      shelves: [],
      want_id: w.id,
      note: w.note,
      work_id: w.work_id,
      published_year: w.published_year,
    });
  }
  return out
    .filter((r) => r.want_id || !merged.get(r)!.some((id) => hidden.has(id)))
    .sort(
      (a, b) =>
        (a.added ?? '9999').localeCompare(b.added ?? '9999') || a.title.localeCompare(b.title),
    );
}
