import { registerAs, type ConfigType } from '@nestjs/config';

/**
 * Everything the dashboard can be configured with. All of it comes from environment
 * variables (see the README's Settings table), so it works the same in and out of Docker.
 */
export interface AppConfig {
  /** Port to listen on. */
  port: number;
  /** Folder holding inbox/, data/, dav/, covers/, catalogue.json and update.log. */
  library: string;
  /** The public sub-path, e.g. /reading, when a reverse proxy forwards it without stripping it. */
  basePath: string;
  /** Turns on uploads and WebDAV sync; it is the password for both. Empty means off. */
  uploadToken: string;
  /** How often to look for new backups, in seconds. */
  pollSeconds: number;
  /** How many backups to keep in inbox/ (and in dav/). */
  keepBackups: number;
  /** Whether to look up missing covers on Open Library. */
  coverLookup: boolean;
  openLibraryUrl: string;
  openLibraryCoversUrl: string;
  /** Whether to look up publication years, page counts and authors on Open Library and Wikidata. */
  metadataLookup: boolean;
  wikidataUrl: string;
  /** Pause between Open Library lookups, to be polite. */
  coverPauseMs: number;
  /** TMDB, for TV and film posters, genres and runtimes; the admin can also set the key on the page. */
  tmdbApiKey: string;
  tmdbUrl: string;
  tmdbImageUrl: string;
  /** Tautulli, for Plex watch history; the admin can also set these on the page. */
  tautulliUrl: string;
  tautulliApiKey: string;
  /** Audiobookshelf, for audiobook listening sessions; the admin can also set these on the page. */
  audiobookshelfUrl: string;
  audiobookshelfToken: string;
  /** How often to pull new plays from Tautulli (and sessions from Audiobookshelf), in minutes. */
  mediaPollMinutes: number;
  /** How often to refresh friends' data from their installations, in minutes; 0 is never. */
  federationRefreshMinutes: number;
  /** A Mixpanel project token: turns on anonymous page-view and interaction analytics. Empty means off. */
  mixpanelToken: string;
  /** Mixpanel's API host, e.g. https://api-eu.mixpanel.com for EU data residency. */
  mixpanelApiHost: string;
  /** Who should own the files in the library when the container starts as root. */
  puid: number;
  pgid: number;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^-?\d+$/.test(raw)) throw new Error(`${name} must be a whole number, not "${raw}"`);
  return Number(raw);
}

function decimal(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number, not "${raw}"`);
  return n;
}

function onOff(env: NodeJS.ProcessEnv, name: string): boolean {
  return !['off', 'no', 'false', '0'].includes((env[name] ?? 'on').trim().toLowerCase());
}

function url(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return (env[name]?.trim() || fallback).replace(/\/+$/, '');
}

/** Reads and checks the settings. Throws with a readable message when one is invalid. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const base = (env.BASE_PATH ?? '').trim().replace(/^\/+|\/+$/g, '');
  return {
    port: integer(env, 'PORT', 8080),
    library: env.LIBRARY?.trim() || '/library',
    basePath: base ? `/${base}` : '',
    uploadToken: (env.UPLOAD_TOKEN ?? '').trim(),
    pollSeconds: Math.max(5, integer(env, 'POLL_SECONDS', 30)),
    keepBackups: Math.max(1, integer(env, 'KEEP_BACKUPS', 5)),
    coverLookup: onOff(env, 'COVER_LOOKUP'),
    openLibraryUrl: url(env, 'OPENLIBRARY_URL', 'https://openlibrary.org'),
    openLibraryCoversUrl: url(env, 'OPENLIBRARY_COVERS_URL', 'https://covers.openlibrary.org'),
    metadataLookup: onOff(env, 'METADATA_LOOKUP'),
    wikidataUrl: url(env, 'WIKIDATA_URL', 'https://www.wikidata.org'),
    coverPauseMs: decimal(env, 'COVER_PAUSE', 1) * 1000,
    tmdbApiKey: (env.TMDB_API_KEY ?? '').trim(),
    tmdbUrl: url(env, 'TMDB_URL', 'https://api.themoviedb.org/3'),
    tmdbImageUrl: url(env, 'TMDB_IMAGE_URL', 'https://image.tmdb.org/t/p'),
    tautulliUrl: (env.TAUTULLI_URL ?? '').trim().replace(/\/+$/, ''),
    tautulliApiKey: (env.TAUTULLI_API_KEY ?? '').trim(),
    audiobookshelfUrl: (env.AUDIOBOOKSHELF_URL ?? '').trim().replace(/\/+$/, ''),
    audiobookshelfToken: (env.AUDIOBOOKSHELF_TOKEN ?? '').trim(),
    mediaPollMinutes: Math.max(1, integer(env, 'MEDIA_POLL_MINUTES', 60)),
    federationRefreshMinutes: Math.max(0, integer(env, 'FEDERATION_REFRESH_MINUTES', 60)),
    mixpanelToken: (env.MIXPANEL_TOKEN ?? '').trim(),
    mixpanelApiHost: url(env, 'MIXPANEL_API_HOST', 'https://api-js.mixpanel.com'),
    puid: integer(env, 'PUID', 1000),
    pgid: integer(env, 'PGID', 1000),
  };
}

export const appConfig = registerAs('app', () => loadAppConfig());

export type AppConfigType = ConfigType<typeof appConfig>;
