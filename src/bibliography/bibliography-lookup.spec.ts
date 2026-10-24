import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadAppConfig } from '../config/app.config';
import { OpenLibraryClient } from '../covers/open-library.client';
import { WikidataClient } from '../metadata/wikidata.client';
import { knownIds, pickAuthor, sameName } from './bibliography-lookup.service';

describe('matching an author by name', () => {
  it('ignores case, accents, punctuation and "Surname, First" order', () => {
    expect(sameName('Brontë, Charlotte', 'Charlotte Bronte')).toBe(true);
    expect(sameName('H. G. Wells', 'H.G. Wells')).toBe(true);
    expect(sameName('H. G. Wells', 'Herbert George Wells')).toBe(true);
    expect(sameName('Jane Austen', 'Jane Austin')).toBe(false);
    expect(sameName('Jane Austen', 'Cassandra Austen')).toBe(false);
    expect(sameName('Jane Austen', undefined)).toBe(false);
  });

  it('takes the first search result whose name matches', () => {
    const docs = [
      { key: 'OL1A', name: 'Austen Jane Society' },
      { key: 'OL2A', name: 'Jane Austen' },
      { key: 'OL3A', name: 'Jane Austen' },
    ];
    expect(pickAuthor('Austen, Jane', docs)).toBe('OL2A');
    expect(pickAuthor('Nobody', docs)).toBeNull();
    expect(pickAuthor('Jane Austen', [{ key: 'bad', name: 'Jane Austen' }])).toBeNull();
  });
});

describe('knownIds', () => {
  it('uses the metadata lookup’s author key and Wikidata item', () => {
    const books = [
      { id: 'talisman', title: 'The Talisman', author: 'King, Stephen & Straub, Peter' },
      { id: 'it', title: 'It', author: 'King, Stephen' },
    ];
    const metadata = {
      books: { talisman: { author_key: 'OL9A' }, it: { author_key: '/authors/OL1A' } },
      authors: { 'king, stephen & straub, peter': { wikidata: 'Q99' } },
    };
    // a book of theirs alone first; the co-written book's Wikidata item when theirs has none
    expect(knownIds('king, stephen', books, metadata)).toEqual({
      authorKey: 'OL1A',
      wikidata: 'Q99',
    });
    expect(knownIds('nobody', books, metadata)).toEqual({ authorKey: null, wikidata: null });
  });
});

describe('Open Library and Wikidata bibliography requests', () => {
  let server: Server;
  const urls: URL[] = [];
  let config: ReturnType<typeof loadAppConfig>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      urls.push(url);
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/search.json') {
        res.end(JSON.stringify({ docs: [{ key: '/works/OL1W', title: 'Emma' }] }));
      } else if (url.pathname === '/search/authors.json') {
        res.end(JSON.stringify({ docs: [{ key: 'OL21594A', name: 'Jane Austen' }] }));
      } else if (url.pathname === '/sparql') {
        res.end(
          JSON.stringify({
            results: {
              bindings: [
                {
                  work: { value: 'http://www.wikidata.org/entity/Q1' },
                  workLabel: { value: 'Emma' },
                  date: { value: '1815-12-23T00:00:00Z' },
                },
              ],
            },
          }),
        );
      } else {
        res.writeHead(500).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    config = {
      ...loadAppConfig({}),
      openLibraryUrl: url,
      wikidataUrl: url,
      wikidataSparqlUrl: url,
      coverPauseMs: 0,
    };
  });

  afterAll(() => new Promise((r) => server.close(r)));

  it('asks for an author’s works, sorted by editions, and searches authors', async () => {
    const ol = new OpenLibraryClient(config);
    expect(await ol.authorWorks('/authors/OL21594A')).toEqual([{ key: '/works/OL1W', title: 'Emma' }]);
    const asked = urls.at(-1)!;
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      author_key: 'OL21594A',
      fields: 'key,title,first_publish_year,edition_count,language,isbn',
      sort: 'editions',
      limit: '100',
    });
    expect(await ol.authorWorks('not a key')).toEqual([]);
    expect(await ol.searchAuthors('Jane Austen')).toEqual([{ key: 'OL21594A', name: 'Jane Austen' }]);
    expect(urls.at(-1)!.searchParams.get('q')).toBe('Jane Austen');
  });

  it('asks Wikidata’s SPARQL endpoint for the works an author wrote', async () => {
    const wd = new WikidataClient(config);
    expect(await wd.authorWorks('Q36322')).toEqual([
      { id: 'Q1', title: 'Emma', year: 1815, series: null, series_no: null },
    ]);
    const asked = urls.at(-1)!;
    expect(asked.searchParams.get('format')).toBe('json');
    const query = asked.searchParams.get('query') ?? '';
    expect(query).toContain('wdt:P50 wd:Q36322');
    expect(query).toContain('pq:P1545');
    expect(query).toContain('wdt:P577');
    expect(await wd.authorWorks('nonsense')).toEqual([]);
  });
});
