import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { firstIsbn } from '../metadata/isbn';

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

/** A work in an author's list, with the fields the bibliography lookup asks for. */
export interface AuthorWorkDoc {
  key?: string;
  title?: string;
  first_publish_year?: number;
  edition_count?: number;
  /** The languages of its editions (three-letter MARC codes: eng, fre, ger…). */
  language?: string[];
  isbn?: string[];
}

/** An author as Open Library's author search returns them. */
export interface AuthorDoc {
  key?: string;
  name?: string;
  work_count?: number;
}

/** A book as the admin's want-to-read search shows it (BOO-102). */
export interface BookCandidate {
  title: string;
  author: string;
  published_year: number | null;
  work_id: string | null;
  isbn13: string | null;
  pages: number | null;
  cover_id: number | null;
}

interface CandidateDoc extends WorkDoc {
  cover_i?: number;
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

  /**
   * Books matching what the admin typed (title, author, or both), best first: up to `limit`
   * works, each with its first ISBN-13 when it has one. Throws when Open Library can't be
   * reached.
   */
  async searchBooks(q: string, limit = 10, signal?: AbortSignal): Promise<BookCandidate[]> {
    const query = new URLSearchParams({
      q,
      fields: 'key,title,author_name,first_publish_year,number_of_pages_median,isbn,cover_i',
      limit: String(limit),
    });
    const body = await this.get(`${this.config.openLibraryUrl}/search.json?${query}`, signal);
    const docs = (JSON.parse(body.toString('utf8')) as { docs?: CandidateDoc[] }).docs ?? [];
    return docs
      .filter((d) => d.title)
      .slice(0, limit)
      .map((d) => ({
        title: d.title!,
        author: (d.author_name ?? []).slice(0, 3).join(' & '),
        published_year: d.first_publish_year ?? null,
        work_id: d.key?.replace(/^\/works\//, '') || null,
        isbn13: firstIsbn(d.isbn)?.isbn13 ?? null,
        pages: d.number_of_pages_median ?? null,
        cover_id: d.cover_i ?? null,
      }));
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

  /**
   * An author's works, those with the most editions first (at most 100): for the
   * bibliography lookup. Empty when the key isn't an author key.
   */
  async authorWorks(authorKey: string, signal?: AbortSignal): Promise<AuthorWorkDoc[]> {
    const key = authorKey.replace(/^\/?authors\//, '');
    if (!/^OL\d+A$/.test(key)) return [];
    const query = new URLSearchParams({
      author_key: key,
      fields: 'key,title,first_publish_year,edition_count,language,isbn',
      sort: 'editions',
      limit: '100',
    });
    const body = await this.get(`${this.config.openLibraryUrl}/search.json?${query}`, signal);
    const docs = (JSON.parse(body.toString('utf8')) as { docs?: unknown }).docs;
    return Array.isArray(docs) ? (docs as AuthorWorkDoc[]) : [];
  }

  /**
   * The works in a subject (e.g. "fantasy"), most popular first as Open Library lists them
   * (at most 50): for the genre picks (BOO-105). The raw `works` list, or [] when the
   * subject is unknown (404) or the answer has none; throws when it can't be reached.
   */
  async subjectWorks(slug: string, signal?: AbortSignal): Promise<unknown[]> {
    if (!/^[a-z0-9_]+$/.test(slug)) return [];
    let body: Buffer;
    try {
      body = await this.get(`${this.config.openLibraryUrl}/subjects/${slug}.json?limit=50`, signal);
    } catch (e) {
      if ((e as Error).message.startsWith('HTTP 404 ')) return [];
      throw e;
    }
    const parsed = JSON.parse(body.toString('utf8')) as { works?: unknown } | null;
    return Array.isArray(parsed?.works) ? parsed.works : [];
  }

  /** Authors whose name matches, Open Library's best guess first (at most 5). */
  async searchAuthors(name: string, signal?: AbortSignal): Promise<AuthorDoc[]> {
    const query = new URLSearchParams({ q: name, limit: '5' });
    const body = await this.get(
      `${this.config.openLibraryUrl}/search/authors.json?${query}`,
      signal,
    );
    const docs = (JSON.parse(body.toString('utf8')) as { docs?: unknown }).docs;
    return Array.isArray(docs) ? (docs as AuthorDoc[]) : [];
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
