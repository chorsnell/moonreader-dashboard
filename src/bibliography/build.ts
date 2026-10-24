/**
 * data/bibliography.json (BOO-103): the books by your authors, and in your series, that
 * aren't in your library, worked out at build time from library/bibliography.json.
 */
import { bookKey, firstAuthor, isbnDigits, seriesNameKey } from '../common/book-match';
import type {
  BibliographyFile,
  BibliographyRow,
  BibliographyWhy,
  BibliographyWork,
} from './bibliography.types';

/** A row of books.json, as far as the bibliography needs it. */
export interface LibraryBook {
  id?: string;
  title: string;
  author?: string | null;
  series?: string | null;
  status?: string | null;
  hours?: number | null;
  isbn13?: string | null;
  work_id?: string | null;
}

/** A row of data/to_read.json, as far as the bibliography needs it. */
export interface PileBook {
  title: string;
  author?: string | null;
  isbn13?: string | null;
  work_id?: string | null;
}

/** Whether you've read some of a book: finished it, are reading it, or spent time on it. */
const started = (b: LibraryBook) =>
  b.status === 'finished' || b.status === 'in_progress' || (b.hours ?? 0) > 0;

/** The lower-case first author: how bibliography.json keys an author. */
export const authorId = (author: string | null | undefined) => firstAuthor(author).toLowerCase();

export interface BibliographyAuthorPick {
  /** authorId: the lower-case first author. */
  id: string;
  /** The first author as books.json spells them. */
  name: string;
  hours: number;
  /** Their other books are wanted: a finished book, or two or more books. */
  byAuthor: boolean;
}

/**
 * The authors worth a bibliography, keyed by authorId, most hours read first: each with a
 * finished book or two or more books (all their books are wanted), or a started book in a
 * series (only the rest of that series is wanted).
 */
export function bibliographyAuthors(books: readonly LibraryBook[]): BibliographyAuthorPick[] {
  const by = new Map<string, BibliographyAuthorPick & { books: LibraryBook[] }>();
  for (const b of books) {
    const id = authorId(b.author);
    if (!id) continue;
    const a = by.get(id) ?? {
      id,
      name: firstAuthor(b.author),
      hours: 0,
      byAuthor: false,
      books: [],
    };
    a.hours += b.hours ?? 0;
    a.books.push(b);
    by.set(id, a);
  }
  const out: BibliographyAuthorPick[] = [];
  for (const { books: theirs, ...a } of by.values()) {
    a.byAuthor = theirs.length >= 2 || theirs.some((b) => b.status === 'finished');
    if (a.byAuthor || theirs.some((b) => b.series && started(b))) out.push(a);
  }
  return out.sort((a, b) => b.hours - a.hours || a.id.localeCompare(b.id));
}

/**
 * How books.json spells an author, so the page's author link works: a book of theirs alone
 * ("Jane Austen"), else the most common byline they come first in ("King, Stephen & Straub,
 * Peter").
 */
function spellings(books: readonly LibraryBook[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const b of books) {
    const name = (b.author ?? '').trim();
    const id = authorId(name);
    if (!id) continue;
    const m = counts.get(id) ?? new Map<string, number>();
    // a book of theirs alone always wins
    m.set(name, (m.get(name) ?? 0) + (name.toLowerCase() === id ? 1000 : 1));
    counts.set(id, m);
  }
  return new Map(
    [...counts].map(([id, m]) => [
      id,
      [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    ]),
  );
}

/** Finds books by work id, then ISBN, then title and author (src/common/book-match.ts). */
class Shelf {
  private readonly works = new Set<string>();
  private readonly isbns = new Set<string>();
  private readonly keys = new Set<string>();

  add(b: { title: string; author?: string | null; isbn13?: string | null; work_id?: string | null }) {
    if (b.work_id) this.works.add(b.work_id);
    const isbn = isbnDigits(b.isbn13);
    if (isbn) this.isbns.add(isbn);
    if (b.title) this.keys.add(bookKey(b.title, b.author ?? ''));
  }

  has(w: BibliographyWork, author: string): boolean {
    return (
      (w.work_id !== null && this.works.has(w.work_id)) ||
      (w.isbn13 !== null && this.isbns.has(isbnDigits(w.isbn13))) ||
      this.keys.has(bookKey(w.title, author))
    );
  }
}

const cmp = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b);
const num = (a: number | null, b: number | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;

/**
 * One row per work that isn't in your library: every work of an author with a finished book
 * or two books ("author"), and every work in a series you've started a book of ("series").
 * Books in books.json (read, being read or not started) are never rows; books on the to-read
 * pile are, marked on_pile. Sorted by author, series (works in no series last), number, year.
 */
export function buildBibliography(
  books: readonly LibraryBook[],
  pile: readonly PileBook[],
  file: BibliographyFile | null | undefined,
): BibliographyRow[] {
  const library = new Shelf();
  for (const b of books) library.add(b);
  const onPile = new Shelf();
  for (const b of pile) onPile.add(b);
  const spelled = spellings(books);
  const qualifies = new Set(
    bibliographyAuthors(books)
      .filter((a) => a.byAuthor)
      .map((a) => a.id),
  );
  // the series you've read a book of, as you spell them
  const yourSeries = new Map<string, string>();
  for (const b of books) {
    if (!b.series || !started(b)) continue;
    const key = seriesNameKey(b.series);
    if (key && !yourSeries.has(key)) yourSeries.set(key, b.series);
  }

  const rows: BibliographyRow[] = [];
  const seen = new Set<string>();
  for (const [id, entry] of Object.entries(file?.authors ?? {})) {
    const author = spelled.get(id.toLowerCase());
    if (!author || !Array.isArray(entry?.works)) continue; // no longer in the library
    for (const w of entry.works) {
      if (!w || typeof w.title !== 'string' || !w.title.trim()) continue;
      if (library.has(w, author)) continue;
      const mine = w.series ? yourSeries.get(seriesNameKey(w.series)) : undefined;
      const why: BibliographyWhy[] = [];
      if (qualifies.has(id.toLowerCase())) why.push('author');
      if (mine) why.push('series');
      if (!why.length) continue;
      const key = w.work_id ?? bookKey(w.title, author);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        work_id: w.work_id ?? null,
        title: w.title,
        author,
        published_year: w.year ?? null,
        editions: w.editions ?? null,
        series: mine ?? w.series ?? null,
        series_no: w.series ? (w.series_no ?? null) : null,
        isbn13: w.isbn13 ?? null,
        why,
        on_pile: onPile.has(w, author),
      });
    }
  }
  return rows.sort(
    (a, b) =>
      a.author.localeCompare(b.author) ||
      cmp(a.series, b.series) ||
      num(a.series_no, b.series_no) ||
      num(a.published_year, b.published_year) ||
      a.title.localeCompare(b.title),
  );
}
