import type { DayEntry } from '../backup-import/reading-history.types';

/** Where a book or read came from, when it wasn't Moon+. */
export type ImportSource = 'kobo' | 'kindle' | 'kindle_clippings' | 'goodreads' | 'storygraph';

/** In merge order: devices (with days and times) first, then the sites that add ratings. */
export const IMPORT_SOURCES: readonly ImportSource[] = [
  'kobo',
  'kindle',
  'kindle_clippings',
  'goodreads',
  'storygraph',
];

/** What each source is called on the page and in the log. */
export const SOURCE_NAMES: Record<ImportSource, string> = {
  kobo: 'Kobo',
  kindle: 'Kindle reading sessions',
  kindle_clippings: 'Kindle highlights',
  goodreads: 'Goodreads',
  storygraph: 'StoryGraph',
};

/** A highlight, note or bookmark another app made. */
export interface ImportedHighlight {
  /** Local date and time, YYYY-MM-DDTHH:MM:SS. */
  time: string | null;
  /** How far into the book (%), when known. */
  progress: number | null;
  chapter: number | null;
  /** Kindle's location, to keep the book's order. */
  location: number | null;
  text: string;
  note: string | null;
  kind: 'highlight' | 'note' | 'bookmark';
}

/** A read another app or site knows about. Dates are YYYY-MM-DD. */
export interface ImportedRead {
  /** Unknown for Goodreads, whose export only has the day a book was finished. */
  start: string | null;
  end: string;
  /** null when the source doesn't know (Kindle reading sessions). */
  finished: boolean | null;
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
  /** When the source has them as fields (Kobo); Goodreads puts them in the title. */
  series?: string | null;
  series_no?: number | null;
  /** How far the reader has got (%), when the source knows. */
  progress?: number | null;
  highlights?: ImportedHighlight[];
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
