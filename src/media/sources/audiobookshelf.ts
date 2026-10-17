import { rename, writeFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { logTimestamp } from '../../common/time';
import { MediaFiles, readJson } from '../media-files.service';
import type { ItemMeta, MediaEvent } from '../media.types';

/**
 * Audiobooks from Audiobookshelf (self-hosted): its listening sessions say when you listened,
 * for how long and where you got to, like Moon+ does for books. See docs/media-verticals.md.
 */

/** The fields of a listening session the dashboard uses. */
export interface AbsSession {
  id: string;
  libraryItemId: string;
  mediaType: string;
  displayTitle: string;
  displayAuthor?: string | null;
  mediaMetadata?: {
    title?: string;
    series?: { name?: string; sequence?: string | null }[];
    genres?: string[];
    narrators?: string[];
    publishedYear?: string | null;
    isbn?: string | null;
    asin?: string | null;
  } | null;
  duration?: number | null;
  timeListening?: number | null;
  currentTime?: number | null;
  startedAt: number;
  updatedAt?: number | null;
  deviceInfo?: { clientName?: string; deviceName?: string; model?: string } | null;
}

/** library/media/cache/audiobookshelf.json */
export interface AbsCache {
  sessions: AbsSession[];
  pulled: string | null;
}

export interface AbsConnection {
  url: string;
  token: string;
}

const PAGE = 100;
/** Stops a runaway pull (100 a page: 50,000 sessions). */
const MAX_PAGES = 500;
const TIMEOUT_MS = 30_000;

const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Listening sessions -> media events. Books only for now; podcast sessions are left out. */
export function absEvents(sessions: AbsSession[]): MediaEvent[] {
  return sessions
    .filter((s) => s.mediaType === 'book' && num(s.startedAt) && s.libraryItemId)
    .map((s) => {
      const duration = num(s.duration);
      const at = num(s.currentTime);
      const md = s.mediaMetadata ?? {};
      return {
        source: 'audiobookshelf',
        source_key: `abs:${s.libraryItemId}`,
        media: 'audiobook',
        start: new Date(s.startedAt).toISOString(),
        seconds: num(s.timeListening),
        estimated: false,
        title: md.title || s.displayTitle,
        year: num(md.publishedYear),
        position_pct: duration && at !== null ? Math.min(100, (at / duration) * 100) : null,
        device: s.deviceInfo?.clientName || s.deviceInfo?.deviceName || null,
        ext: { isbn: md.isbn ?? null, asin: md.asin ?? null },
      } satisfies MediaEvent;
    });
}

/** What the sessions say about each book (author, genres, length, series), keyed like the events. */
export function absMeta(sessions: AbsSession[]): Map<string, ItemMeta> {
  const out = new Map<string, ItemMeta>();
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    if (s.mediaType !== 'book' || !s.libraryItemId) continue;
    const md = s.mediaMetadata ?? {};
    const series = md.series?.find((x) => x?.name);
    const duration = num(s.duration);
    out.set(`audiobook:abs:${s.libraryItemId}`, {
      media: 'audiobook',
      title: md.title || s.displayTitle,
      creator: s.displayAuthor || null,
      genres: md.genres ?? [],
      year: num(md.publishedYear),
      runtime: duration ? Math.round(duration / 60) : null,
      collection: series?.name ? { name: series.name, order: num(series.sequence) } : null,
      poster: s.libraryItemId,
      poster_from: 'audiobookshelf',
      ext: { isbn: md.isbn ?? null, asin: md.asin ?? null },
    });
  }
  return out;
}

/** Talks to Audiobookshelf's API with an API token, and keeps the sessions pulled so far. */
@Injectable()
export class AudiobookshelfClient {
  constructor(private readonly files: MediaFiles) {}

  /** Checks the address and token; returns the user name the token belongs to. */
  async test(conn: AbsConnection, signal?: AbortSignal): Promise<string> {
    const me = (await (await this.fetch(conn, '/api/me', signal)).json()) as { username?: string };
    return me.username || 'unknown';
  }

  /**
   * Pulls every listening session (they change while a book is in progress, so the whole list,
   * newest first, page by page) and writes the cache only when something changed.
   */
  async pull(conn: AbsConnection, signal?: AbortSignal): Promise<{ new_rows: number; total: number }> {
    const cache = await this.readCache();
    const known = new Map(cache.sessions.map((s) => [s.id, s]));
    let fresh = 0;
    let changed = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.fetch(conn, `/api/me/listening-sessions?itemsPerPage=${PAGE}&page=${page}`, signal);
      const body = (await res.json()) as { sessions?: AbsSession[]; numPages?: number };
      const sessions = (body.sessions ?? []).filter((s) => s && typeof s.id === 'string' && num(s.startedAt));
      for (const s of sessions) {
        const slim = slimSession(s);
        const before = known.get(s.id);
        if (!before) fresh++;
        if (!before || JSON.stringify(before) !== JSON.stringify(slim)) changed = true;
        known.set(s.id, slim);
      }
      if (!sessions.length || page + 1 >= (body.numPages ?? 0)) break;
    }
    if (changed) {
      const next: AbsCache = {
        sessions: [...known.values()].sort((a, b) => a.startedAt - b.startedAt),
        pulled: logTimestamp(),
      };
      await writeFile(`${this.files.audiobookshelfCache}.part`, JSON.stringify(next), 'utf8');
      await rename(`${this.files.audiobookshelfCache}.part`, this.files.audiobookshelfCache);
    }
    return { new_rows: fresh, total: known.size };
  }

  /** A book's cover. */
  async cover(conn: AbsConnection, libraryItemId: string, signal?: AbortSignal): Promise<Buffer> {
    const res = await this.fetch(conn, `/api/items/${encodeURIComponent(libraryItemId)}/cover`, signal);
    return Buffer.from(await res.arrayBuffer());
  }

  async readCache(): Promise<AbsCache> {
    const c = await readJson<Partial<AbsCache>>(this.files.audiobookshelfCache, {});
    return { sessions: Array.isArray(c.sessions) ? c.sessions : [], pulled: c.pulled ?? null };
  }

  async clearCache(): Promise<void> {
    const empty: AbsCache = { sessions: [], pulled: null };
    await writeFile(this.files.audiobookshelfCache, JSON.stringify(empty), 'utf8');
  }

  private async fetch(conn: AbsConnection, path: string, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(conn.url + path, {
        headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      throw new Error(`Audiobookshelf could not be reached (${(e as Error).message})`);
    }
    if (res.status === 401 || res.status === 403) throw new Error('Audiobookshelf refused the token.');
    if (!res.ok) throw new Error(`HTTP ${res.status} from Audiobookshelf`);
    return res;
  }
}

/** Keeps only the fields the dashboard uses. */
function slimSession(s: AbsSession): AbsSession {
  const md = s.mediaMetadata ?? {};
  return {
    id: s.id,
    libraryItemId: s.libraryItemId,
    mediaType: s.mediaType,
    displayTitle: s.displayTitle,
    displayAuthor: s.displayAuthor ?? null,
    mediaMetadata: {
      title: md.title,
      series: (md.series ?? []).map((x) => ({ name: x?.name, sequence: x?.sequence ?? null })),
      genres: md.genres ?? [],
      publishedYear: md.publishedYear ?? null,
      isbn: md.isbn ?? null,
      asin: md.asin ?? null,
    },
    duration: s.duration ?? null,
    timeListening: s.timeListening ?? null,
    currentTime: s.currentTime ?? null,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt ?? null,
    deviceInfo: s.deviceInfo ? { clientName: s.deviceInfo.clientName, deviceName: s.deviceInfo.deviceName } : null,
  };
}
