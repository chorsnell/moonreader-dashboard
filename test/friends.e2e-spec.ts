/**
 * Friends' reading in your dashboard (BOO-30): exporting your share file through the friends
 * privacy policy, adding a friend's, and who may see friends' data.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PRESETS } from '../src/privacy/privacy';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let dash: TestDashboard;
let admin: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-friends-'));
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

const as = (req: request.Test, cookie = admin) => (cookie ? req.set('Cookie', cookie) : req);
const exportBundle = async () =>
  (await as(request(dash.server).get('/api/admin/share')).expect(200)).body as Record<
    string,
    unknown
  > & { books: { id: string; title: string }[]; daily: unknown[]; highlights?: unknown[] };
const upload = (body: unknown, name = '') =>
  as(request(dash.server).put(`/api/admin/friends/upload${name ? `?name=${name}` : ''}`))
    .type('application/octet-stream')
    .send(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));

describe('your share file', () => {
  it('is admin only', async () => {
    await request(dash.server).get('/api/admin/share').expect(403);
    await request(dash.server).get('/api/admin/friends').expect(403);
    await request(dash.server).put('/api/admin/friends/upload').send('{}').expect(403);
  });

  it('carries what the friends policy allows, under your share name', async () => {
    await as(request(dash.server).put('/api/admin/friends/settings'))
      .send({ share_name: 'Sam', leaderboards: ['books', 'bogus'] })
      .expect(200);
    const b = await exportBundle();
    expect(b.format).toBe('moonreader-dashboard/share');
    expect(b.profile).toMatchObject({ name: 'Sam', leaderboards: ['books'] });
    expect(b.books.map((x) => x.title).sort()).toEqual(['Alpha', 'Beta']);
    expect(b.daily.length).toBeGreaterThan(0);
    expect(b.highlights).toBeUndefined(); // friends don't get highlights by default
    expect(b.privacy).toEqual({ hidden: ['money', 'highlights'], dates: 'day' });
  });

  it('follows the friends policy and leaves private books out', async () => {
    await as(request(dash.server).put('/api/admin/privacy'))
      .send({ friends: PRESETS.taste, private_books: ['beta'] })
      .expect(200);
    const b = await exportBundle();
    expect(b.books.map((x) => x.id)).toEqual(['alpha']);
    expect(b.daily).toEqual([]);
    expect(JSON.stringify(b)).not.toMatch(/2026-03-0[2-9]/);
    // visitors' policies are their own
    const pub = (await request(dash.server).get('/data/daily.json').expect(200)).body as unknown[];
    expect(pub.length).toBeGreaterThan(0);
    await as(request(dash.server).put('/api/admin/privacy')).send({}).expect(200);
  });
});

describe("a friend's share file", () => {
  it('is checked before it is kept', async () => {
    expect((await upload('not json').expect(400)).body.error).toMatch(/isn't JSON/);
    expect((await upload({ format: 'x' }).expect(400)).body.error).toMatch(/isn't a reading/);
  });

  it('is kept under their name and shown to the admin only', async () => {
    const bundle = await exportBundle();
    const res = await upload(bundle, 'Jo').expect(200);
    expect(res.body.friend).toMatchObject({ slug: 'jo', name: 'Jo', source: 'upload', books: 2 });
    const index = (await as(request(dash.server).get('/data/friends.json')).expect(200)).body;
    expect(index.me).toEqual({ name: 'Sam', leaderboards: ['books'] });
    expect(index.friends.map((f: { slug: string }) => f.slug)).toEqual(['jo']);
    const books = (await as(request(dash.server).get('/friends/jo/books.json')).expect(200)).body;
    expect(books).toHaveLength(2);
    await as(request(dash.server).get('/friends/jo/settings.json')).expect(404);
    await as(request(dash.server).get('/friends/..%2Fdata/books.json')).expect(404);
    // nobody else, by default
    expect((await request(dash.server).get('/data/friends.json').expect(200)).body).toEqual({
      me: null,
      friends: [],
    });
    await request(dash.server).get('/friends/jo/books.json').expect(404);
  });

  it('replaces their data when added again under the same name', async () => {
    const bundle = await exportBundle();
    await upload({ ...bundle, books: bundle.books.slice(0, 1) }, 'Jo').expect(200);
    const list = (await as(request(dash.server).get('/api/admin/friends')).expect(200)).body;
    expect(list.friends).toHaveLength(1);
    expect(list.friends[0].books).toBe(1);
  });

  it('can be shown to visitors when the admin chooses', async () => {
    await as(request(dash.server).put('/api/admin/friends/settings'))
      .send({ visible_to: 'public' })
      .expect(200);
    const seen = (await request(dash.server).get('/data/friends.json').expect(200)).body;
    expect(seen.friends).toHaveLength(1);
    await request(dash.server).get('/friends/jo/reads.json').expect(200);
    await as(request(dash.server).put('/api/admin/friends/settings'))
      .send({ visible_to: 'admin' })
      .expect(200);
    expect((await request(dash.server).get('/data/friends.json')).body.friends).toEqual([]);
  });

  it('can be removed', async () => {
    await as(request(dash.server).delete('/api/admin/friends/jo')).expect(200);
    await as(request(dash.server).delete('/api/admin/friends/jo')).expect(404);
    const index = (await as(request(dash.server).get('/data/friends.json')).expect(200)).body;
    expect(index.friends).toEqual([]);
  });
});
