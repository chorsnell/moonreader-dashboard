/**
 * The admin's *arr book manager (BOO-64), against a stand-in for its Readarr v1 API: only
 * the admin may use or even see it, the API key never leaves the server, statuses, and
 * requests for a book, the next in a series and the rest of an author.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { ARR_KEY, FakeArr } from './support/fake-arr';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;
let arr: FakeArr;
let arrUrl: string;

const ann = { authorName: 'Ann Author', foreignAuthorId: 'a1' };
const kit = { authorName: 'Kit Writer', foreignAuthorId: 'a2' };

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-arr-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

beforeEach(async () => {
  arr = new FakeArr();
  arrUrl = await arr.start();
});

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
  await arr.stop();
});

const as = (d: TestDashboard) => ({
  get: (p: string) => request(d.server).get(p).set('X-Upload-Token', TOKEN),
  put: (p: string, b: object) => request(d.server).put(p).set('X-Upload-Token', TOKEN).send(b),
  post: (p: string, b: object) => request(d.server).post(p).set('X-Upload-Token', TOKEN).send(b),
});

async function connected(): Promise<TestDashboard> {
  const d = await TestDashboard.start();
  await request(d.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup)
    .expect(200);
  expect(await waitFor(fileExists(d.path('data', 'meta.json')))).toBe(true);
  await as(d).put('/api/admin/arr', { url: arrUrl, api_key: ARR_KEY }).expect(200);
  return d;
}

describe('book manager', () => {
  it('is only for the admin', async () => {
    dash = await TestDashboard.start();
    for (const [method, path] of [
      ['get', '/api/admin/arr'],
      ['put', '/api/admin/arr'],
      ['delete', '/api/admin/arr'],
      ['get', '/api/admin/arr/status'],
      ['get', '/api/admin/arr/author?name=Ann'],
      ['post', '/api/admin/arr/request'],
      ['post', '/api/admin/arr/request-author'],
    ] as const) {
      const res = await request(dash.server)[method](path).send({});
      expect([path, res.status]).toEqual([path, 403]);
    }
    expect(arr.calls).toEqual([]);
  });

  it('checks the connection and keeps the API key on the server', async () => {
    dash = await TestDashboard.start();
    const d = dash;
    const bad = await as(d).put('/api/admin/arr', { url: arrUrl, api_key: 'wrong' }).expect(502);
    expect(bad.body.error).toMatch(/refused the API key/);
    await as(d).put('/api/admin/arr', { url: 'ftp://x' }).expect(400);
    const ok = await as(d).put('/api/admin/arr', { url: arrUrl, api_key: ARR_KEY }).expect(200);
    expect(ok.body).toMatchObject({ app: 'Bookshelf', version: '0.4.0' });
    const got = await as(d).get('/api/admin/arr').expect(200);
    expect(got.body).toEqual({ configured: true, url: arrUrl, has_key: true });
    expect(JSON.stringify(got.body)).not.toContain(ARR_KEY);
    // the key goes to the book manager in a header, never in the URL
    expect(arr.calls.every((c) => !c.path.includes(ARR_KEY))).toBe(true);
    // saving who can see the dashboard keeps the book manager's settings
    await as(d).post('/api/access', { access: 'password', password: 'friends' }).expect(200);
    const settings = JSON.parse(await readFile(d.path('settings.json'), 'utf8'));
    expect(settings).toMatchObject({ access: 'password', arr: { url: arrUrl, api_key: ARR_KEY } });
    // nobody else can get at it
    const cfg = await request(d.server).get('/api/config');
    expect(JSON.stringify(cfg.body)).not.toContain(ARR_KEY);
    // changing the URL keeps the key
    await as(d)
      .put('/api/admin/arr', { url: `${arrUrl}/` })
      .expect(200);
  });

  it('says where the books stand, and sends requests', async () => {
    arr.books = [
      {
        id: 1,
        title: 'Alpha',
        foreignBookId: 'b1',
        authorId: 10,
        author: ann,
        monitored: true,
        statistics: { bookFileCount: 1 },
      },
      {
        id: 2,
        title: 'Beta',
        foreignBookId: 'b2',
        authorId: 11,
        author: { authorName: 'Bob Writer', foreignAuthorId: 'a3' },
        monitored: true,
        statistics: { bookFileCount: 0 },
      },
      {
        id: 3,
        title: 'Alpha Three',
        seriesTitle: 'Alpha Saga #3',
        foreignBookId: 'b4',
        authorId: 10,
        author: ann,
        monitored: false,
        statistics: { bookFileCount: 0 },
      },
    ];
    arr.authors = [{ id: 10, authorName: 'Ann Author', foreignAuthorId: 'a1', monitored: true }];
    arr.queue = [{ bookId: 2 }];
    arr.catalogue = [
      {
        title: 'Alpha Two',
        seriesTitle: 'Alpha Saga #2',
        foreignBookId: 'b3',
        author: ann,
        editions: [{ isbn13: '9780141439518' }],
      },
      { title: 'Kit One', foreignBookId: 'k1', author: kit },
      { title: 'Kit Two', foreignBookId: 'k2', author: kit },
    ];
    dash = await connected();
    const d = dash;

    const status = await as(d).get('/api/admin/arr/status').expect(200);
    expect(status.body.books).toMatchObject({
      alpha: { status: 'available' },
      beta: { status: 'downloading' },
    });
    const author = await as(d).get('/api/admin/arr/author?name=Ann%20Author').expect(200);
    expect(author.body.books).toEqual([
      { title: 'Alpha', series: null, status: 'available', read: true },
      { title: 'Alpha Three', series: 'Alpha Saga #3', status: 'in_library', read: false },
    ]);

    // the next in a series, not in the book manager yet: looked up and added, with a search
    const next = await as(d)
      .post('/api/admin/arr/request', { series: 'Alpha Saga', series_no: 2, author: 'Ann Author' })
      .expect(200);
    expect(next.body.request).toMatchObject({
      kind: 'series',
      outcome: 'added',
      arr_title: 'Alpha Two',
    });
    const added = arr.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/book');
    expect(added?.body).toMatchObject({
      title: 'Alpha Two',
      monitored: true,
      addOptions: { searchForNewBook: true },
      author: { rootFolderPath: '/books', qualityProfileId: 1, metadataProfileId: 1 },
    });

    // one the book manager has but doesn't want: monitored, then searched for
    await as(d)
      .post('/api/admin/arr/request', { series: 'Alpha Saga', series_no: 3, author: 'Ann Author' })
      .expect(200);
    expect(arr.calls).toContainEqual(
      expect.objectContaining({
        method: 'PUT',
        path: '/api/v1/book/monitor',
        body: { bookIds: [3], monitored: true },
      }),
    );
    expect(arr.calls).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/command',
        body: { name: 'BookSearch', bookIds: [3] },
      }),
    );
    // one it already has a file for: nothing to do
    const have = await as(d)
      .post('/api/admin/arr/request', { title: 'Alpha', author: 'Ann Author' })
      .expect(200);
    expect(have.body.request.outcome).toBe('already available');

    // the rest of a new author: added with all their books wanted
    const rest = await as(d)
      .post('/api/admin/arr/request-author', { author: 'Kit Writer' })
      .expect(200);
    expect(rest.body.request).toMatchObject({ kind: 'author', outcome: 'added' });
    expect(
      arr.calls.find((c) => c.path === '/api/v1/author' && c.method === 'POST')?.body,
    ).toMatchObject({
      authorName: 'Kit Writer',
      addOptions: { monitor: 'all', searchForMissingBooks: true },
    });
    // an author it has: their books searched for
    await as(d).post('/api/admin/arr/request-author', { author: 'Ann Author' }).expect(200);
    expect(arr.calls).toContainEqual(
      expect.objectContaining({ body: { name: 'AuthorSearch', authorId: 10 } }),
    );

    // not found: a 404, logged as failed
    const missing = await as(d)
      .post('/api/admin/arr/request', { title: 'Nowhere', author: 'No One' })
      .expect(404);
    expect(missing.body.error).toMatch(/couldn't find "Nowhere"/);

    const log = (await readFile(d.path('activity.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const requests = log.filter((e) => e.type === 'request');
    expect(requests.map((e) => e.outcome)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'failed']);
    const kept = JSON.parse(await readFile(d.path('arr-requests.json'), 'utf8'));
    expect(kept).toHaveLength(5);
    const after = await as(d).get('/api/admin/arr/status').expect(200);
    expect(after.body.requests).toHaveLength(5);
  });
});
