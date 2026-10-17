import type { ItemMeta, MediaEvent, SeasonMeta } from '../media.types';

/**
 * Plex watch history through Tautulli's API (v2): every play with start, time played (pauses
 * already left out), position and show/season/episode. See docs/media-verticals.md.
 */

/** The fields of a get_history row the dashboard uses. */
export interface TautulliRow {
  row_id: number;
  started: number;
  stopped?: number;
  play_duration?: number | null;
  duration?: number | null;
  percent_complete?: number | null;
  watched_status?: number | null;
  media_type: string;
  title: string;
  grandparent_title?: string | null;
  parent_media_index?: number | string | null;
  media_index?: number | string | null;
  year?: number | string | null;
  rating_key?: number | string | null;
  parent_rating_key?: number | string | null;
  grandparent_rating_key?: number | string | null;
  user_id?: number | string | null;
  user?: string | null;
  player?: string | null;
  platform?: string | null;
}

/** What get_metadata says about a show or film. */
export interface TautulliMetadata {
  title?: string;
  year?: number | string | null;
  genres?: string[];
  directors?: string[];
  writers?: string[];
  studio?: string | null;
  duration?: number | string | null;
  guids?: string[];
  thumb?: string | null;
}

/** get_children_metadata on a season: its episodes. */
export interface TautulliSeason {
  children_count?: number | string;
  children_list?: { media_index?: number | string; title?: string; duration?: number | string }[];
}

/** library/media/cache/tautulli.json */
export interface TautulliCache {
  rows: TautulliRow[];
  /** Show or film rating key -> get_metadata. */
  items: Record<string, TautulliMetadata>;
  /** Season rating key -> its episodes. */
  seasons: Record<string, TautulliSeason>;
  pulled: string | null;
}

export const emptyTautulliCache = (): TautulliCache => ({
  rows: [],
  items: {},
  seasons: {},
  pulled: null,
});

const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const key = (x: unknown): string | null =>
  x === null || x === undefined || x === '' ? null : String(x);

/** Tautulli rows -> media events. Music and live TV are left out for now. */
export function tautulliEvents(rows: TautulliRow[]): MediaEvent[] {
  const out: MediaEvent[] = [];
  for (const r of rows) {
    const media = r.media_type === 'episode' ? 'tv' : r.media_type === 'movie' ? 'film' : null;
    if (!media || !num(r.started)) continue;
    const ratingKey = key(media === 'tv' ? r.grandparent_rating_key : r.rating_key);
    const seconds = num(r.play_duration) ?? num(r.duration);
    const name = media === 'tv' ? (r.grandparent_title ?? r.title) : r.title;
    out.push({
      source: 'tautulli',
      source_key: ratingKey ? `plex:${ratingKey}` : name.toLowerCase(),
      media,
      start: new Date(num(r.started)! * 1000).toISOString(),
      seconds,
      estimated: false,
      series_title: media === 'tv' ? name : null,
      season: media === 'tv' ? num(r.parent_media_index) : null,
      episode: media === 'tv' ? num(r.media_index) : null,
      title: r.title,
      year: num(r.year),
      position_pct: num(r.percent_complete),
      completed: num(r.watched_status) === 1,
      device: r.player || r.platform || null,
      ext: ratingKey ? { plex_rating_key: ratingKey } : undefined,
    });
  }
  return out;
}

/** "tmdb://603" -> 603, "imdb://tt0133093" -> "tt0133093". */
function guid(guids: string[] | undefined, scheme: string): string | null {
  const g = guids?.find((x) => x.startsWith(`${scheme}://`));
  return g ? g.slice(scheme.length + 3) : null;
}

/** The cached Plex metadata as ItemMeta, keyed like the events (metaKey). */
export function tautulliMeta(cache: TautulliCache): Map<string, ItemMeta> {
  const out = new Map<string, ItemMeta>();
  // season rating key -> [show rating key, season number], from the plays
  const seasonsOf = new Map<string, [string, number]>();
  for (const r of cache.rows) {
    const show = key(r.grandparent_rating_key);
    const season = key(r.parent_rating_key);
    const no = num(r.parent_media_index);
    if (r.media_type === 'episode' && show && season && no !== null)
      seasonsOf.set(season, [show, no]);
  }
  const seasons = new Map<string, Record<string, SeasonMeta>>();
  for (const [seasonKey, [show, no]] of seasonsOf) {
    const s = cache.seasons[seasonKey];
    if (!s) continue;
    const titles: Record<string, number> = {};
    const runtimes: Record<string, number> = {};
    for (const e of s.children_list ?? []) {
      const n = num(e.media_index);
      if (n === null) continue;
      if (e.title) titles[e.title.toLowerCase()] = n;
      const ms = num(e.duration);
      if (ms) runtimes[String(n)] = Math.round(ms / 60000);
    }
    const all = seasons.get(show) ?? {};
    all[String(no)] = { episodes: num(s.children_count), titles, runtimes };
    seasons.set(show, all);
  }
  const mediaOf = new Map<string, 'tv' | 'film'>();
  for (const r of cache.rows) {
    if (r.media_type === 'episode' && key(r.grandparent_rating_key))
      mediaOf.set(key(r.grandparent_rating_key)!, 'tv');
    if (r.media_type === 'movie' && key(r.rating_key)) mediaOf.set(key(r.rating_key)!, 'film');
  }
  for (const [ratingKey, m] of Object.entries(cache.items)) {
    const media = mediaOf.get(ratingKey);
    if (!media) continue;
    const ms = num(m.duration);
    const tmdb = guid(m.guids, 'tmdb');
    out.set(`${media}:plex:${ratingKey}`, {
      media,
      title: m.title ?? null,
      creator: media === 'film' ? (m.directors?.[0] ?? null) : (m.writers?.[0] ?? m.studio ?? null),
      genres: m.genres ?? [],
      year: num(m.year),
      runtime: ms ? Math.round(ms / 60000) : null,
      seasons: media === 'tv' ? seasons.get(ratingKey) : undefined,
      poster: m.thumb ?? null,
      poster_from: 'tautulli',
      ext: {
        plex_rating_key: ratingKey,
        tmdb_id: tmdb ? Number(tmdb) : null,
        imdb_id: guid(m.guids, 'imdb'),
        tvdb_id: guid(m.guids, 'tvdb') ? Number(guid(m.guids, 'tvdb')) : null,
      },
    });
  }
  return out;
}
