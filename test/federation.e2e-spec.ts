/**
 * Federation (BOO-59), end to end with real installations in one process: A follows B (and
 * later C). B approves and chooses what A gets; A pulls B's share with the token it was given;
 * B revokes and A loses B's data at once; C goes offline and A keeps C as last seen.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let backup: Buffer;
let a: TestDashboard;
let b: TestDashboard;
let c: TestDashboard | null;
const cookies = new Map<TestDashboard, string>();

const url = (d: TestDashboard) => `http://127.0.0.1:${(d.server.address() as AddressInfo).port}`;

async function start(withData: boolean): Promise<TestDashboard> {
  const d = await TestDashboard.start({ federationRefreshMinutes: 0 });
  if (withData) {
    await request(d.server)
      .put('/upload?name=test.mrpro')
      .set('X-Upload-Token', TOKEN)
      .type('application/octet-stream')
      .send(backup)
      .expect(200);
    expect(await waitFor(fileExists(d.path('data', 'meta.json')))).toBe(true);
  }
  const res = await request(d.server).post('/api/login').send({ password: TOKEN }).expect(200);
  cookies.set(d, String(res.headers['set-cookie']?.[0] ?? '').split(';')[0]);
  return d;
}

const admin = (d: TestDashboard, method: 'get' | 'post' | 'put' | 'delete', path: string) =>
  request(d.server)[method](path).set('Cookie', cookies.get(d)!);
const overview = async (d: TestDashboard) =>
  (await admin(d, 'get', '/api/admin/federation').expect(200)).body;
const refresh = (d: TestDashboard) => admin(d, 'post', '/api/admin/federation/refresh').send({});
const friendsOf = async (d: TestDashboard) =>
  (await admin(d, 'get', '/data/friends.json').expect(200)).body.friends as {
    slug: string;
    name: string;
    source: string;
    status: string;
    updated: string;
    books: number;
    parts: string[];
  }[];

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-federation-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
  a = await start(false);
  b = await start(true);
  await admin(b, 'put', '/api/admin/friends/settings')
    .send({ share_name: 'Bea', leaderboards: ['books'] })
    .expect(200);
});

afterAll(async () => {
  for (const d of [a, b, c]) await d?.stop();
  await rm(tmp, { recursive: true, force: true });
});

describe('following a friend', () => {
  let bSlug: string;

  it('asks, and waits for approval', async () => {
    const res = await admin(a, 'post', '/api/admin/federation/following')
      .send({ url: `${url(b)}/` })
      .expect(200);
    expect(res.body.following).toMatchObject({ url: url(b), status: 'pending' });
    bSlug = res.body.following.slug;
    const req = (await overview(b)).followers;
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({ url: url(a), status: 'pending' });
    expect(JSON.stringify(req)).not.toMatch(/claim|token_hash|pickup/);
    await refresh(a).expect(200);
    expect(await friendsOf(a)).toEqual([]);
    // asking twice is refused
    await admin(a, 'post', '/api/admin/federation/following')
      .send({ url: url(b) })
      .expect(409);
  });

  it("can't collect the token without the claim", async () => {
    const [f] = (await overview(b)).followers;
    await request(b.server)
      .post(`/api/federation/follow/${f.id}/status`)
      .send({ claim: 'x'.repeat(40) })
      .expect(404);
    await request(b.server).get('/api/federation/share').expect(401);
    await request(b.server)
      .get('/api/federation/share')
      .set('Authorization', 'Bearer nope')
      .expect(401);
  });

  it('gets what the friend chose: stats only, without a hidden book', async () => {
    const [f] = (await overview(b)).followers;
    await admin(b, 'post', `/api/admin/federation/followers/${f.id}/approve`)
      .send({ scope: 'stats', hidden_books: ['beta'] })
      .expect(200);
    await refresh(a).expect(200);
    const [friend] = await friendsOf(a);
    expect(friend).toMatchObject({
      slug: bSlug,
      name: 'Bea',
      source: 'federation',
      status: 'ok',
      books: 1,
    });
    expect(friend.parts).toEqual(['books', 'reads', 'daily']);
    const books = (await admin(a, 'get', `/friends/${bSlug}/books.json`).expect(200)).body;
    expect(books.map((x: { id: string }) => x.id)).toEqual(['alpha']);
    expect((await admin(a, 'get', `/friends/${bSlug}/daily.json`).expect(200)).body).toEqual([]);
    // the token was handed over once and is kept only as a hash on B
    const bFile = await readFile(b.path('federation.json'), 'utf8');
    const aFile = JSON.parse(await readFile(a.path('federation.json'), 'utf8'));
    const token = aFile.following[0].token as string;
    expect(token.length).toBeGreaterThan(30);
    expect(bFile).not.toContain(token);
    expect((await stat(a.path('federation.json'))).mode & 0o077).toBe(0);
    expect((await overview(b)).followers[0].collected).toBe(true);
  });

  it('gets more when the friend shares more', async () => {
    const [f] = (await overview(b)).followers;
    await admin(b, 'put', `/api/admin/federation/followers/${f.id}`)
      .send({ scope: 'everything' })
      .expect(200);
    await refresh(a).expect(200);
    const [friend] = await friendsOf(a);
    expect(friend.books).toBe(2);
    const daily = (await admin(a, 'get', `/friends/${bSlug}/daily.json`).expect(200)).body;
    expect(daily.length).toBeGreaterThan(0);
  });

  it('loses access the moment the friend revokes it', async () => {
    const token = JSON.parse(await readFile(a.path('federation.json'), 'utf8')).following[0]
      .token as string;
    await request(b.server)
      .get('/api/federation/share')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const [f] = (await overview(b)).followers;
    await admin(b, 'post', `/api/admin/federation/followers/${f.id}/revoke`).expect(200);
    await request(b.server)
      .get('/api/federation/share')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await refresh(a).expect(200);
    expect(await friendsOf(a)).toEqual([]);
    await admin(a, 'get', `/friends/${bSlug}/books.json`).expect(404);
    expect((await overview(a)).following[0].status).toBe('revoked');
  });
});

describe('a friend whose dashboard goes offline', () => {
  it('stays, as last seen, marked offline', async () => {
    c = await start(true);
    const res = await admin(a, 'post', '/api/admin/federation/following')
      .send({ url: url(c) })
      .expect(200);
    const [f] = (await overview(c)).followers;
    await admin(c, 'post', `/api/admin/federation/followers/${f.id}/approve`)
      .send({ scope: 'everything' })
      .expect(200);
    await refresh(a).expect(200);
    const before = (await friendsOf(a)).find((x) => x.slug === res.body.following.slug)!;
    expect(before.status).toBe('ok');
    await c.stop();
    c = null;
    await refresh(a).expect(200);
    const after = (await friendsOf(a)).find((x) => x.slug === res.body.following.slug)!;
    expect(after).toMatchObject({ status: 'offline', updated: before.updated, books: 2 });
    const row = (await overview(a)).following.find(
      (x: { slug: string }) => x.slug === res.body.following.slug,
    );
    expect(row.status).toBe('offline');
    expect(row.last_error).toBeTruthy();
    // unfollowing forgets them
    await admin(a, 'delete', `/api/admin/federation/following/${res.body.following.slug}`).expect(
      200,
    );
    expect(await friendsOf(a)).toEqual([]);
  });
});

describe('follow requests', () => {
  it('are refused when the admin says so, and checked', async () => {
    await admin(b, 'put', '/api/admin/friends/settings')
      .send({ accept_follows: false })
      .expect(200);
    const ask = (body: object) => request(b.server).post('/api/federation/follow').send(body);
    await ask({ url: 'https://x.example', claim: 'c'.repeat(40), name: 'X' }).expect(403);
    await admin(b, 'put', '/api/admin/friends/settings').send({ accept_follows: true }).expect(200);
    await ask({ url: 'ftp://x.example', claim: 'c'.repeat(40) }).expect(400);
    await ask({ url: 'https://x.example', claim: 'short' }).expect(400);
    await ask({ url: 'https://x.example', claim: 'c'.repeat(40) }).expect(202);
  });

  it('need an admin on the other end', async () => {
    const d = await TestDashboard.start({ uploadToken: '', federationRefreshMinutes: 0 });
    try {
      await request(d.server)
        .post('/api/federation/follow')
        .send({ url: 'https://x.example', claim: 'c'.repeat(40) })
        .expect(404);
    } finally {
      await d.stop();
    }
  });

  it("can't be managed by anyone but the admin", async () => {
    await request(b.server).get('/api/admin/federation').expect(403);
    await request(b.server)
      .post('/api/admin/federation/following')
      .send({ url: url(a) })
      .expect(403);
  });
});
