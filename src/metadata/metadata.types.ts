/** What the lookup found about a book on Open Library. */
export interface BookMetadata {
  /** Open Library work id, e.g. "OL66562W". */
  work_id?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  /** The year of the first edition. */
  published_year?: number | null;
  /** The median page count of its editions. */
  pages?: number | null;
  /** Open Library author id of the first author, e.g. "OL21594A". */
  author_key?: string | null;
  /** The day it was looked up (YYYY-MM-DD). */
  looked_up?: string;
}

export type Gender = 'female' | 'male' | 'non-binary' | 'other';

/** What the lookup found about an author on Wikidata. */
export interface AuthorMetadata {
  name?: string;
  /** Wikidata item, e.g. "Q36322". */
  wikidata?: string | null;
  /** ISO 3166-1 alpha-2 code. */
  country?: string | null;
  gender?: Gender | null;
  looked_up?: string;
}

/** library/metadata.json */
export interface MetadataFile {
  /** Keyed by book id. */
  books: Record<string, BookMetadata>;
  /** Keyed by the lower-case author as books.json shows it. */
  authors: Record<string, AuthorMetadata>;
}

/** library/.metadata-misses.json: the day a lookup last found nothing. */
export interface MetadataMisses {
  books: Record<string, string>;
  authors: Record<string, string>;
}
