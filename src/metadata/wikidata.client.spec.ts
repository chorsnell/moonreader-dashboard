import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadAppConfig } from '../config/app.config';
import { OpenLibraryClient } from '../covers/open-library.client';
import { workMetadata } from './metadata-lookup.service';
import { WikidataClient } from './wikidata.client';

const item = (id: string) => ({ value: { 'entity-type': 'item', id } });
const claim = (value: unknown, rank = 'normal') => ({
  mainsnak: { snaktype: 'value', datavalue: value },
  rank,
});

/** A few Wikidata items, shaped as wbgetentities returns them. */
const ENTITIES: Record<string, object> = {
  // a woman, citizen of a historical state that became the United Kingdom
  Q1: {
    P21: [claim(item('Q6581072'))],
    P27: [claim(item('Q174193'))],
  },
  Q174193: { P1366: [claim(item('Q145'))] },
  Q145: { P297: [claim({ value: 'GB' })] },
  // a man with a deprecated citizenship, born somewhere now in Russia
  Q2: {
    P21: [claim(item('Q6581097'))],
    P27: [claim(item('Q145'), 'deprecated'), claim(item('Q34266'))],
    P19: [claim(item('Q3'))],
  },
  Q34266: {},
  Q3: { P17: [claim(item('Q159'))] },
  Q159: { P297: [claim({ value: 'RU' })] },
  // nothing known
  Q4: {},
};

describe('Open Library and Wikidata clients', () => {
  let server: Server;
  const urls: string[] = [];
  let config: ReturnType<typeof loadAppConfig>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      urls.push(url.pathname + url.search);
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/w/api.php' && url.searchParams.get('action') === 'wbgetentities') {
        const ids = (url.searchParams.get('ids') ?? '').split('|');
        const entities = Object.fromEntries(
          ids.filter((id) => ENTITIES[id]).map((id) => [id, { id, claims: ENTITIES[id] }]),
        );
        res.end(JSON.stringify({ entities }));
      } else if (url.pathname === '/w/api.php') {
        const hit = url.searchParams.get('srsearch') === 'haswbstatement:P648=OL2A';
        res.end(JSON.stringify({ query: { search: hit ? [{ title: 'Q2' }] : [] } }));
      } else if (url.pathname === '/authors/OL1A.json') {
        res.end(JSON.stringify({ remote_ids: { wikidata: 'Q1' } }));
      } else if (url.pathname === '/search.json') {
        const isbn = url.searchParams.get('isbn');
        const docs =
          isbn === '9780141439587' || url.searchParams.get('author') === 'Austen'
            ? [{ key: '/works/OL66562W', isbn: ['x', '0141439580'], author_key: ['OL1A'] }]
            : [];
        res.end(JSON.stringify({ docs }));
      } else {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    config = { ...loadAppConfig({}), openLibraryUrl: url, wikidataUrl: url, coverPauseMs: 0 };
  });

  afterAll(() => new Promise((r) => server.close(r)));

  it('works out gender and country', async () => {
    const wd = new WikidataClient(config);
    expect(await wd.authorFacts('Q1')).toEqual({ gender: 'female', country: 'GB' });
    expect(await wd.authorFacts('Q2')).toEqual({ gender: 'male', country: 'RU' });
    expect(await wd.authorFacts('Q4')).toEqual({ gender: null, country: null });
    expect(await wd.findByOpenLibrary('OL2A')).toBe('Q2');
    expect(await wd.findByOpenLibrary('OL9A')).toBeNull();
  });

  it('finds works by ISBN, then by title and author', async () => {
    const ol = new OpenLibraryClient(config);
    urls.length = 0;
    const doc = await ol.findWork('Emma', 'Austen, Jane', '9780141439587');
    expect(urls).toHaveLength(1);
    expect(workMetadata(doc!)).toEqual({
      work_id: 'OL66562W',
      isbn13: '9780141439587',
      isbn10: '0141439580',
      published_year: null,
      pages: null,
      author_key: 'OL1A',
    });
    expect(await ol.findWork('Emma: A Novel', 'Jane Austen', null)).not.toBeNull();
    expect(urls.at(-1)).toContain('title=Emma&author=Austen');
    expect(await ol.findWork('Nothing', '', null)).toBeNull();
    expect(await ol.authorWikidata('/authors/OL1A')).toBe('Q1');
    expect(await ol.authorWikidata('not a key')).toBeNull();
  });
});
