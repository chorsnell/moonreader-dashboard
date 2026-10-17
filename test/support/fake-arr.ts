import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const ARR_KEY = 'arr-key';

interface Book {
  id?: number;
  title: string;
  seriesTitle?: string;
  foreignBookId: string;
  authorId?: number;
  author: { authorName: string; foreignAuthorId: string; id?: number };
  monitored?: boolean;
  statistics?: { bookFileCount: number };
  editions?: { isbn13: string }[];
}

/**
 * A stand-in for a Readarr-v1-compatible book manager (Readarr, Bookshelf): the endpoints the
 * dashboard calls, with a small library and a metadata catalogue to look books up in.
 */
export class FakeArr {
  readonly calls: { method: string; path: string; body: unknown }[] = [];
  books: Book[] = [];
  authors: { id: number; authorName: string; foreignAuthorId: string; monitored: boolean }[] = [];
  queue: { bookId: number }[] = [];
  /** What a lookup can find (the book manager's metadata source). */
  catalogue: Book[] = [];
  private server!: Server;
  private nextId = 100;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      void this.handle(req).then(
        ([status, body]) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        },
        () => {
          res.writeHead(500);
          res.end();
        },
      );
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }

  private async handle(req: IncomingMessage): Promise<[number, unknown]> {
    const chunks: Buffer[] = [];
    for await (const c of req as AsyncIterable<Buffer>) chunks.push(c);
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const url = new URL(req.url ?? '/', 'http://x');
    this.calls.push({ method: req.method ?? '', path: url.pathname + url.search, body });
    if (req.headers['x-api-key'] !== ARR_KEY) return [401, { message: 'Unauthorized' }];
    const term = (url.searchParams.get('term') ?? '').toLowerCase();
    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'GET /api/v1/system/status':
        return [200, { appName: 'Bookshelf', version: '0.4.0' }];
      case 'GET /api/v1/book':
        return [200, this.books];
      case 'GET /api/v1/author':
        return [200, this.authors];
      case 'GET /api/v1/queue':
        return [200, { page: 1, totalRecords: this.queue.length, records: this.queue }];
      case 'GET /api/v1/rootfolder':
        return [200, [{ path: '/books', defaultQualityProfileId: 1, defaultMetadataProfileId: 1 }]];
      case 'GET /api/v1/qualityprofile':
      case 'GET /api/v1/metadataprofile':
        return [200, [{ id: 1, name: 'Standard' }]];
      case 'GET /api/v1/book/lookup': {
        const isbn = term.startsWith('isbn:') ? term.slice(5) : null;
        const words = term.split(/\s+/).filter(Boolean);
        return [
          200,
          this.catalogue.filter((b) =>
            isbn
              ? (b.editions ?? []).some((e) => e.isbn13 === isbn)
              : words.every((w) =>
                  `${b.title} ${b.seriesTitle ?? ''} ${b.author.authorName}`
                    .toLowerCase()
                    .includes(w),
                ),
          ),
        ];
      }
      case 'GET /api/v1/author/lookup':
        return [
          200,
          [
            ...new Map(this.catalogue.map((b) => [b.author.foreignAuthorId, b.author])).values(),
          ].filter((a) => a.authorName.toLowerCase().includes(term)),
        ];
      case 'POST /api/v1/book': {
        const b = body as Book;
        const author = this.authorFor(b.author);
        this.books.push({
          ...b,
          id: this.nextId++,
          authorId: author.id,
          monitored: true,
          statistics: { bookFileCount: 0 },
        });
        return [201, this.books.at(-1)];
      }
      case 'POST /api/v1/author': {
        const a = this.authorFor(body as Book['author']);
        for (const b of this.catalogue.filter(
          (x) => x.author.foreignAuthorId === a.foreignAuthorId,
        )) {
          if (!this.books.some((x) => x.foreignBookId === b.foreignBookId)) {
            this.books.push({
              ...b,
              id: this.nextId++,
              authorId: a.id,
              monitored: true,
              statistics: { bookFileCount: 0 },
            });
          }
        }
        return [201, a];
      }
      case 'PUT /api/v1/book/monitor': {
        const { bookIds } = body as { bookIds: number[] };
        for (const b of this.books) if (b.id != null && bookIds.includes(b.id)) b.monitored = true;
        return [202, {}];
      }
      case 'POST /api/v1/command':
        return [201, { id: this.nextId++, ...(body as object), status: 'queued' }];
      default:
        return [404, { message: 'Not found' }];
    }
  }

  private authorFor(a: Book['author']) {
    let author = this.authors.find((x) => x.foreignAuthorId === a.foreignAuthorId);
    if (!author) {
      author = {
        id: this.nextId++,
        authorName: a.authorName,
        foreignAuthorId: a.foreignAuthorId,
        monitored: true,
      };
      this.authors.push(author);
    }
    return author;
  }
}
