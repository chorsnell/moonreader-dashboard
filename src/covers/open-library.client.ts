import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';

const AGENT = 'moonreader-dashboard (+https://github.com/chorsnell/moonreader-dashboard)';
const TIMEOUT_MS = 20_000;

interface SearchDoc {
  title?: string;
  cover_i?: number;
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
      for (const d of await this.search({ title: short, author: firstSurname(author) }, signal)) {
        if (d.cover_i) return d.cover_i;
      }
    }
    // without an author, only trust an exact title match
    for (const d of await this.search({ title: short }, signal)) {
      if (d.cover_i && normaliseTitle(d.title) === normaliseTitle(short)) return d.cover_i;
    }
    return null;
  }

  /** The medium-size image for a cover id. */
  async coverImage(coverId: number, signal?: AbortSignal): Promise<Buffer> {
    return this.get(
      `${this.config.openLibraryCoversUrl}/b/id/${coverId}-M.jpg?default=false`,
      signal,
    );
  }

  private async search(q: Record<string, string>, signal?: AbortSignal): Promise<SearchDoc[]> {
    const query = new URLSearchParams({ ...q, fields: 'cover_i,title', limit: '5' });
    const body = await this.get(`${this.config.openLibraryUrl}/search.json?${query}`, signal);
    return (JSON.parse(body.toString('utf8')) as { docs?: SearchDoc[] }).docs ?? [];
  }

  private async get(url: string, signal?: AbortSignal): Promise<Buffer> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { 'User-Agent': AGENT },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
