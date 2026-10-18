import type { ImportSource } from '../imports/imports.types';

/** What catalogue.json says about one book. */
export interface CatalogueEntry {
  title: string;
  author: string;
  series?: string | null;
  series_no?: number | null;
  genre?: string;
  subgenre?: string;
  /** ISBN-13 or ISBN-10, written any usual way; the other form is worked out. */
  isbn13?: string | null;
  isbn10?: string | null;
  /** Shorthand for isbn13 or isbn10. */
  isbn?: string | null;
  /** Any id shared by every edition of the book (e.g. an Open Library work id): files with the same one count as one book. */
  work_id?: string | null;
  /** Hand-entered facts; each one wins over what the metadata lookup found. */
  published_year?: number | null;
  pages?: number | null;
  /** ISO 3166 code ("GB") or English name ("United Kingdom"). */
  author_country?: string | null;
  author_gender?: string | null;
  /**
   * true when you finished the book though Moon+ didn't see it (a broken file, say): its
   * latest read counts as finished. false stops finish-rules.ts guessing that it was.
   */
  finished?: boolean;
}

/** What catalogue.json says about an author, keyed by the name as books.json shows it. */
export interface CatalogueAuthor {
  country?: string | null;
  gender?: string | null;
}

/** What the reading history knows about a book's identity. */
export interface BookInfo {
  title: string;
  author: string;
  series: string | null;
  series_no: number | null;
  genre: string;
  subgenre: string;
  isbn13: string | null;
  isbn10: string | null;
  work_id: string | null;
}

export interface Catalogue {
  /** Keyed by the lower-case book file name. */
  books: Record<string, CatalogueEntry>;
  /** Lower-case file names that aren't books. */
  exclude: string[];
  authors?: Record<string, CatalogueAuthor>;
}

/** One row of Moon+'s statistics table. */
export interface StatisticsRow {
  filename: string | null;
  usedTime: number | null;
  readWords: number | null;
  /** Day tokens: "<day>|<ms>@<words>" followed by "#<progress>%". */
  dates: string | null;
}

/** A reading-position file Moon+ synced over WebDAV (<book file>.po). */
export interface SyncedPositionFile {
  name: string;
  text: string;
  mtimeMs: number;
}

export interface DayEntry {
  date: string;
  minutes: number | null;
  words: number | null;
  progress: number | null;
}

export interface ReadEntry {
  read_no: number;
  start: string;
  end: string;
  days_read: number;
  minutes: number | null;
  progress: number | null;
  finished: boolean | null;
  /**
   * Set when finish-rules.ts counted the read finished although its progress didn't reach
   * 99%: by_hand (catalogue.json), near_end (only back matter left) or estimate (no progress
   * logged, but enough words read for the book's length).
   */
  finished_by?: 'by_hand' | 'near_end' | 'estimate';
  /** Set when the read came from an import rather than Moon+. */
  source?: ImportSource;
}

export type BookStatus = 'finished' | 'in_progress' | 'not_started' | 'unknown';

/** One book in reading_history.json. */
export interface BookHistory {
  id: string;
  title: string;
  author: string;
  series: string | null;
  series_no: number | null;
  genre: string;
  subgenre: string;
  isbn13: string | null;
  isbn10: string | null;
  work_id: string | null;
  status: BookStatus;
  progress: number | null;
  total_minutes: number;
  total_words: number;
  times_read: number;
  first_read: string | null;
  last_read: string | null;
  reads: ReadEntry[];
  daily: DayEntry[];
  synced: string | null;
  source_files: string[];
  /** Set when the book is only known from an import, not from Moon+. */
  source?: ImportSource;
  /** The reader's rating (1 to 5), from an import. */
  rating?: number | null;
  /** The reader's own shelves or tags, from an import. */
  shelves?: string[];
  /** Each import's id for the book, e.g. { goodreads: '1885' }. */
  imports?: Partial<Record<ImportSource, string>>;
  /** When it was added to a library (Moon+'s addTime, an import's Date Added), YYYY-MM-DD. */
  added?: string | null;
}

export interface HistoryInput {
  catalogue: Catalogue;
  /** Lower-case file path -> [title, author], from Moon+'s books tables. */
  bookMeta: Map<string, [string, string]>;
  /** Lower-case file path -> ISBN, if Moon+'s books table has one (it usually doesn't). */
  isbns?: Map<string, string>;
  /** Lower-case file path -> the day it was added to Moon+ (YYYY-MM-DD), from addTime. */
  added?: Map<string, string>;
  statistics: StatisticsRow[];
  /** Lower-case file path -> last position (%), from positions10.xml. */
  positions: Map<string, number>;
  synced: SyncedPositionFile[];
}

export interface HistoryResult {
  books: BookHistory[];
  /** "<file>  ->  <title>" for every file not in the catalogue. */
  untagged: string[];
  /** How many synced positions were applied. */
  syncedApplied: number;
  /** .po files whose contents weren't understood. */
  unreadableSyncs: string[];
  /** Books in Moon+'s library never opened: no reading log and no position. */
  unopened: UnopenedBook[];
}

/** A book file Moon+ has but that was never opened. */
export interface UnopenedBook extends BookInfo {
  /** The file name, as catalogue.json keys it (lower case). */
  file: string;
  added: string | null;
}
