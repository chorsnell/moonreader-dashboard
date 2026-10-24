/**
 * Telling whether two book records are the same book: the one place the server keeps its
 * title and author matching, so every importer, the book manager (Arr), book clubs and the
 * price CSV agree. The page has the same `sameBookKeys` rules in `dash.sameBook`
 * (web/features/friend-profiles.js); src/common/book-match.spec.ts keeps the two in step.
 *
 * Three strengths, from strict to forgiving:
 * - `bookKey`: title without series suffix, subtitle, leading article or punctuation, plus the
 *   first author's surname. Imports (Goodreads, StoryGraph, Kobo, Kindle) and Arr use it.
 * - `sameBookKeys`: ISBN-13, work id, then the whole title and the whole author name. Used to
 *   find one person's book in another's library (friends, clubs, federation).
 * - `looseTitle` + `sameAuthorLoose`: the price CSV, where people type titles by hand.
 */

/** Lower case, with accents taken off ("Brontë" -> "bronte"). */
const plain = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** "The Colour of Magic (Discworld, #1)": a series and number in brackets at the end. */
export const SERIES_SUFFIX = /\s*\(([^()#]+?),?\s*#\s*([\d.]+)[^()]*\)\s*$/;

/** A title's series suffix, if it has one: "X (Discworld, #2)" -> { series: 'Discworld', no: 2 }. */
export function seriesSuffix(title: string): { title: string; series: string; no: number } | null {
  const m = SERIES_SUFFIX.exec(title);
  return m
    ? { title: title.replace(SERIES_SUFFIX, ''), series: m[1].trim(), no: Number(m[2]) }
    : null;
}

/**
 * A title as a match key: no series suffix, subtitle, leading article or punctuation, so
 * "The Colour of Magic (Discworld, #1)" and "Colour of Magic" agree. `series: false` keeps a
 * series suffix that follows another bracket ("X (Unabridged) (Discworld, #1)" -> "xunabridged"),
 * which is how the Arr lookup has always worked.
 */
export function titleKey(title: string, { series = true }: { series?: boolean } = {}): string {
  return plain(
    (series ? title.replace(SERIES_SUFFIX, '') : title)
      .replace(/\s*\([^()]*\)\s*$/, '')
      .split(/[:;]/)[0]
      .replace(/&/g, 'and'),
  )
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** An author as a match key: the surname, so "J.R.R. Tolkien" and "Tolkien, J. R. R." agree. */
export function authorKey(author: string): string {
  const a = author.split(/\s+(?:and|&)\s+|;/)[0].trim();
  const surname = a.includes(',')
    ? a.split(',')[0]
    : (a
        .replace(/,?\s+(jr|sr|ii|iii)\.?$/i, '')
        .split(/\s+/)
        .at(-1) ?? '');
  return plain(surname).replace(/[^a-z]+/g, '');
}

/** Title and author together, as imports match books. */
export const bookKey = (title: string, author: string, opts?: { series?: boolean }) =>
  `${titleKey(title, opts)}|${authorKey(author)}`;

/** Readarr's "Discworld #2", "Discworld, #2" or "(Discworld, #2)" -> { series: 'discworld', no: 2 }. */
export function seriesOf(
  seriesTitle: string | null | undefined,
): { series: string; no: number } | null {
  const m = /^\(?\s*(.+?),?\s*#\s*([\d.]+)/.exec(seriesTitle ?? '');
  return m ? { series: seriesKey(m[1]), no: Number(m[2]) } : null;
}

/** A series name as a match key. */
export const seriesKey = (name: string) => plain(name).replace(/[^a-z0-9]+/g, '');

export interface BookIdentity {
  title?: unknown;
  author?: unknown;
  isbn13?: unknown;
  work_id?: unknown;
}

/**
 * The keys a book is known by across libraries: its ISBN-13, its work id, and its title and
 * author once case, accents, punctuation and a leading article are ignored. Two books with a
 * key in common are the same book.
 */
export function sameBookKeys(b: BookIdentity): string[] {
  // accents off before lower case, exactly as the page does it
  const norm = (s: unknown) =>
    String(s ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  const out: string[] = [];
  if (b.isbn13) out.push(`isbn:${String(b.isbn13).replace(/[^0-9X]/gi, '')}`);
  if (b.work_id) out.push(`work:${String(b.work_id)}`);
  if (b.title) {
    const t = norm(b.title)
      .replace(/^(the|a|an)\s+/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    out.push(`ta:${t}|${norm(b.author).replace(/[^a-z]+/g, '')}`);
  }
  return out;
}

/** The first of `books` that is the same book as `want`, or null. */
export function sameBook<T extends BookIdentity>(books: T[], want: BookIdentity): T | null {
  const keys = new Set(sameBookKeys(want));
  return books.find((b) => sameBookKeys(b).some((k) => keys.has(k))) ?? null;
}

/** A hand-typed title, forgivingly: no subtitle, "(Book 1)" or " - Part 2", articles or punctuation. */
export const looseTitle = (s: string) =>
  plain(s.split(/\s*(?::|\(|\s[-–—]\s)/)[0] || s)
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');

const looseAuthor = (s: string) =>
  plain(s)
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Same author if the whole name or the surname matches ("Wells, H. G." and "H. G. Wells"). */
export function sameAuthorLoose(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = looseAuthor(a.includes(',') ? a.split(',').reverse().join(' ') : a);
  const y = looseAuthor(b.includes(',') ? b.split(',').reverse().join(' ') : b);
  return x === y || x.split(' ').pop() === y.split(' ').pop();
}

/** An ISBN as digits (and X) only, for comparing. */
export const isbnDigits = (s: string | null | undefined) =>
  (s ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();

/**
 * The first of several authors, as books.json spells it: "King, Stephen & Straub, Peter" ->
 * "King, Stephen". Splits on "&", ";" and " and ", like firstSurname.
 */
export const firstAuthor = (author: string | null | undefined) =>
  (author ?? '')
    .split(/\s*(?:&|;| and )\s*/)[0]
    .replace(/\s+/g, ' ')
    .trim();

/** Words a series name may end in that don't change which series it is. */
const SERIES_WORDS = /\s+(series|saga|trilogy|cycle|chronicles)$/;

/**
 * A series name as a match key, more forgiving than seriesKey: case, accents, a leading "The"
 * and a trailing "series", "saga", "trilogy", "cycle" or "chronicles" are ignored, so "The
 * Wheel of Time" and "Wheel of Time series" agree. A name that is only such a word ("The
 * Chronicles") is kept as it is.
 */
export function seriesNameKey(name: string | null | undefined): string {
  const words = plain(name ?? '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const noThe = words.replace(/^the\s+/, '') || words;
  const core = noThe.replace(SERIES_WORDS, '') || noThe;
  return core.replace(/\s+/g, '');
}
