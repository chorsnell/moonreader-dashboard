import { rename, writeFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { logTimestamp } from '../../common/time';
import { MediaFiles, readJson } from '../media-files.service';
import {
  emptyTautulliCache,
  type TautulliCache,
  type TautulliMetadata,
  type TautulliRow,
  type TautulliSeason,
} from './tautulli';

const TIMEOUT_MS = 30_000;
const PAGE = 500;
/** Pull again from a day before the newest play, in case a play was still going last time. */
const OVERLAP_S = 86_400;

export interface TautulliConnection {
  url: string;
  api_key: string;
  user_id: string;
}

export interface TautulliUser {
  user_id: string;
  name: string;
}

export interface PullResult {
  new_rows: number;
  total: number;
}

interface Envelope<T> {
  response?: { result?: string; message?: string | null; data?: T };
}

/** Talks to Tautulli's API v2 and keeps the plays pulled so far in library/media/cache/tautulli.json. */
@Injectable()
export class TautulliClient {
  constructor(private readonly files: MediaFiles) {}

  /** Checks the address and key; returns the Plex users Tautulli knows, to pick yours from. */
  async test(conn: TautulliConnection, signal?: AbortSignal): Promise<TautulliUser[]> {
    const users = await this.call<
      { user_id: number | string; friendly_name?: string; username?: string }[]
    >(conn, 'get_users', {}, signal);
    return (users ?? [])
      .filter((u) => String(u.user_id) !== '0') // Tautulli's "Local" placeholder
      .map((u) => ({
        user_id: String(u.user_id),
        name: u.friendly_name || u.username || String(u.user_id),
      }));
  }

  /**
   * Pulls plays newer than the last pull (all of them the first time), one page at a time,
   * and the metadata of shows, seasons and films it hasn't seen. Writes the cache only when
   * something is new, so an idle poll doesn't trigger a rebuild.
   */
  async pull(conn: TautulliConnection, signal?: AbortSignal): Promise<PullResult> {
    const cache = await this.readCache();
    const seen = new Set(cache.rows.map((r) => r.row_id));
    const newest = Math.max(0, ...cache.rows.map((r) => r.started));
    const after = newest ? new Date((newest - OVERLAP_S) * 1000).toISOString().slice(0, 10) : null;
    let fresh: TautulliRow[] = [];
    for (let start = 0; ; start += PAGE) {
      const q: Record<string, string> = {
        grouping: '0',
        order_column: 'date',
        order_dir: 'asc',
        start: String(start),
        length: String(PAGE),
      };
      if (after) q.after = after;
      if (conn.user_id) q.user_id = conn.user_id;
      const page = await this.call<{ data?: TautulliRow[]; recordsFiltered?: number }>(
        conn,
        'get_history',
        q,
        signal,
      );
      const rows = (page?.data ?? []).map(normaliseRow).filter((r): r is TautulliRow => r !== null);
      fresh.push(...rows);
      if (rows.length < PAGE || start + PAGE >= (page?.recordsFiltered ?? 0)) break;
    }
    fresh = fresh.filter(
      (r) => !seen.has(r.row_id) && (!conn.user_id || String(r.user_id) === conn.user_id),
    );
    let changed = fresh.length > 0;
    cache.rows.push(...fresh);

    for (const r of cache.rows) {
      const item = String(
        (r.media_type === 'episode' ? r.grandparent_rating_key : r.rating_key) ?? '',
      );
      if (
        item &&
        !(item in cache.items) &&
        (r.media_type === 'episode' || r.media_type === 'movie')
      ) {
        cache.items[item] =
          (await this.call<TautulliMetadata>(conn, 'get_metadata', { rating_key: item }, signal)) ??
          {};
        changed = true;
      }
      const season = String(r.parent_rating_key ?? '');
      if (r.media_type === 'episode' && season && !(season in cache.seasons)) {
        cache.seasons[season] =
          (await this.call<TautulliSeason>(
            conn,
            'get_children_metadata',
            { rating_key: season },
            signal,
          )) ?? {};
        changed = true;
      }
    }
    if (changed) {
      cache.rows.sort((a, b) => a.started - b.started);
      cache.pulled = logTimestamp();
      await this.writeCache(cache);
    }
    return { new_rows: fresh.length, total: cache.rows.length };
  }

  /** A poster through Tautulli's image proxy, so the dashboard never needs a Plex token. */
  async poster(conn: TautulliConnection, thumb: string, signal?: AbortSignal): Promise<Buffer> {
    const q = new URLSearchParams({
      apikey: conn.api_key,
      cmd: 'pms_image_proxy',
      img: thumb,
      width: '300',
    });
    const res = await this.fetch(`${conn.url}/api/v2?${q}`, signal);
    return Buffer.from(await res.arrayBuffer());
  }

  async readCache(): Promise<TautulliCache> {
    const c = await readJson<Partial<TautulliCache>>(this.files.tautulliCache, {});
    return { ...emptyTautulliCache(), ...c };
  }

  /** Forgets everything pulled, e.g. after switching to another Tautulli or user. */
  async clearCache(): Promise<void> {
    await this.writeCache(emptyTautulliCache());
  }

  private async writeCache(cache: TautulliCache): Promise<void> {
    const file = this.files.tautulliCache;
    await writeFile(`${file}.part`, JSON.stringify(cache), 'utf8');
    await rename(`${file}.part`, file);
  }

  private async call<T>(
    conn: TautulliConnection,
    cmd: string,
    query: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    const q = new URLSearchParams({ ...query, apikey: conn.api_key, cmd });
    const res = await this.fetch(`${conn.url}/api/v2?${q}`, signal);
    let body: Envelope<T>;
    try {
      body = (await res.json()) as Envelope<T>;
    } catch {
      throw new Error("Tautulli's answer wasn't JSON: check the address.");
    }
    if (body.response?.result !== 'success') {
      throw new Error(`Tautulli said: ${body.response?.message || 'error'}`);
    }
    return body.response.data;
  }

  private async fetch(url: string, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (e) {
      throw new Error(`Tautulli could not be reached (${(e as Error).message})`);
    }
    if (res.status === 401) throw new Error('Tautulli refused the API key.');
    if (!res.ok) throw new Error(`HTTP ${res.status} from Tautulli`);
    return res;
  }
}

/** Keeps only the fields the dashboard uses, with numbers as numbers. */
function normaliseRow(r: Partial<TautulliRow> & { id?: number | string }): TautulliRow | null {
  const rowId = Number(r.row_id ?? r.id);
  const started = Number(r.started);
  if (!Number.isFinite(rowId) || !Number.isFinite(started) || !r.media_type) return null;
  return {
    row_id: rowId,
    started,
    stopped: Number(r.stopped) || undefined,
    play_duration: r.play_duration ?? null,
    duration: r.duration ?? null,
    percent_complete: r.percent_complete ?? null,
    watched_status: r.watched_status ?? null,
    media_type: r.media_type,
    title: r.title ?? '',
    grandparent_title: r.grandparent_title ?? null,
    parent_media_index: r.parent_media_index ?? null,
    media_index: r.media_index ?? null,
    year: r.year ?? null,
    rating_key: r.rating_key ?? null,
    parent_rating_key: r.parent_rating_key ?? null,
    grandparent_rating_key: r.grandparent_rating_key ?? null,
    user_id: r.user_id ?? null,
    user: r.user ?? null,
    player: r.player ?? null,
    platform: r.platform ?? null,
  };
}
