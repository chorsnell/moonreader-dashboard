/**
 * Popular books in your genres that you haven't read (BOO-105): which Open Library subject
 * each of your genres and subgenres maps to, what to keep of a subject's works, and
 * data/genre_picks.json, worked out at build time from library/bibliography.json. Pure.
 */
import { bookKey } from '../common/book-match';
import type { BibliographyFile, GenrePickRow, SubjectWork } from './bibliography.types';
import { isNotAWork } from './works';

/** A subgenre needs this many books in your library before it gets its own picks. */
export const SUBGENRE_MIN_BOOKS = 3;
/** At most this many picks per genre or subgenre. */
export const PICKS_PER_GENRE = 25;
/** Genres that are never looked up: no genre at all. */
const NO_GENRE = new Set(['untagged', 'private', '']);

/** A name as an Open Library subject slug: lower case, anything else between words as "_". */
export function slugify(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Genres whose Open Library subject isn't just their name; null: not looked up (too broad). */
const DEFAULTS: Record<string, string | null> = {
  science_fiction: 'science_fiction',
  sci_fi: 'science_fiction',
  scifi: 'science_fiction',
  sf: 'science_fiction',
  fantasy: 'fantasy',
  horror: 'horror',
  thriller: 'thrillers',
  thrillers: 'thrillers',
  young_adult: 'young_adult_fiction',
  ya: 'young_adult_fiction',
  literary_fiction: 'literary_fiction',
  literary: 'literary_fiction',
  classics: 'classic_literature',
  classic: 'classic_literature',
  litrpg: 'litrpg',
  mystery: 'mystery_and_detective_stories',
  mysteries: 'mystery_and_detective_stories',
  crime: 'mystery_and_detective_stories',
  mystery_crime: 'mystery_and_detective_stories',
  mystery_and_crime: 'mystery_and_detective_stories',
  crime_and_mystery: 'mystery_and_detective_stories',
  romance: 'romance',
  historical_fiction: 'historical_fiction',
  non_fiction: null,
  nonfiction: null,
  non_fic: null,
};

/**
 * The Open Library subject a genre (or subgenre) maps to by default: a few known genres by
 * name ("Classics" is classic_literature, "Thriller" thrillers), Non-fiction none (too broad
 * to suggest from), and any other name slugified ("Time Travel" is time_travel).
 */
export function defaultSubject(genre: string | null | undefined): string | null {
  const slug = slugify(genre);
  if (NO_GENRE.has(slug)) return null;
  return slug in DEFAULTS ? DEFAULTS[slug] : slug;
}

/** settings.json `discovery.subjects`: a genre or subgenre name → a subject slug, or '' to skip. */
export type SubjectOverrides = Record<string, string>;

/** settings.json's `discovery` section, leniently: only string values, slugified. */
export function readOverrides(section: unknown): SubjectOverrides {
  const subjects =
    section && typeof section === 'object' && !Array.isArray(section)
      ? (section as { subjects?: unknown }).subjects
      : undefined;
  const out: SubjectOverrides = {};
  if (!subjects || typeof subjects !== 'object' || Array.isArray(subjects)) return out;
  for (const [name, value] of Object.entries(subjects as Record<string, unknown>)) {
    if (typeof value === 'string' && name.trim()) out[name.trim()] = slugify(value);
  }
  return out;
}

/** The subject a genre or subgenre is looked up under: the admin's choice, else the default. */
export function subjectFor(name: string, overrides: SubjectOverrides = {}): string | null {
  if (NO_GENRE.has(slugify(name))) return null;
  const key = Object.keys(overrides).find((k) => k.toLowerCase() === name.toLowerCase());
  if (key !== undefined) return overrides[key] || null;
  return defaultSubject(name);
}

/** A row of books.json, as far as the picks need it. */
export interface PickBook {
  title: string;
  author?: string | null;
  genre?: string | null;
  subgenre?: string | null;
  work_id?: string | null;
  isbn13?: string | null;
}

/** A row of data/to_read.json, as far as the picks need it. */
export interface PickPileBook {
  title: string;
  author?: string | null;
  work_id?: string | null;
}

/** One genre or subgenre that gets picks. */
export interface DiscoveryTarget {
  /** The genre; for a subgenre, the genre most of its books are in. */
  genre: string;
  /** Null for the genre's own picks. */
  subgenre: string | null;
  /** Books of yours in it. */
  books: number;
  /** The subject it's looked up under by default, and the one it is (null: not looked up). */
  default_subject: string | null;
  subject: string | null;
}

const tagged = (g: string | null | undefined): g is string => !!g && !NO_GENRE.has(slugify(g));

/**
 * Your genres (every one but Untagged) and the subgenres with SUBGENRE_MIN_BOOKS or more
 * books, most books first, each with the subject it maps to. A subgenre is counted across
 * every genre it appears in, as its page is.
 */
export function discoveryTargets(
  books: readonly PickBook[],
  overrides: SubjectOverrides = {},
): DiscoveryTarget[] {
  const genres = new Map<string, number>();
  const subs = new Map<string, { books: number; parents: Map<string, number> }>();
  for (const b of books) {
    if (tagged(b.genre)) genres.set(b.genre, (genres.get(b.genre) ?? 0) + 1);
    if (tagged(b.subgenre)) {
      const s = subs.get(b.subgenre) ?? { books: 0, parents: new Map<string, number>() };
      s.books++;
      if (tagged(b.genre)) s.parents.set(b.genre, (s.parents.get(b.genre) ?? 0) + 1);
      subs.set(b.subgenre, s);
    }
  }
  const target = (genre: string, subgenre: string | null, n: number): DiscoveryTarget => {
    const name = subgenre ?? genre;
    return {
      genre,
      subgenre,
      books: n,
      default_subject: defaultSubject(name),
      subject: subjectFor(name, overrides),
    };
  };
  const byBooks = <T>(m: Map<string, T>, n: (v: T) => number) =>
    [...m].sort((a, b) => n(b[1]) - n(a[1]) || a[0].localeCompare(b[0]));
  const out = byBooks(genres, (n) => n).map(([g, n]) => target(g, null, n));
  for (const [name, s] of byBooks(subs, (s) => s.books)) {
    if (s.books < SUBGENRE_MIN_BOOKS) continue;
    const [parent] = byBooks(s.parents, (n) => n)[0] ?? [];
    if (parent) out.push(target(parent, name, s.books));
  }
  return out;
}

/** The subjects to look up for these targets, each once, in order. */
export function subjectsToLookUp(targets: readonly DiscoveryTarget[]): string[] {
  return [...new Set(targets.map((t) => t.subject).filter((s): s is string => !!s))];
}

const workId = (key: unknown) => {
  const id = typeof key === 'string' ? key.replace(/^\/?works\//, '') : '';
  return /^OL\d+W$/.test(id) ? id : null;
};

/**
 * A subject's works from Open Library's /subjects/<slug>.json, in its order, with what the
 * picks need: entries without a title are dropped; the rest of the checks are the build's.
 */
export function subjectWorks(docs: unknown): SubjectWork[] {
  if (!Array.isArray(docs)) return [];
  const out: SubjectWork[] = [];
  for (const d of docs as unknown[]) {
    if (!d || typeof d !== 'object') continue;
    const o = d as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim().replace(/\s+/g, ' ') : '';
    if (!title) continue;
    const first: unknown = Array.isArray(o.authors) ? o.authors[0] : null;
    const name =
      first && typeof first === 'object' ? (first as Record<string, unknown>).name : undefined;
    out.push({
      work_id: workId(o.key),
      title,
      author: typeof name === 'string' ? name.trim() : '',
      year: Number.isInteger(o.first_publish_year) ? (o.first_publish_year as number) : null,
      editions: Number.isInteger(o.edition_count) ? (o.edition_count as number) : null,
    });
  }
  return out;
}

/** Finds books by work id, then title and author (src/common/book-match.ts). */
class Shelf {
  private readonly works = new Set<string>();
  private readonly keys = new Set<string>();

  constructor(
    books: readonly { title: string; author?: string | null; work_id?: string | null }[],
  ) {
    for (const b of books) {
      if (b.work_id) this.works.add(b.work_id);
      if (b.title) this.keys.add(bookKey(b.title, b.author ?? ''));
    }
  }

  has(w: SubjectWork): boolean {
    return (
      (w.work_id !== null && this.works.has(w.work_id)) || this.keys.has(bookKey(w.title, w.author))
    );
  }
}

/**
 * One row per popular work in each of your genres and subgenres (DiscoveryTarget) that isn't
 * in your library: the works of its subject in Open Library's order (rank is the place in
 * that list, 1 the most popular), without books in books.json (by work id, then title and
 * author), study guides, box sets and the like (works.ts), at most PICKS_PER_GENRE each.
 * Books on the to-read pile are rows, marked on_pile.
 */
export function buildGenrePicks(
  books: readonly PickBook[],
  pile: readonly PickPileBook[],
  file: BibliographyFile | null | undefined,
  overrides: SubjectOverrides = {},
): GenrePickRow[] {
  const library = new Shelf(books);
  const onPile = new Shelf(pile);
  const rows: GenrePickRow[] = [];
  for (const t of discoveryTargets(books, overrides)) {
    const works = t.subject ? file?.subjects?.[t.subject]?.works : undefined;
    if (!Array.isArray(works)) continue;
    let n = 0;
    const seen = new Set<string>();
    for (const [i, w] of works.entries()) {
      if (n >= PICKS_PER_GENRE) break;
      if (!w || typeof w.title !== 'string' || !w.title.trim() || isNotAWork(w.title)) continue;
      const work = { ...w, work_id: w.work_id ?? null, author: w.author ?? '' };
      if (library.has(work)) continue;
      const key = work.work_id ?? bookKey(work.title, work.author);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        genre: t.genre,
        subgenre: t.subgenre,
        work_id: work.work_id,
        title: work.title,
        author: work.author,
        published_year: w.year ?? null,
        editions: w.editions ?? null,
        rank: i + 1,
        on_pile: onPile.has(work),
      });
      n++;
    }
  }
  return rows;
}
