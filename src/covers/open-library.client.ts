import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';

const AGENT = 'moonreader-dashboard (+https://github.com/chorsnell/moonreader-dashboard)';
const TIMEOUT_MS = 20_000;

interface SearchDoc {
  title?: string;
  cover_i?: number;
}

/** A work as Open Library's search returns it, with the fields the metadata lookup asks for. */
export interface WorkDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  number_of_pages_median?: number;
  isbn?: string[];
  /** The work's subjects ("Science fiction", "Space warfare"…), used to suggest a genre. */
  subject?: string[];
}

const WORK_FIELDS =
  'key,title,author_name,author_key,first_publish_year,number_of_pages_median,isbn,subject';

/** GETs a URL as this app (as the APIs ask), with a timeout. Throws on a failed request. */
export async function httpGet(url: string, signal?: AbortSignal): Promise<Buffer> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, {
    headers: { 'User-Agent': AGENT },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Lower-case ASCII words only, and only the part before any subtitle or bracket. */
export function normaliseTitle(s: string | undefined): string {
  const ascii = (s ?? '')
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, '')
    .toLowerCase();
  return ascii
    .split(/[:([]/)[0]
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Moon+ authors look like "King, Stephen & Straub, Peter": the first one's surname. */
export function firstSurname(author: string): string {
  const first = author.split(/\s*(?:&|;| and )\s*/)[0];
  if (first.includes(',')) return first.split(',')[0].trim();
  const words = first.split(/\s+/).filter(Boolean);
  return words.length ? words[words.length - 1] : '';
}

/** Talks to openlibrary.org. Every method throws when it can't be reached. */
@Injectable()
export class OpenLibraryClient {
  constructor(@Inject(appConfig.KEY) private readonly config: AppConfigType) {}

  /** The Open Library cover id for a book, or null. */
  async findCover(title: string, author: string, signal?: AbortSignal): Promise<number | null> {
    const short = title.split(/\s*[:([]/)[0].trim() || title;
    if (author) {
      const q = { title: short, author: firstSurname(author) };
      for (const d of await this.search<SearchDoc>(q, 'cover_i,title', signal)) {
        if (d.cover_i) return d.cover_i;
      }
    }
    // without an author, only trust an exact title match
    for (const d of await this.search<SearchDoc>({ title: short }, 'cover_i,title', signal)) {
      if (d.cover_i && normaliseTitle(d.title) === normaliseTitle(short)) return d.cover_i;
    }
    return null;
  }

  /**
   * The work a book belongs to: by ISBN when there is one, otherwise by title and the first
   * author's surname (or, without an author, an exact title match). Null if not found.
   */
  async findWork(
    title: string,
    author: string,
    isbn13: string | null,
    signal?: AbortSignal,
  ): Promise<WorkDoc | null> {
    if (isbn13) {
      const [doc] = await this.search<WorkDoc>({ isbn: isbn13 }, WORK_FIELDS, signal);
      if (doc?.key) return doc;
    }
    const short = title.split(/\s*[:([]/)[0].trim() || title;
    if (author) {
      const docs = await this.search<WorkDoc>(
        { title: short, author: firstSurname(author) },
        WORK_FIELDS,
        signal,
      );
      return docs.find((d) => d.key) ?? null;
    }
    const docs = await this.search<WorkDoc>({ title: short }, WORK_FIELDS, signal);
    return docs.find((d) => d.key && normaliseTitle(d.title) === normaliseTitle(short)) ?? null;
  }

  /** The Wikidata item an Open Library author record links to, or null. */
  async authorWikidata(authorKey: string, signal?: AbortSignal): Promise<string | null> {
    const key = authorKey.replace(/^\/?authors\//, '');
    if (!/^OL\d+A$/.test(key)) return null;
    const body = await this.get(`${this.config.openLibraryUrl}/authors/${key}.json`, signal);
    const id = (JSON.parse(body.toString('utf8')) as { remote_ids?: { wikidata?: string } })
      .remote_ids?.wikidata;
    return id && /^Q\d+$/.test(id) ? id : null;
  }

  /**
   * The subjects of a work, from its record (e.g. /works/OL66562W.json). An empty list when
   * the work has none or Open Library no longer knows it; throws when it can't be reached.
   */
  async workSubjects(workId: string, signal?: AbortSignal): Promise<string[]> {
    const id = workId.replace(/^\/?works\//, '');
    if (!/^OL\d+W$/.test(id)) return [];
    let body: Buffer;
    try {
      body = await this.get(`${this.config.openLibraryUrl}/works/${id}.json`, signal);
    } catch (e) {
      if ((e as Error).message.startsWith('HTTP 404 ')) return [];
      throw e;
    }
    const subjects = (JSON.parse(body.toString('utf8')) as { subjects?: unknown }).subjects;
    return Array.isArray(subjects)
      ? subjects.filter((s): s is string => typeof s === 'string')
      : [];
  }

  /** The medium-size image for a cover id. */
  async coverImage(coverId: number, signal?: AbortSignal): Promise<Buffer> {
    return this.get(
      `${this.config.openLibraryCoversUrl}/b/id/${coverId}-M.jpg?default=false`,
      signal,
    );
  }

  private async search<T>(
    q: Record<string, string>,
    fields: string,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const query = new URLSearchParams({ ...q, fields, limit: '5' });
    const body = await this.get(`${this.config.openLibraryUrl}/search.json?${query}`, signal);
    return (JSON.parse(body.toString('utf8')) as { docs?: T[] }).docs ?? [];
  }

  private get(url: string, signal?: AbortSignal): Promise<Buffer> {
    return httpGet(url, signal);
  }
}
