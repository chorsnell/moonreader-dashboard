import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { localDateTime } from '../common/time';
import { parseIsbn } from '../metadata/isbn';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { type ArrAuthor, type ArrBook, ArrClient, ArrError } from './arr.client';
import { authorKey, bookKey, seriesKey, seriesOf, titleKey } from './match';

/** Where a book stands in the book manager. */
export type ArrStatus = 'available' | 'downloading' | 'wanted' | 'in_library';

/** settings.json's "arr" section. Only ever read by admin-only endpoints. */
export interface ArrSettings {
  url: string;
  api_key: string;
}

export interface BookRequest {
  title?: string;
  author: string;
  isbn13?: string | null;
  series?: string | null;
  series_no?: number | null;
}

/** One request the dashboard sent, kept in library/arr-requests.json. */
export interface RequestRecord {
  time: string;
  kind: 'book' | 'series' | 'author';
  title: string | null;
  author: string;
  series: string | null;
  series_no: number | null;
  outcome: string;
  arr_title: string | null;
}

interface Snapshot {
  at: number;
  books: ArrBook[];
  downloading: Set<number>;
}

/** How long a look at the book manager's library is reused. */
const CACHE_MS = 30_000;
const MAX_REQUESTS = 500;

/**
 * Talks to the admin's own *arr book manager (Readarr's v1 API: Readarr forks such as
 * Bookshelf): where the dashboard's books stand there, and requests for the next book in a
 * series or the rest of an author. The dashboard only sends requests to that instance; the
 * book manager does any searching and downloading.
 */
@Injectable()
export class ArrService {
  private snapshot: Snapshot | null = null;
  private readonly requestsFile: string;

  constructor(
    private readonly settings: AccessSettingsService,
    private readonly library: LibraryService,
    private readonly activity: ActivityLogService,
  ) {
    this.requestsFile = join(library.root, 'arr-requests.json');
  }

  async config(): Promise<ArrSettings | null> {
    const raw = (await this.settings.section('arr')) as Partial<ArrSettings> | undefined;
    return raw &&
      typeof raw.url === 'string' &&
      raw.url &&
      typeof raw.api_key === 'string' &&
      raw.api_key
      ? { url: raw.url, api_key: raw.api_key }
      : null;
  }

  /** Saves the connection (keeping the key when none is given) and checks it works. */
  async configure(url: string, apiKey: string | undefined) {
    const prev = await this.config();
    const key = apiKey || prev?.api_key || '';
    if (!key) throw new ArrError('Give the API key (Settings → General in the book manager).');
    const status = await new ArrClient(url, key).status();
    await this.settings.saveSection('arr', { url, api_key: key });
    this.snapshot = null;
    this.activity.record({
      type: 'settings',
      message:
        `Book manager connected: ${status?.appName ?? 'unknown'} ${status?.version ?? ''}`.trim(),
      trigger: 'admin',
      details: { url, app: status?.appName ?? null, version: status?.version ?? null },
    });
    return { app: status?.appName ?? null, version: status?.version ?? null };
  }

  async disconnect(): Promise<void> {
    await this.settings.saveSection('arr', undefined);
    this.snapshot = null;
    this.activity.record({
      type: 'settings',
      message: 'Book manager disconnected',
      trigger: 'admin',
    });
  }

  private async client(): Promise<ArrClient> {
    const c = await this.config();
    if (!c) throw new ArrError('No book manager is set up yet (Admin → Book manager).', 409);
    return new ArrClient(c.url, c.api_key);
  }

  private async look(fresh = false): Promise<Snapshot> {
    if (!fresh && this.snapshot && Date.now() - this.snapshot.at < CACHE_MS) return this.snapshot;
    const client = await this.client();
    const [books, downloading] = await Promise.all([client.books(), client.queue()]);
    this.snapshot = { at: Date.now(), books: books ?? [], downloading };
    return this.snapshot;
  }

  private statusOf(b: ArrBook, s: Snapshot): ArrStatus {
    if ((b.statistics?.bookFileCount ?? 0) > 0) return 'available';
    if (b.id != null && s.downloading.has(b.id)) return 'downloading';
    return b.monitored ? 'wanted' : 'in_library';
  }

  /** The book manager's book for a dashboard book: by ISBN, then title and author, then series and number. */
  private find(s: Snapshot, q: BookRequest): ArrBook | undefined {
    const isbn = parseIsbn(q.isbn13)?.isbn13;
    const author = authorKey(q.author);
    const by = (b: ArrBook) => authorKey(b.author?.authorName ?? b.authorTitle ?? '') === author;
    if (isbn) {
      const hit = s.books.find((b) =>
        (b.editions ?? []).some((e) => parseIsbn(e.isbn13)?.isbn13 === isbn),
      );
      if (hit) return hit;
    }
    if (q.title) {
      const key = bookKey(q.title, q.author);
      const hit = s.books.find(
        (b) => bookKey(b.title, b.author?.authorName ?? b.authorTitle ?? '') === key,
      );
      if (hit) return hit;
    }
    if (q.series && q.series_no != null) {
      const want = seriesKey(q.series);
      return s.books.find((b) => {
        const sr = seriesOf(b.seriesTitle);
        return sr?.series === want && sr.no === q.series_no && by(b);
      });
    }
    return undefined;
  }

  /** Where each of the dashboard's books stands, and the book manager's books in its series. */
  async dashboardStatus() {
    const s = await this.look();
    let books: {
      id: string;
      title: string;
      author: string;
      series?: string | null;
      isbn13?: string | null;
    }[] = [];
    try {
      books = JSON.parse(
        await readFile(join(this.library.data, 'books.json'), 'utf8'),
      ) as typeof books;
    } catch {
      // no data yet
    }
    const statuses: Record<string, { status: ArrStatus; title: string }> = {};
    const mine = new Set<string>();
    for (const b of books) {
      mine.add(bookKey(b.title, b.author));
      const hit = this.find(s, b);
      if (hit) statuses[b.id] = { status: this.statusOf(hit, s), title: hit.title };
    }
    const seriesNames = new Map<string, string>();
    for (const b of books) if (b.series) seriesNames.set(seriesKey(b.series), b.series);
    const series: Record<
      string,
      { no: number; title: string; status: ArrStatus; read: boolean }[]
    > = {};
    for (const b of s.books) {
      const sr = seriesOf(b.seriesTitle);
      const name = sr && seriesNames.get(sr.series);
      if (!sr || !name) continue;
      (series[name] ??= []).push({
        no: sr.no,
        title: b.title,
        status: this.statusOf(b, s),
        read: mine.has(bookKey(b.title, b.author?.authorName ?? b.authorTitle ?? '')),
      });
    }
    for (const list of Object.values(series)) list.sort((a, b) => a.no - b.no);
    return { books: statuses, series, requests: (await this.requests()).slice(-200) };
  }

  /** The book manager's books by an author, and whether each is in the dashboard. */
  async authorBooks(name: string) {
    const s = await this.look();
    const key = authorKey(name);
    let mine = new Set<string>();
    try {
      const books = JSON.parse(await readFile(join(this.library.data, 'books.json'), 'utf8')) as {
        title: string;
        author: string;
      }[];
      mine = new Set(books.map((b) => bookKey(b.title, b.author)));
    } catch {
      // no data yet
    }
    return s.books
      .filter((b) => authorKey(b.author?.authorName ?? b.authorTitle ?? '') === key)
      .map((b) => ({
        title: b.title,
        series: b.seriesTitle ?? null,
        status: this.statusOf(b, s),
        read: mine.has(bookKey(b.title, b.author?.authorName ?? b.authorTitle ?? '')),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Asks the book manager for a book: searches for it if it has it, adds it if not. */
  async requestBook(q: BookRequest, kind: 'book' | 'series') {
    const client = await this.client();
    const s = await this.look(true);
    const have = this.find(s, q);
    let outcome: string;
    let arrTitle: string | null = have?.title ?? null;
    if (have?.id != null) {
      const st = this.statusOf(have, s);
      if (st === 'available' || st === 'downloading') outcome = `already ${st}`;
      else {
        if (!have.monitored) await client.monitor([have.id]);
        await client.searchBooks([have.id]);
        outcome = 'searching';
      }
    } else {
      const found = await this.lookUp(client, q);
      arrTitle = found.title;
      await client.addBook(found, await client.defaults());
      outcome = 'added';
    }
    this.snapshot = null;
    return this.log({
      time: localDateTime(),
      kind,
      title: q.title ?? null,
      author: q.author,
      series: q.series ?? null,
      series_no: q.series_no ?? null,
      outcome,
      arr_title: arrTitle,
    });
  }

  private async lookUp(client: ArrClient, q: BookRequest): Promise<ArrBook> {
    const isbn = parseIsbn(q.isbn13)?.isbn13;
    const author = authorKey(q.author);
    const terms = [
      isbn ? `isbn:${isbn}` : null,
      q.title ? `${q.title} ${q.author}` : null,
      q.series ? `${q.series} ${q.author}` : null,
    ].filter((t): t is string => !!t);
    for (const term of terms) {
      const found = (await client.lookupBooks(term)) ?? [];
      const byAuthor = found.filter(
        (b) => authorKey(b.author?.authorName ?? b.authorTitle ?? '') === author,
      );
      const hit =
        (q.series && q.series_no != null
          ? byAuthor.find((b) => {
              const sr = seriesOf(b.seriesTitle);
              return sr?.series === seriesKey(q.series!) && sr.no === q.series_no;
            })
          : undefined) ??
        (q.title ? byAuthor.find((b) => titleKey(b.title) === titleKey(q.title!)) : undefined) ??
        (term.startsWith('isbn:') ? found[0] : undefined);
      if (hit) return hit;
    }
    const what = q.title
      ? `"${q.title}"`
      : q.series
        ? `#${q.series_no} of ${q.series}`
        : 'that book';
    throw new ArrError(`The book manager couldn't find ${what} by ${q.author}.`, 404);
  }

  /** Asks for every book by an author: monitors the missing ones (adding the author if new) and searches. */
  async requestAuthor(name: string) {
    const client = await this.client();
    const key = authorKey(name);
    const full = name.toLowerCase().replace(/[^a-z]+/g, '');
    const plainName = (a: ArrAuthor) => a.authorName.toLowerCase().replace(/[^a-z]+/g, '');
    const authors = (await client.authors()) ?? [];
    const same = authors.filter((a) => authorKey(a.authorName) === key);
    const have =
      same.find((a) => plainName(a) === full) ?? (same.length === 1 ? same[0] : undefined);
    let outcome: string;
    let arrTitle: string | null = null;
    if (have?.id != null) {
      const s = await this.look(true);
      const missing = s.books.filter(
        (b) => b.authorId === have.id && !b.monitored && (b.statistics?.bookFileCount ?? 0) === 0,
      );
      if (missing.length)
        await client.monitor(missing.map((b) => b.id!).filter((id) => id != null));
      await client.searchAuthor(have.id);
      outcome = missing.length ? `searching, ${missing.length} more book(s) wanted` : 'searching';
      arrTitle = have.authorName;
    } else {
      const found = ((await client.lookupAuthors(name)) ?? []).filter(
        (a) => authorKey(a.authorName) === key,
      );
      const pick = found.find((a) => plainName(a) === full) ?? found[0];
      if (!pick) throw new ArrError(`The book manager couldn't find the author ${name}.`, 404);
      await client.addAuthor(pick, await client.defaults());
      outcome = 'added';
      arrTitle = pick.authorName;
    }
    this.snapshot = null;
    return this.log({
      time: localDateTime(),
      kind: 'author',
      title: null,
      author: name,
      series: null,
      series_no: null,
      outcome,
      arr_title: arrTitle,
    });
  }

  async requests(): Promise<RequestRecord[]> {
    try {
      const r = JSON.parse(await readFile(this.requestsFile, 'utf8')) as unknown;
      return Array.isArray(r) ? (r as RequestRecord[]) : [];
    } catch {
      return [];
    }
  }

  private async log(r: RequestRecord): Promise<RequestRecord> {
    const what =
      r.kind === 'author'
        ? `everything by ${r.author}`
        : r.title
          ? `"${r.title}" by ${r.author}`
          : `#${r.series_no} of ${r.series} by ${r.author}`;
    this.activity.record({
      type: 'request',
      message: `Asked the book manager for ${what}: ${r.outcome}`,
      trigger: 'admin',
      details: { ...r },
    });
    const all = [...(await this.requests()), r].slice(-MAX_REQUESTS);
    await writeFile(`${this.requestsFile}.part`, JSON.stringify(all, null, 1), 'utf8');
    await rename(`${this.requestsFile}.part`, this.requestsFile);
    return r;
  }
}
