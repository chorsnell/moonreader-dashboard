/**
 * The bibliography lookup (BOO-103) end to end, against fake Open Library and Wikidata
 * servers: after the metadata lookup it finds Ann Author's other works and their series, and
 * the rebuild that follows writes data/bibliography.json.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, waitFor } from './support/test-dashboard';

interface Row {
  title: string;
  author: string;
  series: string | null;
  series_no: number | null;
  why: string[];
  on_pile: boolean;
}

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;
let server: Server;
const asked: string[] = [];

// Open Library knows Alpha (by Ann Author, OL5A) and three more of Ann's works, one a study
// guide; Wikidata (Q5) puts Gamma in a series and knows a series book Open Library doesn't
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-bib-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    asked.push(url.pathname + url.search);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/search.json' && url.searchParams.get('author_key') === 'OL5A') {
      res.end(
        JSON.stringify({
          docs: [
            { key: '/works/OL1W', title: 'Alpha', first_publish_year: 1990, edition_count: 30 },
            { key: '/works/OL2W', title: 'Gamma', first_publish_year: 1994, edition_count: 12 },
            {
              key: '/works/OL3W',
              title: 'Delta',
              first_publish_year: 1999,
              edition_count: 4,
              language: ['eng'],
              isbn: ['9780141439587'],
            },
            {
              key: '/works/OL4W',
              title: 'Study Guide: Alpha',
              first_publish_year: 2004,
              edition_count: 3,
            },
            { key: '/works/OL5W', title: 'Letters', first_publish_year: 2010, edition_count: 1 },
          ],
        }),
      );
    } else if (url.pathname === '/search.json') {
      const alpha = url.searchParams.get('title') === 'Alpha';
      const docs = alpha ? [{ key: '/works/OL1W', title: 'Alpha', author_key: ['OL5A'] }] : [];
      res.end(JSON.stringify({ docs }));
    } else if (url.pathname === '/authors/OL5A.json') {
      res.end(JSON.stringify({ remote_ids: { wikidata: 'Q5' } }));
    } else if (url.pathname === '/w/api.php') {
      res.end(JSON.stringify({ entities: {} }));
    } else if (url.pathname === '/sparql') {
      const b = (id: string, title: string, series?: string, no?: string) => ({
        work: { value: `http://www.wikidata.org/entity/${id}` },
        workLabel: { value: title },
        ...(series ? { seriesLabel: { value: series } } : {}),
        ...(no ? { ordinal: { value: no } } : {}),
      });
      res.end(
        JSON.stringify({
          results: {
            bindings: [
              b('Q11', 'Gamma', 'Greek Letters', '3'),
              b('Q12', 'Epsilon', 'Greek Letters', '5'),
              b('Q13', 'Zeta'), // in no series, and Open Library doesn't know it: left out
            ],
          },
        }),
      );
    } else {
      res.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(tmp, { recursive: true, force: true });
});

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

const start = (bibliographyLookup: boolean) => {
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return TestDashboard.start({
    metadataLookup: true,
    bibliographyLookup,
    openLibraryUrl: url,
    wikidataUrl: url,
    wikidataSparqlUrl: url,
    coverPauseMs: 0,
  });
};

const upload = (d: TestDashboard) =>
  request(d.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup);

describe('bibliography lookup', () => {
  it('finds authors’ other works, then rebuilds with them', async () => {
    dash = await start(true);
    await upload(dash).expect(200);
    const rows = async () => dash!.json<Row[]>('data', 'bibliography.json');
    expect(await waitFor(async () => (await rows()).length > 0, 30_000)).toBe(true);
    expect((await rows()).map((r) => [r.title, r.author, r.series, r.series_no, r.why])).toEqual([
      ['Gamma', 'Ann Author', 'Greek Letters', 3, ['author']],
      ['Epsilon', 'Ann Author', 'Greek Letters', 5, ['author']],
      ['Delta', 'Ann Author', null, null, ['author']],
    ]);
    const cache = await dash.json<{
      authors: Record<string, { author_key: string; wikidata: string; works: unknown[] }>;
    }>('bibliography.json');
    expect(cache.authors['ann author']).toMatchObject({ author_key: 'OL5A', wikidata: 'Q5' });
    // Bob Writer has one unfinished book in no series: not looked up
    expect(Object.keys(cache.authors)).toEqual(['ann author']);
    expect(asked.some((a) => a.startsWith('/sparql?'))).toBe(true);
    // served to visitors like any data file; library/bibliography.json isn't served
    const served = await request(dash.server).get('/data/bibliography.json').expect(200);
    expect(served.body).toHaveLength(3);
    expect((await dash.raw('GET', '/bibliography.json')).status).toBe(404);
    const log = await readFile(dash.path('update.log'), 'utf8');
    expect(log).toMatch(/Found the bibliographies of 1 of 1 author/);
  });

  it('does nothing when turned off', async () => {
    asked.length = 0;
    dash = await start(false);
    await upload(dash).expect(200);
    // the metadata lookup still runs and rebuilds
    expect(
      await waitFor(async () => {
        const books = await dash!.json<{ title: string; work_id: string | null }[]>(
          'data',
          'books.json',
        );
        return books.some((b) => b.work_id === 'OL1W');
      }, 30_000),
    ).toBe(true);
    expect(await dash.json('data', 'bibliography.json')).toEqual([]);
    expect(asked.some((a) => a.includes('author_key=') || a.startsWith('/sparql'))).toBe(false);
  });
});
