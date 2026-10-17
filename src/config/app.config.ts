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
  /** Pause between Open Library lookups, to be polite. */
  coverPauseMs: number;
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
    coverLookup: !['off', 'no', 'false', '0'].includes(
      (env.COVER_LOOKUP ?? 'on').trim().toLowerCase(),
    ),
    openLibraryUrl: url(env, 'OPENLIBRARY_URL', 'https://openlibrary.org'),
    openLibraryCoversUrl: url(env, 'OPENLIBRARY_COVERS_URL', 'https://covers.openlibrary.org'),
    coverPauseMs: decimal(env, 'COVER_PAUSE', 1) * 1000,
    puid: integer(env, 'PUID', 1000),
    pgid: integer(env, 'PGID', 1000),
  };
}

export const appConfig = registerAs('app', () => loadAppConfig());

export type AppConfigType = ConfigType<typeof appConfig>;
