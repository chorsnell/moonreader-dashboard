/**
 * A small client for an *arr book manager: Readarr's v1 API, which forks such as Bookshelf
 * keep. Only the calls the dashboard needs. Every request goes to the admin's own instance
 * with its API key; the dashboard never searches for or downloads books itself.
 */

/** A book as the book manager has it (only the fields used here). */
export interface ArrBook {
  id?: number;
  title: string;
  /** "Discworld #2" or "Discworld, #2" when the book is part of a series. */
  seriesTitle?: string | null;
  foreignBookId?: string;
  authorId?: number;
  author?: ArrAuthor;
  authorTitle?: string;
  monitored?: boolean;
  statistics?: { bookFileCount?: number; sizeOnDisk?: number };
  editions?: { isbn13?: string | null; monitored?: boolean }[];
  [key: string]: unknown;
}

export interface ArrAuthor {
  id?: number;
  authorName: string;
  foreignAuthorId?: string;
  monitored?: boolean;
  [key: string]: unknown;
}

interface Profile {
  id: number;
  name: string;
}

interface RootFolder {
  path: string;
  defaultQualityProfileId?: number;
  defaultMetadataProfileId?: number;
}

/** How the dashboard adds books: the first root folder and its (or the first) profiles. */
export interface AddDefaults {
  rootFolderPath: string;
  qualityProfileId: number;
  metadataProfileId: number;
}

export class ArrError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

export class ArrClient {
  private readonly base: string;

  constructor(
    url: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = url.replace(/\/+$/, '');
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method,
        headers: {
          'X-Api-Key': this.apiKey,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (e) {
      throw new ArrError(
        `Couldn't reach the book manager: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (res.status === 401) throw new ArrError('The book manager refused the API key.', 401);
    if (!res.ok) throw new ArrError(`The book manager answered HTTP ${res.status}.`, res.status);
    const text = await res.text();
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      throw new ArrError("The book manager's answer wasn't JSON. Is the URL right?");
    }
  }

  status() {
    return this.call<{ appName?: string; instanceName?: string; version?: string }>(
      'GET',
      '/api/v1/system/status',
    );
  }

  books() {
    return this.call<ArrBook[]>('GET', '/api/v1/book');
  }

  authors() {
    return this.call<ArrAuthor[]>('GET', '/api/v1/author');
  }

  /** Book ids being downloaded now. */
  async queue(): Promise<Set<number>> {
    const q = await this.call<{ records?: { bookId?: number }[] } | { bookId?: number }[]>(
      'GET',
      '/api/v1/queue?page=1&pageSize=500',
    );
    const records = Array.isArray(q) ? q : (q?.records ?? []);
    return new Set(records.map((r) => r.bookId).filter((id): id is number => id != null));
  }

  lookupBooks(term: string) {
    return this.call<ArrBook[]>('GET', `/api/v1/book/lookup?term=${encodeURIComponent(term)}`);
  }

  lookupAuthors(term: string) {
    return this.call<ArrAuthor[]>('GET', `/api/v1/author/lookup?term=${encodeURIComponent(term)}`);
  }

  async defaults(): Promise<AddDefaults> {
    const [roots, quality, metadata] = await Promise.all([
      this.call<RootFolder[]>('GET', '/api/v1/rootfolder'),
      this.call<Profile[]>('GET', '/api/v1/qualityprofile'),
      this.call<Profile[]>('GET', '/api/v1/metadataprofile'),
    ]);
    const root = roots?.[0];
    if (!root) throw new ArrError('The book manager has no root folder to put books in yet.');
    const q = root.defaultQualityProfileId ?? quality?.[0]?.id;
    const m = root.defaultMetadataProfileId ?? metadata?.[0]?.id;
    if (q == null || m == null)
      throw new ArrError('The book manager has no quality or metadata profile.');
    return { rootFolderPath: root.path, qualityProfileId: q, metadataProfileId: m };
  }

  /** Adds a book found by a lookup, monitored, and asks for a search. */
  addBook(book: ArrBook, d: AddDefaults) {
    const author = book.author ?? { authorName: book.authorTitle ?? '' };
    return this.call<ArrBook>('POST', '/api/v1/book', {
      ...book,
      monitored: true,
      addOptions: { searchForNewBook: true },
      author: {
        ...author,
        ...d,
        monitored: true,
        addOptions: { monitor: 'none', searchForMissingBooks: false },
      },
    });
  }

  /** Adds an author found by a lookup, monitoring all their books, and searches for them. */
  addAuthor(author: ArrAuthor, d: AddDefaults) {
    return this.call<ArrAuthor>('POST', '/api/v1/author', {
      ...author,
      ...d,
      monitored: true,
      addOptions: { monitor: 'all', searchForMissingBooks: true },
    });
  }

  monitor(bookIds: number[]) {
    return this.call<unknown>('PUT', '/api/v1/book/monitor', { bookIds, monitored: true });
  }

  searchBooks(bookIds: number[]) {
    return this.call<unknown>('POST', '/api/v1/command', { name: 'BookSearch', bookIds });
  }

  searchAuthor(authorId: number) {
    return this.call<unknown>('POST', '/api/v1/command', { name: 'AuthorSearch', authorId });
  }
}
