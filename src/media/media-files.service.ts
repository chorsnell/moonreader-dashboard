import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import type { MediaCatalogue } from './media.types';

/**
 * library/media/settings.json: the admin's choices for other media. Kept apart from
 * settings.json (access) so neither rewrites the other, and never served to readers.
 */
export interface MediaSettings {
  netflix: { profiles: string[] };
  tmdb: { api_key: string };
  /** Plex through Tautulli; user_id limits it to one Plex user (empty: everyone). */
  tautulli: { url: string; api_key: string; user_id: string };
}

/** Where other media live in the library: uploads, caches, manual fixes and settings. */
@Injectable()
export class MediaFiles implements OnModuleInit {
  readonly root: string;
  readonly netflixInbox: string;
  readonly cache: string;
  readonly catalogue: string;
  readonly settingsFile: string;
  /** Plays pulled from Tautulli so far, so a rebuild never pulls them again. */
  readonly tautulliCache: string;
  private saving = Promise.resolve();

  constructor(@Inject(appConfig.KEY) private readonly config: AppConfigType) {
    this.root = join(config.library, 'media');
    this.netflixInbox = join(this.root, 'inbox', 'netflix');
    this.cache = join(this.root, 'cache');
    this.catalogue = join(this.root, 'catalogue.json');
    this.settingsFile = join(this.root, 'settings.json');
    this.tautulliCache = join(this.cache, 'tautulli.json');
  }

  async onModuleInit(): Promise<void> {
    for (const dir of [this.netflixInbox, this.cache]) await mkdir(dir, { recursive: true });
  }

  async settings(): Promise<MediaSettings> {
    const raw = await readJson<Partial<MediaSettings>>(this.settingsFile, {});
    const profiles = raw.netflix?.profiles;
    return {
      netflix: {
        profiles: Array.isArray(profiles) ? profiles.filter((p) => typeof p === 'string') : [],
      },
      tmdb: { api_key: str(raw.tmdb?.api_key) },
      tautulli: {
        url: str(raw.tautulli?.url),
        api_key: str(raw.tautulli?.api_key),
        user_id: str(raw.tautulli?.user_id),
      },
    };
  }

  /** Tautulli's address and key: the admin's, else TAUTULLI_URL / TAUTULLI_API_KEY. Null when not set up. */
  async tautulli(): Promise<{ url: string; api_key: string; user_id: string } | null> {
    const t = (await this.settings()).tautulli;
    const url = (t.url || this.config.tautulliUrl).replace(/\/+$/, '');
    const key = t.api_key || this.config.tautulliApiKey;
    return url && key ? { url, api_key: key, user_id: t.user_id } : null;
  }

  /** The TMDB key: the admin's, else TMDB_API_KEY. Empty means no lookups. */
  async tmdbKey(): Promise<string> {
    return (await this.settings()).tmdb.api_key || this.config.tmdbApiKey;
  }

  /** Merges a change into the settings and saves them, one save at a time. */
  update(change: (s: MediaSettings) => void): Promise<MediaSettings> {
    const next = this.saving.then(async () => {
      const s = await this.settings();
      change(s);
      await mkdir(this.root, { recursive: true });
      await writeFile(`${this.settingsFile}.part`, JSON.stringify(s, null, 2), 'utf8');
      await rename(`${this.settingsFile}.part`, this.settingsFile);
      return s;
    });
    this.saving = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async readCatalogue(): Promise<MediaCatalogue> {
    const raw = await readJson<MediaCatalogue>(this.catalogue, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }
}

const str = (x: unknown) => (typeof x === 'string' ? x : '');

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
