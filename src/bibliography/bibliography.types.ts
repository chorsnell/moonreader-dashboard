/** Where a work in an author's bibliography was found. */
export type WorkSource = 'openlibrary' | 'wikidata';

/** One work by an author, as the bibliography lookup keeps it. */
export interface BibliographyWork {
  /** Open Library work id, e.g. "OL66562W"; null for a work only Wikidata knows. */
  work_id: string | null;
  title: string;
  /** The year it was first published, when known. */
  year: number | null;
  /** How many editions Open Library has of it; null for a work only Wikidata knows. */
  editions: number | null;
  /** The series it's part of (Wikidata's English label), or null. */
  series: string | null;
  series_no: number | null;
  isbn13: string | null;
  sources: WorkSource[];
}

/** What the lookup found for one author. */
export interface BibliographyAuthor {
  /** Open Library author id, e.g. "OL21594A", or null. */
  author_key: string | null;
  /** Wikidata item, e.g. "Q36322", or null. */
  wikidata: string | null;
  /** The day they were looked up (YYYY-MM-DD); looked up again after REFRESH_DAYS. */
  looked_up: string;
  works: BibliographyWork[];
}

/**
 * library/bibliography.json: an input to the build, like metadata.json. Keyed by the
 * lower-case first author as books.json names them ("king, stephen" for "King, Stephen &
 * Straub, Peter").
 */
export interface BibliographyFile {
  authors: Record<string, BibliographyAuthor>;
}

/**
 * library/.bibliography-misses.json: the day an author couldn't be found on Open Library.
 * Kept apart so a miss doesn't rebuild anything.
 */
export interface BibliographyMisses {
  authors: Record<string, string>;
}

/** Why a work is shown: it's by an author you read, in a series you read, or both. */
export type BibliographyWhy = 'author' | 'series';

/** One row of data/bibliography.json: a work that isn't in your library. */
export interface BibliographyRow {
  work_id: string | null;
  title: string;
  /** As books.json spells the author, so the page can link to the author's page. */
  author: string;
  published_year: number | null;
  editions: number | null;
  /** As books.json spells it when it's one of your series. */
  series: string | null;
  series_no: number | null;
  isbn13: string | null;
  why: BibliographyWhy[];
  /** It's on your to-read pile (data/to_read.json). */
  on_pile: boolean;
}
