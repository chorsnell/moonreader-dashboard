/**
 * The stats API (BOO-56): the page's calcs worked out on the server, from only what each
 * viewer may see. The fake backup: Alpha by Ann Author (finished, with highlights) and Beta
 * by Bob Writer.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { WEB_DIR } from '../src/paths';
import { PRESETS } from '../src/privacy/privacy';
import { loadPageCalcs } from '../src/stats/page-sandbox';
import { computeStats, type Inputs } from '../src/stats/stats';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let dash: TestDashboard;
let admin: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-stats-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  dash = await TestDashboard.start();
  await request(dash.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(await readFile(join(tmp, 'test.mrpro')))
    .expect(200);
  expect(await waitFor(fileExists(dash.path('data', 'meta.json')))).toBe(true);
  const res = await request(dash.server).post('/api/login').send({ password: TOKEN }).expect(200);
  admin = String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
});

afterAll(async () => {
  await dash.stop();
  await rm(tmp, { recursive: true, force: true });
});

const get = (path: string, cookie = '') => {
  const req = request(dash.server).get(path);
  return cookie ? req.set('Cookie', cookie) : req;
};
const json = async (path: string, cookie = '') => (await get(path, cookie).expect(200)).body;
const setPrivacy = (body: object) =>
  request(dash.server).put('/api/admin/privacy').set('Cookie', admin).send(body).expect(200);

/** What the page's calcs give from the data files as this viewer is served them. */
async function fromServedFiles(cookie: string) {
  const calcs = await loadPageCalcs(WEB_DIR);
  const inputs: Inputs = new Map();
  for (const f of calcs.files) {
    const r = await get(`/data/${f.name}`, cookie);
    inputs.set(f.id, r.status === 200 ? (r.body as unknown[]) : f.optional ? [] : null);
  }
  return computeStats(calcs, inputs).rows;
}

type Bundle = { version: string; generated: string | null; calcs: Record<string, unknown[]> };

describe('the stats API', () => {
  beforeAll(() => setPrivacy({ public: PRESETS.everything }));

  it('lists the calcs and serves each one', async () => {
    const index = await json('/api/stats');
    expect(index.version).toEqual(expect.any(String));
    const kpis = index.calcs.find((c: { id: string }) => c.id === 'kpis');
    expect(kpis).toMatchObject({ server: true, inputs: ['books', 'reads', 'daily', 'as_of'] });
    expect(kpis.title).toEqual(expect.any(String));
    const rows = await json('/api/stats/kpis');
    expect(rows).toContainEqual({ metric: 'finished_books', value: 1 });
    await get('/api/stats/no_such_calc').expect(404);
    await get('/api/stats/constructor').expect(404);
  });

  it('serves every calc in one bundle, gzipped, and the page a lighter one', async () => {
    const res = await get('/api/stats/all').set('Accept-Encoding', 'gzip').expect(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers.vary).toMatch(/Cookie/);
    expect(res.headers['cache-control']).toMatch(/private/);
    const all = res.body as Bundle;
    expect(all.calcs.kpis).toEqual(await json('/api/stats/kpis'));
    const page = (await json('/api/stats/page')) as Bundle;
    expect(Object.keys(page.calcs).length).toBeGreaterThan(30);
    for (const [id, rows] of Object.entries(page.calcs)) expect(rows).toEqual(all.calcs[id]);
    // not sent again while nothing changed
    await get('/api/stats/all').set('If-None-Match', String(res.headers.etag)).expect(304);
  });

  it('works out the same numbers as the page would from the files it gets', async () => {
    for (const cookie of ['', admin]) {
      expect(((await json('/api/stats/all', cookie)) as Bundle).calcs).toEqual(
        await fromServedFiles(cookie),
      );
    }
  });

  it('sums up a year and an author', async () => {
    const year = String(((await json('/api/stats/per_year')) as { year: number }[])[0].year);
    const y = await json(`/api/stats/year/${year}`);
    expect(y.year).toBe(Number(year));
    expect(y.totals).toMatchObject({ year: Number(year) });
    expect(y.finished.map((r: { title: string }) => r.title)).toContain('Alpha');
    await get('/api/stats/year/1900').expect(404);
    await get('/api/stats/year/abc').expect(404);
    const a = await json('/api/author/ann%20author');
    expect(a.author).toBe('Ann Author');
    expect(a.totals).toMatchObject({ books: 1, finished: 1 });
    expect(a.books.map((b: { title: string }) => b.title)).toEqual(['Alpha']);
    await get('/api/author/nobody').expect(404);
  });
});

describe('privacy', () => {
  afterAll(async () => {
    await setPrivacy({});
    await request(dash.server)
      .post('/api/access')
      .set('Cookie', admin)
      .send({ access: 'public' })
      .expect(200);
  });

  it('never shows the public a private book, or days when the diary is hidden', async () => {
    await setPrivacy({ public: PRESETS.taste, private_books: ['alpha'] });
    const all = (await json('/api/stats/all')) as Bundle;
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/alpha|Alpha|Ann Author/);
    expect(text).toContain('Beta');
    expect(all.calcs.diary).toEqual([]);
    expect(all.calcs.day_totals).toEqual([]);
    expect(all.calcs.quote_pool).toEqual([]); // highlights hidden
    // nothing but what the page itself would work out from the files the public gets
    expect(all.calcs).toEqual(await fromServedFiles(''));
    await get('/api/author/Ann%20Author').expect(404);
    for (const p of [
      '/api/stats',
      '/api/stats/page',
      '/api/stats/kpis',
      '/api/author/Bob%20Writer',
    ]) {
      expect(JSON.stringify((await get(p).expect(200)).body)).not.toMatch(/Alpha|Ann Author/);
    }
    // the admin still sees it all
    const mine = JSON.stringify(await json('/api/stats/all', admin));
    expect(mine).toContain('Alpha');
    expect(((await json('/api/stats/all', admin)) as Bundle).calcs.diary.length).toBeGreaterThan(0);
    expect((await json('/api/author/Ann%20Author', admin)).books).toHaveLength(1);
  });

  it('works the numbers out again when the settings change', async () => {
    await setPrivacy({ public: PRESETS.taste, private_books: ['alpha'] });
    const before = await get('/api/stats/all').expect(200);
    await setPrivacy({ public: PRESETS.everything });
    const after = await get('/api/stats/all').expect(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(JSON.stringify(after.body)).toContain('Alpha');
    await get('/api/stats/all').set('If-None-Match', String(before.headers.etag)).expect(200);
  });

  it('gives the admin previewing as a visitor what the visitor gets', async () => {
    await setPrivacy({ public: PRESETS.taste, private_books: ['alpha'] });
    const on = await request(dash.server)
      .post('/api/admin/preview')
      .set('Cookie', admin)
      .send({ as: 'public' })
      .expect(200);
    const preview = String(on.headers['set-cookie']?.[0] ?? '').split(';')[0];
    const both = `${admin}; ${preview}`;
    expect(await json('/api/stats/all', both)).toEqual(await json('/api/stats/all'));
    expect(JSON.stringify(await json('/api/stats/all', both))).not.toContain('Alpha');
  });

  it('is shut to the public when the dashboard needs a password', async () => {
    await setPrivacy({ public: PRESETS.everything, reader: PRESETS.no_dates });
    await request(dash.server)
      .post('/api/access')
      .set('Cookie', admin)
      .send({ access: 'password', password: 'friends' })
      .expect(200);
    for (const p of [
      '/api/stats',
      '/api/stats/all',
      '/api/stats/page',
      '/api/stats/kpis',
      '/api/stats/year/2026',
      '/api/author/Ann%20Author',
    ]) {
      await get(p).expect(401);
    }
    const res = await request(dash.server).post('/api/login').send({ password: 'friends' });
    const reader = String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
    const theirs = (await json('/api/stats/all', reader)) as Bundle;
    // the reader's policy: weeks, not days, so no diary
    expect(theirs.calcs.diary).toEqual([]);
    expect(theirs.calcs.kpis).toEqual(await json('/api/stats/kpis', reader));
  });
});
