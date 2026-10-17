/**
 * What visitors may see is enforced on the server: the data files, covers and /api/config
 * are filtered per role, so hiding something in the page can't be got round by asking for
 * the file. The fake backup: Alpha (finished, with a cover, a highlight and a note) and Beta.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PRESETS } from '../src/privacy/privacy';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let backup: Buffer;
let dash: TestDashboard;
let admin: string;

const DATA = [
  'books.json',
  'reads.json',
  'daily.json',
  'highlights.json',
  'prices.json',
  'meta.json',
];

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-privacy-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
  dash = await TestDashboard.start();
  await request(dash.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup)
    .expect(200);
  expect(await waitFor(fileExists(dash.path('data', 'meta.json')))).toBe(true);
  admin = await signIn(TOKEN);
});

afterAll(async () => {
  await dash.stop();
  await rm(tmp, { recursive: true, force: true });
});

async function signIn(password: string): Promise<string> {
  const res = await request(dash.server).post('/api/login').send({ password }).expect(200);
  return String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
}

const get = (path: string, cookie = '') => {
  const req = request(dash.server).get(path);
  return cookie ? req.set('Cookie', cookie) : req;
};
const json = async (path: string, cookie = '') => (await get(path, cookie).expect(200)).body;
const setPrivacy = (body: object, cookie = admin) =>
  request(dash.server).put('/api/admin/privacy').set('Cookie', cookie).send(body);
const everything = { ...PRESETS.everything };

/** Every data file a visitor can fetch, as one string to search. */
async function everythingServed(cookie = ''): Promise<string> {
  const parts = await Promise.all(
    [...DATA.map((f) => `/data/${f}`), '/api/config', '/api/covers'].map(async (p) => {
      const res = await get(p, cookie);
      return res.status === 200 ? JSON.stringify(res.body) : '';
    }),
  );
  return parts.join('\n');
}

describe('by default', () => {
  it('keeps highlights and the full history from the public, not from the admin', async () => {
    await setPrivacy({}).expect(200);
    expect(await json('/data/highlights.json')).toEqual([]);
    expect((await json('/data/highlights.json', admin)).length).toBeGreaterThan(0);
    await get('/data/reading_history.json').expect(404);
    await get('/data/reading_history.json', admin).expect(200);
    const cfg = await json('/api/config');
    expect(cfg.privacy).toEqual({ hidden: ['highlights'], dates: 'day', private_books: false });
    expect(cfg.last_build).toBeNull(); // its time of day gives away the last sync
    expect((await json('/api/config', admin)).privacy).toBeNull();
    // the rest is as before
    expect(await json('/data/daily.json')).toEqual(await json('/data/daily.json', admin));
    const res = await get('/data/books.json');
    expect(res.headers.vary).toMatch(/Cookie/);
  });
});

describe('the admin choosing', () => {
  it('is admin only', async () => {
    for (const cookie of ['', 'mrd_session=admin.9999999999.forged']) {
      const req = request(dash.server).put('/api/admin/privacy');
      if (cookie) req.set('Cookie', cookie);
      expect((await req.send({ public: PRESETS.everything })).status).toBe(403);
      const prev = request(dash.server).post('/api/admin/preview');
      if (cookie) prev.set('Cookie', cookie);
      expect((await prev.send({ as: 'public' })).status).toBe(403);
    }
    const back = await json('/api/admin/privacy', admin);
    expect(back.presets.taste).toEqual(PRESETS.taste);
    await get('/api/admin/privacy').expect(403);
  });

  it('"taste only" leaves no routine in anything the public can fetch', async () => {
    const saved = await setPrivacy({ public: PRESETS.taste, reader: everything }).expect(200);
    expect(saved.body.privacy.public).toEqual(PRESETS.taste);
    expect(JSON.parse(await readFile(dash.path('settings.json'), 'utf8')).privacy.public).toEqual(
      PRESETS.taste,
    );

    expect(await json('/data/daily.json')).toEqual([]);
    expect(await json('/data/highlights.json')).toEqual([]);
    const books = (await json('/data/books.json')) as Record<string, unknown>[];
    expect(books.map((b) => b.last_read)).toEqual([null, null]);
    expect(books.map((b) => b.title).sort()).toEqual(['Alpha', 'Beta']); // taste is still there
    const reads = (await json('/data/reads.json')) as { start: string; end: string }[];
    expect(reads.map((r) => [r.start, r.end])).toEqual([
      ['2026-03-01', '2026-03-01'],
      ['2026-03-01', '2026-03-01'],
    ]);
    const meta = await json('/data/meta.json');
    expect(meta.generated).toMatch(/^\d{4}-\d{2}-01$/); // no day, no time of day

    // no exact day or time of day anywhere: the backup has 1-6 March and highlight times
    const all = await everythingServed();
    expect(all).not.toMatch(/2026-03-0[2-9]/);
    expect(all).not.toMatch(/T\d{2}:\d{2}/);
    expect(all).not.toMatch(/stormy|Ending!/);

    const cfg = await json('/api/config');
    expect(cfg.privacy.hidden).toEqual([
      'exact_dates',
      'diary',
      'current',
      'streaks',
      'money',
      'highlights',
    ]);
    expect(cfg.privacy.dates).toBe('month');

    // the admin still gets everything
    expect((await json('/data/daily.json', admin)).length).toBe(5);
    expect((await json('/api/config', admin)).meta.generated).toMatch(/T/);
  });

  it('"everything but exact dates" keeps weeks, not days', async () => {
    await setPrivacy({ public: PRESETS.no_dates }).expect(200);
    expect(await json('/data/daily.json')).toEqual([]); // the diary is day by day
    const reads = (await json('/data/reads.json')) as { start: string; end: string }[];
    // 1-3 March 2026 (Sun-Tue) and 4-6 March: the Mondays of their weeks
    expect(reads.map((r) => [r.start, r.end])).toEqual([
      ['2026-02-23', '2026-03-02'],
      ['2026-03-02', '2026-03-02'],
    ]);
    const hl = (await json('/data/highlights.json')) as { date: string; time: unknown }[];
    expect(hl.length).toBeGreaterThan(0);
    expect(hl.every((h) => h.time === null && /^2026-0[23]-(23|02)$/.test(h.date))).toBe(true);
  });

  it('hides streaks by coarsening the diary to weeks', async () => {
    await setPrivacy({ public: { ...everything, streaks: false } }).expect(200);
    const daily = (await json('/data/daily.json')) as { date: string; minutes: number }[];
    expect([...new Set(daily.map((d) => d.date))].sort()).toEqual(['2026-02-23', '2026-03-02']);
    const adminDaily = (await json('/data/daily.json', admin)) as { minutes: number }[];
    const sum = (rows: { minutes: number }[]) => rows.reduce((a, d) => a + d.minutes, 0);
    expect(sum(daily)).toBe(sum(adminDaily)); // the totals still add up
  });

  it('gives read-password visitors their own policy', async () => {
    await setPrivacy({ public: PRESETS.taste, reader: { ...everything, highlights: true } }).expect(
      200,
    );
    await request(dash.server)
      .post('/api/access')
      .set('Cookie', admin)
      .send({ access: 'password', password: 'friends' })
      .expect(200);
    const reader = await signIn('friends');
    expect((await json('/data/daily.json', reader)).length).toBe(5);
    expect((await json('/data/highlights.json', reader)).length).toBeGreaterThan(0);
    expect((await json('/api/config', reader)).privacy.hidden).toEqual([]);
    await get('/data/daily.json').expect(401); // and the public can't see it at all now
    await get('/data/reading_history.json', reader).expect(404);
    await request(dash.server)
      .post('/api/access')
      .set('Cookie', admin)
      .send({ access: 'public' })
      .expect(200);
  });
});

describe('private books', () => {
  it('are left out of every file and their covers refused', async () => {
    await setPrivacy({ public: everything, private_books: ['alpha'] }).expect(200);
    const all = await everythingServed();
    expect(all).not.toMatch(/alpha|Alpha|Ann Author|stormy/);
    expect(all).toContain('Beta');
    expect(await json('/api/covers')).toEqual({});
    await get('/covers/alpha.png').expect(404);
    await get('/covers/alpha.png', admin).expect(200);
    expect((await json('/api/config')).privacy.private_books).toBe(true);
    // the admin sees them
    expect(await everythingServed(admin)).toContain('Alpha');
  });

  it('can be shown as "A private book" instead', async () => {
    await setPrivacy({
      public: everything,
      private_books: ['alpha'],
      private_mode: 'anonymise',
    }).expect(200);
    const books = (await json('/data/books.json')) as Record<string, unknown>[];
    expect(books.find((b) => b.title === 'A private book')).toMatchObject({
      id: 'private-1',
      author: '',
      genre: 'Private',
      status: 'finished',
    });
    const all = await everythingServed();
    expect(all).not.toMatch(/alpha|Alpha|Ann Author|stormy|Ending/);
    expect(((await json('/data/daily.json')) as unknown[]).length).toBe(5); // the reading counts
  });

  it('can be chosen by genre', async () => {
    await setPrivacy({ public: everything, private_genres: ['untagged'] }).expect(200);
    expect(await json('/data/books.json')).toEqual([]); // every fake book is untagged
    expect(await json('/data/reads.json')).toEqual([]);
  });
});

describe('prices', () => {
  it('leave out or anonymise private books when money is shown', async () => {
    const put = (id: string, body: object) =>
      request(dash.server).put(`/api/admin/prices/books/${id}`).set('Cookie', admin).send(body);
    await put('alpha', {
      title: 'Alpha',
      author: 'Ann Author',
      price: 4.5,
      currency: 'GBP',
      store: 'Alpha Shop',
    }).expect(200);
    await put('beta', { title: 'Beta', author: 'Bob Writer', price: 3, currency: 'GBP' }).expect(
      200,
    );
    const books = async (cookie = '') =>
      ((await json('/data/prices.json', cookie)) as { books: Record<string, unknown>[] }).books;
    expect((await books(admin)).map((b) => b.title).sort()).toEqual(['Alpha', 'Beta']);

    await setPrivacy({ public: everything, private_books: ['alpha'] }).expect(200);
    expect((await books()).map((b) => b.book_id)).toEqual(['beta']);
    expect(await everythingServed()).not.toMatch(/Alpha|Ann Author|Alpha Shop/);

    await setPrivacy({
      public: everything,
      private_books: ['alpha'],
      private_mode: 'anonymise',
    }).expect(200);
    const anon = (await books()).find((b) => b.title === 'A private book')!;
    expect(anon).toMatchObject({ book_id: 'private-1', author: '', price: 4.5, store: null });
    expect(await everythingServed()).not.toMatch(/Alpha|Ann Author|Alpha Shop/);

    await setPrivacy({ public: { ...everything, money: false } }).expect(200);
    expect(await json('/data/prices.json')).toEqual([]);
  });
});

describe('preview as visitor', () => {
  it('shows the admin what the public would get, until stopped', async () => {
    await setPrivacy({ public: PRESETS.taste, private_books: ['alpha'] }).expect(200);
    const on = await request(dash.server)
      .post('/api/admin/preview')
      .set('Cookie', admin)
      .send({ as: 'public' })
      .expect(200);
    const preview = String(on.headers['set-cookie']?.[0] ?? '').split(';')[0];
    expect(preview).toBe('mrd_preview=public');
    const both = `${admin}; ${preview}`;
    expect(await json('/data/daily.json', both)).toEqual([]);
    expect(JSON.stringify(await json('/data/books.json', both))).not.toContain('Alpha');
    const cfg = await json('/api/config', both);
    expect([cfg.role, cfg.preview, cfg.uploads]).toEqual(['admin', 'public', true]);
    expect(cfg.privacy.hidden).toContain('diary');

    // the cookie alone does nothing for a visitor, and only the admin's own view is full
    expect(await json('/data/daily.json', preview)).toEqual([]);
    const off = await request(dash.server)
      .post('/api/admin/preview')
      .set('Cookie', both)
      .send({})
      .expect(200);
    expect(String(off.headers['set-cookie']?.[0])).toContain('Max-Age=0');
    expect((await json('/data/daily.json', admin)).length).toBe(5);
  });
});
