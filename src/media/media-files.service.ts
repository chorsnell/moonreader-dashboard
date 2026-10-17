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
}

/** Where other media live in the library: uploads, caches, manual fixes and settings. */
@Injectable()
export class MediaFiles implements OnModuleInit {
  readonly root: string;
  readonly netflixInbox: string;
  readonly cache: string;
  readonly catalogue: string;
  readonly settingsFile: string;
  private saving = Promise.resolve();

  constructor(@Inject(appConfig.KEY) private readonly config: AppConfigType) {
    this.root = join(config.library, 'media');
    this.netflixInbox = join(this.root, 'inbox', 'netflix');
    this.cache = join(this.root, 'cache');
    this.catalogue = join(this.root, 'catalogue.json');
    this.settingsFile = join(this.root, 'settings.json');
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
      tmdb: { api_key: typeof raw.tmdb?.api_key === 'string' ? raw.tmdb.api_key : '' },
    };
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

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
