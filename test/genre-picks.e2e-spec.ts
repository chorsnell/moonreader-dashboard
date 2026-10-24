/**
 * The genre picks (BOO-105) end to end, against a fake Open Library: once the books have
 * genres, the lookup that follows a rebuild fetches each genre's subject, and the rebuild
 * after it writes data/genre_picks.json. Admin → Discovery changes which subject a genre
 * is looked up under. Visitors don't get a private genre's picks.
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
  genre: string;
  subgenre: string | null;
  title: string;
  author: string;
  rank: number;
  on_pile: boolean;
}

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;
let server: Server;
const asked: string[] = [];

const work = (n: number, title: string, author: string) => ({
  key: `/works/OL${n}W`,
  title,
  authors: [{ key: `/authors/OL${n}A`, name: author }],
  first_publish_year: 1900 + n,
  edition_count: 100 - n,
  cover_id: n,
});

// fantasy has Alpha (in the library), a box set (junk) and two more; horror has one
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-picks-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    asked.push(url.pathname + url.search);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/subjects/fantasy.json') {
      res.end(
        JSON.stringify({
          name: 'Fantasy',
          work_count: 4,
          works: [
            work(1, 'Alpha', 'Ann Author'),
            work(2, 'The Hobbit', 'J.R.R. Tolkien'),
            work(3, 'Earthsea Box Set', 'Ursula K. Le Guin'),
            work(4, 'Lud-in-the-Mist', 'Hope Mirrlees'),
          ],
        }),
      );
    } else if (url.pathname === '/subjects/horror.json') {
      res.end(JSON.stringify({ name: 'Horror', works: [work(5, 'Dracula', 'Bram Stoker')] }));
    } else if (url.pathname === '/search.json') {
      res.end(JSON.stringify({ docs: [] }));
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

const admin = (d: TestDashboard) => ({
  get: (path: string) => request(d.server).get(path).set('X-Upload-Token', TOKEN),
  put: (path: string, body: object) =>
    request(d.server).put(path).set('X-Upload-Token', TOKEN).send(body),
});

describe('genre picks', () => {
  it('looks up your genres’ subjects and builds the picks; Discovery changes them', async () => {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    dash = await TestDashboard.start({
      metadataLookup: true,
      bibliographyLookup: true,
      openLibraryUrl: url,
      wikidataUrl: url,
      wikidataSparqlUrl: url,
      coverPauseMs: 0,
    });
    await request(dash.server)
      .put('/upload?name=test.mrpro')
      .set('X-Upload-Token', TOKEN)
      .type('application/octet-stream')
      .send(backup)
      .expect(200);
    const d = dash;
    expect(
      await waitFor(async () => (await d.json<unknown[]>('data', 'books.json')).length > 0),
    ).toBe(true);
    // give the books genres; the rebuild's lookup then fetches the subjects
    const list = (await admin(d).get('/api/admin/catalogue').expect(200)).body as {
      books: { id: string; files: string[] }[];
    };
    for (const [id, title, author, genre] of [
      ['alpha', 'Alpha', 'Ann Author', 'Fantasy'],
      ['beta', 'Beta', 'Bob Writer', 'Horror'],
    ]) {
      const files = list.books.find((b) => b.id === id)!.files;
      await admin(d).put('/api/admin/catalogue', { files, title, author, genre }).expect(200);
    }
    const picks = () => d.json<Row[]>('data', 'genre_picks.json');
    expect(await waitFor(async () => (await picks()).length === 3, 60_000)).toBe(true);
    expect((await picks()).map((r) => [r.genre, r.subgenre, r.title, r.author, r.rank])).toEqual([
      ['Fantasy', null, 'The Hobbit', 'J.R.R. Tolkien', 2],
      ['Fantasy', null, 'Lud-in-the-Mist', 'Hope Mirrlees', 4],
      ['Horror', null, 'Dracula', 'Bram Stoker', 1],
    ]);
    expect(asked.filter((a) => a.startsWith('/subjects/')).sort()).toEqual([
      '/subjects/fantasy.json?limit=50',
      '/subjects/horror.json?limit=50',
    ]);
    const cache = await d.json<{ authors: object; subjects: Record<string, { works: unknown[] }> }>(
      'bibliography.json',
    );
    expect(Object.keys(cache.subjects).sort()).toEqual(['fantasy', 'horror']);
    expect(cache.subjects.fantasy.works).toHaveLength(4);
    expect(await readFile(d.path('update.log'), 'utf8')).toMatch(
      /Found popular books for 2 of 2 genre subject/,
    );

    // Admin → Discovery: each genre with its default subject; skipping Horror rebuilds
    const genres = (await admin(d).get('/api/admin/discovery').expect(200)).body.genres as {
      genre: string;
      default_subject: string;
      subject: string | null;
      override: string | null;
      works: number | null;
    }[];
    expect(genres.map((g) => [g.genre, g.default_subject, g.override, g.works])).toEqual([
      ['Fantasy', 'fantasy', null, 4],
      ['Horror', 'horror', null, 1],
    ]);
    await admin(d).put('/api/admin/discovery', { subjects: 'x' }).expect(400);
    await admin(d)
      .put('/api/admin/discovery', { subjects: { Horror: '', Fantasy: null } })
      .expect(200, { ok: true, subjects: { Horror: '' }, rebuilding: true });
    const settings = await d.json<{ discovery: unknown }>('settings.json');
    expect(settings.discovery).toEqual({ subjects: { Horror: '' } });
    expect(
      await waitFor(async () => !(await picks()).some((r) => r.genre === 'Horror'), 30_000),
    ).toBe(true);
    expect((await admin(d).get('/api/admin/discovery')).body.genres[1]).toMatchObject({
      genre: 'Horror',
      subject: null,
      override: '',
    });

    // visitors don't get a private genre's picks; the admin does
    await admin(d)
      .put('/api/admin/privacy', { private_genres: ['Fantasy'] })
      .expect(200);
    const served = await request(d.server).get('/data/genre_picks.json').expect(200);
    expect(served.body).toEqual([]);
    const own = await admin(d).get('/data/genre_picks.json').expect(200);
    expect((own.body as Row[]).map((r) => r.title)).toEqual(['The Hobbit', 'Lud-in-the-Mist']);
  });

  it('is admin only', async () => {
    dash = await TestDashboard.start();
    await request(dash.server).get('/api/admin/discovery').expect(403);
    await request(dash.server).put('/api/admin/discovery').send({ subjects: {} }).expect(403);
    // with no data yet, there are no genres
    expect((await admin(dash).get('/api/admin/discovery').expect(200)).body).toEqual({
      genres: [],
    });
  });
});
