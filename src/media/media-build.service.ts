import { readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { mtimeMs, newestFirst } from '../common/files';
import { logTimestamp } from '../common/time';
import { CoverStore } from '../covers/cover-store.service';
import { LibraryService } from '../library/library.service';
import { MediaFiles, type StreamingSubscription } from './media-files.service';
import { buildMediaHistory, metaKey } from './media-history';
import type { ItemMeta, MediaEvent, MediaHistory } from './media.types';
import { MediaMetadataService } from './metadata/media-metadata.service';
import { netflixEvents, parseNetflix, type NetflixFile } from './sources/netflix';
import { tautulliEvents, tautulliMeta } from './sources/tautulli';
import { TautulliClient } from './sources/tautulli.client';
import { absEvents, absMeta, AudiobookshelfClient } from './sources/audiobookshelf';

/** The data files the media build writes, media_meta.json last. */
export const MEDIA_FILES = [
  'media_items.json',
  'media_runs.json',
  'media_daily.json',
  'media_sessions.json',
  'media_parts.json',
] as const;
export const MEDIA_META = 'media_meta.json';
export const MEDIA_MONEY = 'media_money.json';
/** See the book build: inputs changed while a build ran are still newer than its meta file. */
const MTIME_MARGIN_MS = 2000;

export interface NetflixInboxFile {
  name: string;
  kind: NetflixFile['kind'] | 'unreadable';
  profiles: string[];
  rows: number;
  modified: string;
}

export interface MediaBuildSummary {
  lines: string[];
  counts: { items: number; sessions: number };
}

/**
 * Builds media_*.json from every media source. It never reads a Moon+ backup or touches the
 * book files, so it runs on its own (see MediaService) and works with no books at all.
 */
@Injectable()
export class MediaBuildService {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly files: MediaFiles,
    private readonly metadata: MediaMetadataService,
    private readonly covers: CoverStore,
    private readonly tautulli: TautulliClient,
    private readonly abs: AudiobookshelfClient,
  ) {}

  /** The newest time any media input changed: uploads, the media catalogue, the settings. */
  async inputsChanged(): Promise<number> {
    const inbox = await this.netflixFiles();
    const times = await Promise.all(
      [
        ...inbox,
        this.files.catalogue,
        this.files.settingsFile,
        this.files.tautulliCache,
        this.files.audiobookshelfCache,
      ].map(mtimeMs),
    );
    return Math.max(0, ...times);
  }

  /** Whether there is anything newer than the last media build. */
  async needsBuild(): Promise<boolean> {
    const changed = await this.inputsChanged();
    return changed > 0 && changed > (await mtimeMs(join(this.library.data, MEDIA_META)));
  }

  /** Uploaded Netflix files, newest first. */
  async netflixFiles(): Promise<string[]> {
    const names = await readdir(this.files.netflixInbox).catch(() => [] as string[]);
    return newestFirst(
      names
        .filter((f) => f.toLowerCase().endsWith('.csv') && !f.startsWith('.'))
        .map((f) => join(this.files.netflixInbox, f)),
    );
  }

  /** What each uploaded Netflix file holds, for the admin. */
  async netflixInbox(): Promise<NetflixInboxFile[]> {
    const out: NetflixInboxFile[] = [];
    for (const path of await this.netflixFiles()) {
      const modified = logTimestamp(new Date(await mtimeMs(path)));
      try {
        const f = parseNetflix(await readFile(path, 'utf8'));
        out.push({
          name: basename(path),
          kind: f.kind,
          profiles: f.profiles,
          rows: f.rows.length,
          modified,
        });
      } catch {
        out.push({ name: basename(path), kind: 'unreadable', profiles: [], rows: 0, modified });
      }
    }
    return out;
  }

  /**
   * The Netflix file to use: the newest full export (it holds the whole history of every
   * profile), else the newest light history file.
   */
  private async netflixSource(): Promise<{ name: string; file: NetflixFile } | null> {
    let light: { name: string; file: NetflixFile } | null = null;
    for (const path of await this.netflixFiles()) {
      let file: NetflixFile;
      try {
        file = parseNetflix(await readFile(path, 'utf8'));
      } catch {
        continue;
      }
      if (file.kind === 'activity') return { name: basename(path), file };
      light ??= { name: basename(path), file };
    }
    return light;
  }

  /** Reads every source and writes the media data. */
  async build(signal?: AbortSignal): Promise<MediaBuildSummary> {
    const started = new Date();
    const settings = await this.files.settings();
    const lines: string[] = [];
    const events: MediaEvent[] = [];
    const sources: Record<string, unknown> = {};

    const netflix = await this.netflixSource();
    if (netflix) {
      const ev = netflixEvents(netflix.file, { profiles: settings.netflix.profiles });
      events.push(...ev);
      const used =
        netflix.file.kind === 'history'
          ? []
          : netflix.file.profiles.length === 1
            ? netflix.file.profiles
            : netflix.file.profiles.filter((p) => settings.netflix.profiles.includes(p));
      sources.netflix = {
        file: netflix.name,
        kind: netflix.file.kind,
        profiles: used,
        rows: ev.length,
      };
      if (netflix.file.kind === 'activity' && !used.length) {
        lines.push(
          `${netflix.name}: ${netflix.file.profiles.length} Netflix profiles found; choose yours in the admin settings to import it`,
        );
      } else {
        lines.push(
          `${netflix.name}: ${ev.length} Netflix plays` +
            (used.length ? ` (${used.join(', ')})` : ''),
        );
      }
    }

    const plex = await this.tautulli.readCache();
    let plexMeta = new Map<string, ItemMeta>();
    if (plex.rows.length) {
      const ev = tautulliEvents(plex.rows);
      events.push(...ev);
      plexMeta = tautulliMeta(plex);
      sources.tautulli = { rows: ev.length, pulled: plex.pulled };
      lines.push(`Tautulli: ${ev.length} Plex plays`);
    }

    const listened = await this.abs.readCache();
    if (listened.sessions.length) {
      const ev = absEvents(listened.sessions);
      events.push(...ev);
      for (const [k, m] of absMeta(listened.sessions)) plexMeta.set(k, m);
      sources.audiobookshelf = { rows: ev.length, pulled: listened.pulled };
      lines.push(`Audiobookshelf: ${ev.length} listening sessions`);
    }

    const key = await this.files.tmdbKey();
    const meta = new Map<string, ItemMeta>();
    // Plex and Audiobookshelf know their own titles; TMDB fills in the rest
    const forTmdb = events.filter((e) => !plexMeta.has(metaKey(e)));
    if (forTmdb.length) {
      const r = await this.metadata.resolve(forTmdb, this.files.cache, key, signal);
      for (const [k, m] of r.meta) meta.set(k, m);
      if (r.looked_up) lines.push(`Looked up ${r.looked_up} title(s) on TMDB, found ${r.found}`);
      if (r.error)
        lines.push(`Stopped TMDB lookups: ${r.error}. The rest are tried on the next build.`);
    }

    for (const [k, m] of plexMeta) meta.set(k, m);
    const itemKeys = new Map<string, string>();
    const catalogue = await this.files.readCatalogue();
    const history = buildMediaHistory(events, { meta, catalogue, itemKeys });
    await this.write(history, sources, settings.subscriptions);
    const builtFrom = new Date(started.getTime() - MTIME_MARGIN_MS);
    await utimes(join(this.library.data, MEDIA_META), builtFrom, builtFrom);
    const counts = { items: history.items.length, sessions: history.sessions.length };
    lines.push(
      `Media: ${counts.items} seasons, films and audiobooks, ${counts.sessions} sittings, ${history.daily.length} days`,
    );
    if (history.items.length) {
      const posters = await this.fetchPosters(history, meta, itemKeys, Boolean(key), signal);
      if (posters) lines.push(`Saved ${posters} poster(s)`);
    }
    return { lines, counts };
  }

  private async write(
    history: MediaHistory,
    sources: Record<string, unknown>,
    subscriptions: StreamingSubscription[],
  ): Promise<void> {
    const data = this.library.data;
    const empty = !history.items.length;
    const rows: Record<(typeof MEDIA_FILES)[number], unknown[]> = {
      'media_items.json': history.items,
      'media_runs.json': history.runs,
      'media_daily.json': history.daily,
      'media_sessions.json': history.sessions,
      'media_parts.json': history.parts,
    };
    // the subscriptions on their own, so the privacy settings treat them as money
    await dump(join(data, MEDIA_MONEY), subscriptions);
    for (const name of MEDIA_FILES) {
      const path = join(data, name);
      // nothing to show (no profile chosen yet): no files, so the page doesn't offer an empty tab
      if (empty) await rm(path, { force: true });
      else await dump(path, rows[name]);
    }
    await dump(join(data, MEDIA_META), {
      generated: logTimestamp(),
      sources,
      counts: { items: history.items.length, sessions: history.sessions.length },
    });
  }

  /** Posters and covers (through Tautulli or Audiobookshelf, or from TMDB) for items without a cover, keyed by item id like book covers. */
  private async fetchPosters(
    history: MediaHistory,
    meta: Map<string, ItemMeta>,
    itemKeys: Map<string, string>,
    tmdb: boolean,
    signal?: AbortSignal,
  ): Promise<number> {
    const have = await this.covers.existing();
    const conn = await this.files.tautulli();
    const absConn = await this.files.audiobookshelf();
    const ready = { tmdb, tautulli: Boolean(conn), audiobookshelf: Boolean(absConn) };
    const down = new Set<string>();
    let saved = 0;
    for (const item of history.items) {
      if (have.has(item.id) || signal?.aborted) continue;
      const m = meta.get(itemKeys.get(item.id) ?? '');
      const season = item.media === 'tv' ? m?.seasons?.[String(item.series_no)]?.poster : null;
      const path = season ?? m?.poster;
      const from = m?.poster_from ?? 'tmdb';
      if (!path || down.has(from) || !ready[from]) continue;
      try {
        if (saved) await sleep(this.config.coverPauseMs, undefined, { signal });
        const image =
          from === 'tautulli'
            ? await this.tautulli.poster(conn!, path, signal)
            : from === 'audiobookshelf'
              ? await this.abs.cover(absConn!, path, signal)
              : await this.metadata.poster(path, signal);
        if (await this.covers.save(item.id, image)) saved++;
      } catch {
        down.add(from); // can't be reached: the rest are tried on the next build
      }
    }
    return saved;
  }
}

async function dump(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.tmp`, JSON.stringify(value), 'utf8');
  await rename(`${path}.tmp`, path);
}
