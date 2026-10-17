import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../../config/app.config';
import type { ItemMeta, SeasonMeta } from '../media.types';

const TIMEOUT_MS = 20_000;

interface Named {
  name: string;
}

interface TvSearchResult {
  id: number;
  name: string;
  original_name?: string;
  first_air_date?: string;
}

interface MovieSearchResult {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
}

interface TvDetails {
  id: number;
  name: string;
  created_by?: Named[];
  networks?: Named[];
  genres?: Named[];
  first_air_date?: string;
  episode_run_time?: number[];
  poster_path?: string | null;
  seasons?: { season_number: number; episode_count: number; poster_path?: string | null }[];
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
}

interface SeasonDetails {
  episodes?: { episode_number: number; name: string; runtime?: number | null }[];
}

interface MovieDetails {
  id: number;
  title: string;
  genres?: Named[];
  runtime?: number | null;
  release_date?: string;
  imdb_id?: string | null;
  poster_path?: string | null;
  belongs_to_collection?: { id: number; name: string } | null;
  credits?: { crew?: { job: string; name: string }[] };
}

/** Lower-case letters and digits only, for comparing titles. */
const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

/** The result whose title matches exactly, else the first one (TMDB ranks by popularity). */
function best<T>(results: T[], title: string, names: (r: T) => (string | undefined)[]): T | null {
  const want = norm(title);
  return results.find((r) => names(r).some((n) => n && norm(n) === want)) ?? results[0] ?? null;
}

/**
 * The Movie Database (themoviedb.org), v3 API. A v3 key goes in api_key=; a v4 read access
 * token (it starts "eyJ") as a bearer token. Every method throws when TMDB can't be reached.
 */
@Injectable()
export class TmdbClient {
  constructor(@Inject(appConfig.KEY) private readonly config: AppConfigType) {}

  /** A show by title, with the episodes of the given seasons. Null when TMDB doesn't know it. */
  async show(
    key: string,
    title: string,
    seasons: number[],
    signal?: AbortSignal,
  ): Promise<ItemMeta | null> {
    const found = await this.get<{ results?: TvSearchResult[] }>(
      key,
      'search/tv',
      { query: title },
      signal,
    );
    const hit = best(found.results ?? [], title, (r) => [r.name, r.original_name]);
    if (!hit) return null;
    const tv = await this.get<TvDetails>(
      key,
      `tv/${hit.id}`,
      { append_to_response: 'external_ids' },
      signal,
    );
    const out: Record<string, SeasonMeta> = {};
    for (const s of tv.seasons ?? []) {
      out[String(s.season_number)] = { episodes: s.episode_count, poster: s.poster_path ?? null };
    }
    for (const n of seasons) {
      if (!out[String(n)]) continue;
      const season = await this.get<SeasonDetails>(key, `tv/${hit.id}/season/${n}`, {}, signal);
      const titles: Record<string, number> = {};
      const runtimes: Record<string, number> = {};
      for (const e of season.episodes ?? []) {
        titles[e.name.toLowerCase()] = e.episode_number;
        if (e.runtime) runtimes[String(e.episode_number)] = e.runtime;
      }
      out[String(n)] = { ...out[String(n)], titles, runtimes };
    }
    return {
      media: 'tv',
      title: tv.name,
      creator: tv.created_by?.[0]?.name ?? tv.networks?.[0]?.name ?? null,
      genres: (tv.genres ?? []).map((g) => g.name),
      year: yearOf(tv.first_air_date),
      runtime: tv.episode_run_time?.[0] ?? null,
      seasons: out,
      poster: tv.poster_path ?? null,
      ext: {
        tmdb_id: tv.id,
        imdb_id: tv.external_ids?.imdb_id ?? null,
        tvdb_id: tv.external_ids?.tvdb_id ?? null,
      },
    };
  }

  /** A film by title (and year, when known). Null when TMDB doesn't know it. */
  async film(
    key: string,
    title: string,
    year: number | null,
    signal?: AbortSignal,
  ): Promise<ItemMeta | null> {
    const q: Record<string, string> = { query: title };
    if (year) q.year = String(year);
    const found = await this.get<{ results?: MovieSearchResult[] }>(key, 'search/movie', q, signal);
    const results = found.results ?? [];
    // a film must match by title: a colon title with no exact match may be a show instead
    const hit = results.find((r) =>
      [r.title, r.original_title].some((n) => n && norm(n) === norm(title)),
    );
    if (!hit) return null;
    const m = await this.get<MovieDetails>(
      key,
      `movie/${hit.id}`,
      { append_to_response: 'credits' },
      signal,
    );
    const director = m.credits?.crew?.find((c) => c.job === 'Director')?.name ?? null;
    return {
      media: 'film',
      title: m.title,
      creator: director,
      genres: (m.genres ?? []).map((g) => g.name),
      year: yearOf(m.release_date),
      runtime: m.runtime || null,
      collection: m.belongs_to_collection ? { name: m.belongs_to_collection.name } : null,
      poster: m.poster_path ?? null,
      ext: { tmdb_id: m.id, imdb_id: m.imdb_id ?? null },
    };
  }

  /** A poster, at the size the dashboard shows. */
  async poster(path: string, signal?: AbortSignal): Promise<Buffer> {
    const res = await this.fetch(`${this.config.tmdbImageUrl}/w342${path}`, {}, signal);
    return Buffer.from(await res.arrayBuffer());
  }

  private async get<T>(
    key: string,
    path: string,
    query: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    const bearer = key.startsWith('eyJ');
    const params = new URLSearchParams(bearer ? query : { ...query, api_key: key });
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${key}`;
    const res = await this.fetch(`${this.config.tmdbUrl}/${path}?${params}`, headers, signal);
    return (await res.json()) as T;
  }

  private async fetch(url: string, headers: Record<string, string>, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch(url, {
      headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res;
  }
}
