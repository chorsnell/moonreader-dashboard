import type { DayEntry } from '../backup-import/reading-history.types';

/** Where a book or read came from, when it wasn't Moon+. */
export type ImportSource = 'goodreads' | 'storygraph';

export const IMPORT_SOURCES: readonly ImportSource[] = ['goodreads', 'storygraph'];

/** A read another app or site knows about. Dates are YYYY-MM-DD. */
export interface ImportedRead {
  /** Unknown for Goodreads, whose export only has the day a book was finished. */
  start: string | null;
  end: string;
  finished: boolean;
  progress?: number | null;
  minutes?: number | null;
}

/** One book of an import, normalised from the source's own format. */
export interface ImportedBook {
  /** The source's id for the book (Goodreads Book Id, StoryGraph ISBN/UID). */
  id: string;
  title: string;
  author: string;
  isbn13: string | null;
  isbn10: string | null;
  /** 1 to 5 (StoryGraph allows quarter stars); null when not rated. */
  rating: number | null;
  /** The reader's own shelves or tags, without the status shelf. */
  shelves: string[];
  /** read, currently-reading, to-read, did-not-finish… */
  shelf: string;
  read_count: number;
  date_added: string | null;
  pages: number | null;
  reads: ImportedRead[];
  /** Per-day reading, when the source has it. */
  daily?: DayEntry[];
}

/** What library/<source>.json holds. */
export interface ImportFile {
  schema_version: 1;
  source: ImportSource;
  /** The uploaded file's name. */
  file: string;
  /** Local time of the upload. */
  imported: string;
  books: ImportedBook[];
}
