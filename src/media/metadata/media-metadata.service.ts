import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { localDate } from '../../common/time';
import { readJson } from '../media-files.service';
import { metaKey } from '../media-history';
import type { ItemMeta, MediaEvent } from '../media.types';
import { TmdbClient } from './tmdb.client';

/** Titles TMDB didn't know are tried again after this many days, like covers. */
export const META_RETRY_DAYS = 30;
/** Give up for this build after this many lookups in a row fail to reach TMDB. */
const MAX_FAILURES = 3;

type CacheEntry = { meta: ItemMeta; seasons?: number[] } | { miss: string };
type Cache = Record<string, CacheEntry>;

export interface MetadataResult {
  meta: Map<string, ItemMeta>;
  looked_up: number;
  found: number;
  /** Why lookups stopped early, when they did. */
  error: string | null;
}

/**
 * Looks shows and films up on TMDB, once each, and caches the answers (and misses) in
 * library/media/cache/tmdb.json. Without a key, or when TMDB can't be reached, it returns
 * what the cache has and the build carries on: metadata is never required.
 */
@Injectable()
export class MediaMetadataService {
  constructor(private readonly tmdb: TmdbClient) {}

  async resolve(
    events: MediaEvent[],
    cacheDir: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<MetadataResult> {
    const file = join(cacheDir, 'tmdb.json');
    const cache = await readJson<Cache>(file, {});
    const result: MetadataResult = { meta: new Map(), looked_up: 0, found: 0, error: null };
    const wanted = new Map<string, { ev: MediaEvent; seasons: Set<number> }>();
    for (const ev of events) {
      if (ev.media !== 'tv' && ev.media !== 'film') continue;
      const k = metaKey(ev);
      const w = wanted.get(k) ?? { ev, seasons: new Set<number>() };
      if (ev.media === 'tv') w.seasons.add(ev.season ?? 1);
      wanted.set(k, w);
    }
    const retryFrom = localDate(new Date(Date.now() - META_RETRY_DAYS * 86_400_000));
    let failures = 0;
    let dirty = false;
    for (const [k, { ev, seasons }] of wanted) {
      const hit = cache[k];
      const needSeasons = [...seasons].filter(
        (n) => !(hit && 'meta' in hit && (hit.seasons ?? []).includes(n)),
      );
      const fresh = hit && ('meta' in hit ? !needSeasons.length : hit.miss >= retryFrom);
      if (fresh || !key || result.error || signal?.aborted) {
        if (hit && 'meta' in hit) result.meta.set(k, hit.meta);
        continue;
      }
      try {
        result.looked_up++;
        const known = hit && 'meta' in hit ? (hit.seasons ?? []) : [];
        const all = [...new Set([...known, ...seasons])];
        const meta = await this.lookUp(key, ev, all, signal);
        failures = 0;
        dirty = true;
        if (meta) {
          cache[k] = { meta, seasons: all };
          result.meta.set(k, meta);
          result.found++;
        } else {
          cache[k] = { miss: localDate() };
        }
      } catch (e) {
        if (signal?.aborted) break;
        if (hit && 'meta' in hit) result.meta.set(k, hit.meta);
        if (++failures >= MAX_FAILURES) result.error = (e as Error).message;
      }
    }
    if (dirty) {
      await writeFile(`${file}.part`, JSON.stringify(cache), 'utf8');
      await rename(`${file}.part`, file);
    }
    return result;
  }

  poster(path: string, signal?: AbortSignal): Promise<Buffer> {
    return this.tmdb.poster(path, signal);
  }

  /** A show, a film, or a colon title that turns out to be a show ("Show: Episode"). */
  private async lookUp(
    key: string,
    ev: MediaEvent,
    seasons: number[],
    signal?: AbortSignal,
  ): Promise<ItemMeta | null> {
    if (ev.media === 'tv') {
      return this.tmdb.show(
        key,
        ev.series_title ?? ev.title,
        seasons.length ? seasons : [1],
        signal,
      );
    }
    const film = await this.tmdb.film(key, ev.title, ev.year ?? null, signal);
    if (film || !ev.title.includes(': ')) return film;
    return this.tmdb.show(key, ev.title.slice(0, ev.title.indexOf(': ')), [1], signal);
  }
}
