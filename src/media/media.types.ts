/**
 * Other media (TV and film first): the shared intermediate every source produces, the
 * metadata that enriches it, and the rows of the media_*.json files. See docs/media-verticals.md.
 */

export type MediaSource =
  | 'netflix'
  | 'tautulli'
  | 'plex'
  | 'trakt'
  | 'letterboxd'
  | 'audiobookshelf'
  | 'spotify'
  | 'lastfm'
  | 'steam';

export type Medium = 'tv' | 'film' | 'audiobook' | 'music' | 'podcast' | 'game';

export interface ExternalIds {
  tmdb_id?: number | null;
  imdb_id?: string | null;
  tvdb_id?: number | null;
  plex_rating_key?: string | null;
}

/** One sitting (or one dated event) from any source. The builder never knows where it came from. */
export interface MediaEvent {
  source: MediaSource;
  /** Stable per item at the source, e.g. the lower-cased Netflix show, a Plex rating key. */
  source_key: string;
  media: Medium;
  /** ISO UTC. */
  start: string;
  /** Time played; null for dated events (minutes then come from the runtime). */
  seconds: number | null;
  estimated: boolean;
  /** Show, collection or album artist. */
  series_title?: string | null;
  season?: number | null;
  /** How the source named the season, e.g. "Season 2", "Part 1", "Limited Series". */
  season_label?: string | null;
  episode?: number | null;
  /** Episode, film, album or game title. */
  title: string;
  year?: number | null;
  /** Furthest position reached, as % of the runtime. */
  position_pct?: number | null;
  /** Furthest position reached, in seconds (Netflix's Bookmark); turned into % once the runtime is known. */
  position_seconds?: number | null;
  /** The source says this part was watched to the end. */
  completed?: boolean;
  device?: string | null;
  ext?: ExternalIds;
}

/** What a metadata source (TMDB, Plex) or the media catalogue knows about a season's episodes. */
export interface SeasonMeta {
  episodes?: number | null;
  /** Lower-cased episode title -> episode number, for sources without numbers (Netflix). */
  titles?: Record<string, number>;
  /** Episode number -> runtime in minutes. */
  runtimes?: Record<string, number>;
  poster?: string | null;
}

/** Metadata for a show or a film, from TMDB or Tautulli. Everything is optional. */
export interface ItemMeta {
  media?: Medium;
  title?: string | null;
  creator?: string | null;
  genres?: string[];
  year?: number | null;
  /** Film runtime, or a typical episode runtime, in minutes. */
  runtime?: number | null;
  collection?: { name: string; order?: number | null } | null;
  seasons?: Record<string, SeasonMeta>;
  /** A poster path the build can fetch, from TMDB (the default) or through Tautulli. */
  poster?: string | null;
  poster_from?: 'tmdb' | 'tautulli';
  ext?: ExternalIds;
}

/** library/media/catalogue.json: manual fixes, keyed by source_key (or lower-cased title). */
export interface MediaCatalogueEntry {
  media?: Medium;
  title?: string;
  creator?: string;
  genre?: string;
  subgenre?: string;
  year?: number;
  series?: string;
  series_no?: number;
  /** Season number -> episode count. */
  episodes?: Record<string, number>;
  /** Film runtime, or a typical episode runtime, in minutes. */
  runtime?: number;
  /** The title of the book (in your library) this adapts, when the titles differ. */
  book?: string;
  exclude?: boolean;
}

export type MediaCatalogue = Record<string, MediaCatalogueEntry>;

export type MediaStatus = 'finished' | 'in_progress' | 'not_started' | 'unknown';

/** media_items.json: the books.json of media. A TV season or a film. */
export interface MediaItemRow {
  id: string;
  media: Medium;
  title: string;
  creator: string | null;
  series: string | null;
  series_id: string | null;
  series_no: number | null;
  genre: string | null;
  subgenre: string | null;
  year: number | null;
  status: MediaStatus;
  progress: number | null;
  hours: number;
  units: number | null;
  units_total: number | null;
  times: number;
  first: string | null;
  last: string | null;
  sources: MediaSource[];
  /** The book it adapts, from the media catalogue; null means "match by title". */
  adapts: string | null;
  ext: ExternalIds;
}

/** media_runs.json: one watch-through of a season, or one viewing of a film. */
export interface MediaRunRow {
  run_id: string;
  item_id: string;
  media: Medium;
  title: string;
  creator: string | null;
  genre: string | null;
  subgenre: string | null;
  series: string | null;
  run_no: number;
  times: number;
  start: string;
  end: string;
  days: number;
  hours: number;
  units: number | null;
  progress: number | null;
  finished: boolean;
}

/** media_daily.json: one row per item per day. */
export interface MediaDailyRow {
  date: string;
  item_id: string;
  media: Medium;
  title: string;
  creator: string | null;
  genre: string | null;
  minutes: number;
  units: number;
  progress: number | null;
}

/** media_sessions.json: every sitting, with clock times. */
export interface MediaSessionRow {
  start: string;
  end: string;
  date: string;
  item_id: string;
  part_id: string | null;
  media: Medium;
  minutes: number;
  progress: number | null;
  estimated: boolean;
  source: MediaSource;
  device: string | null;
}

/** media_parts.json: episodes (later tracks). */
export interface MediaPartRow {
  id: string;
  item_id: string;
  media: Medium;
  no: number;
  title: string;
  runtime: number | null;
  plays: number;
  minutes: number;
  first: string;
  last: string;
  completed: boolean;
}

export interface MediaHistory {
  items: MediaItemRow[];
  runs: MediaRunRow[];
  daily: MediaDailyRow[];
  sessions: MediaSessionRow[];
  parts: MediaPartRow[];
}
