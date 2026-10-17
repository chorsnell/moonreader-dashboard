/**
 * Book clubs (BOO-58): B hosts a club on Beta (both are half way through it) with A, who
 * follows B's dashboard from their own. Comments past a reader's position are hidden from
 * them, on B's page and on A's; A comments from A's dashboard.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let a: TestDashboard;
let b: TestDashboard;
const cookies = new Map<TestDashboard, string>();
let clubId: string;
let bOnA: string; // B's slug among A's friends

const url = (d: TestDashboard) => `http://127.0.0.1:${(d.server.address() as AddressInfo).port}`;
const admin = (d: TestDashboard, method: 'get' | 'post' | 'put' | 'delete', path: string) =>
  request(d.server)[method](path).set('Cookie', cookies.get(d)!);

async function start(backup: Buffer): Promise<TestDashboard> {
  const d = await TestDashboard.start({ federationRefreshMinutes: 0 });
  await request(d.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup)
    .expect(200);
  expect(await waitFor(fileExists(d.path('data', 'meta.json')))).toBe(true);
  const res = await request(d.server).post('/api/login').send({ password: TOKEN }).expect(200);
  cookies.set(d, String(res.headers['set-cookie']?.[0] ?? '').split(';')[0]);
  return d;
}

/** `from` follows `to`, and `to` approves; returns `to`'s slug on `from` and the follower id. */
async function follow(from: TestDashboard, to: TestDashboard) {
  const res = await admin(from, 'post', '/api/admin/federation/following')
    .send({ url: url(to) })
    .expect(200);
  const followers = (await admin(to, 'get', '/api/admin/federation').expect(200)).body.followers;
  const f = followers.find((x: { url: string }) => x.url === url(from));
  await admin(to, 'post', `/api/admin/federation/followers/${f.id}/approve`)
    .send({ scope: 'everything' })
    .expect(200);
  await admin(from, 'post', '/api/admin/federation/refresh').send({}).expect(200);
  return { slug: res.body.following.slug as string, follower: f.id as string };
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-clubs-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  const backup = await readFile(join(tmp, 'test.mrpro'));
  a = await start(backup);
  b = await start(backup);
  await admin(a, 'put', '/api/admin/friends/settings').send({ share_name: 'Ann' }).expect(200);
  await admin(b, 'put', '/api/admin/friends/settings').send({ share_name: 'Bea' }).expect(200);
});

afterAll(async () => {
  await a.stop();
  await b.stop();
  await rm(tmp, { recursive: true, force: true });
});

describe('a book club', () => {
  it('is started by the admin with friends who follow each other', async () => {
    const aFollowsB = await follow(a, b);
    bOnA = aFollowsB.slug;
    const bFollowsA = await follow(b, a);
    await admin(b, 'post', '/api/admin/clubs')
      .send({ book: { title: 'Nope' }, start: 'soon' })
      .expect(400);
    const res = await admin(b, 'post', '/api/admin/clubs')
      .send({
        book: { title: 'Beta', author: 'Bob Writer', book_id: 'beta' },
        start: '2026-03-01',
        pct_per_week: 10,
        members: [{ friend: bFollowsA.slug, follower: aFollowsB.follower, name: 'Ann' }],
      })
      .expect(200);
    clubId = res.body.club.id;
    expect(res.body.club.members.map((m: { key: string }) => m.key)).toEqual([
      'me',
      `friend:${bFollowsA.slug}`,
    ]);
    expect(JSON.stringify(res.body)).not.toContain(aFollowsB.follower);
  });

  it('hides comments past where the reader is', async () => {
    await admin(b, 'post', `/api/admin/clubs/${clubId}/comments`)
      .send({ position: 30, text: 'Lovely start' })
      .expect(200);
    await admin(b, 'post', `/api/admin/clubs/${clubId}/comments`)
      .send({ position: 80, text: 'The butler did it' })
      .expect(200);
    await admin(b, 'post', `/api/admin/clubs/${clubId}/comments`)
      .send({ position: 120, text: 'x' })
      .expect(400);
    const { clubs } = (await admin(b, 'get', '/api/clubs').expect(200)).body;
    expect(clubs[0].progress).toBe(50);
    expect(clubs[0].comments).toMatchObject([
      { position: 30, text: 'Lovely start', hidden: false },
      { position: 80, text: null, hidden: true },
    ]);
    expect(JSON.stringify(clubs)).not.toContain('butler');
    // visitors see no clubs unless the admin shows them friends
    expect((await request(b.server).get('/api/clubs').expect(200)).body.clubs).toEqual([]);
  });

  it('reaches members on their own dashboard, still spoiler-safe', async () => {
    await admin(a, 'post', '/api/admin/federation/refresh').send({ slug: bOnA }).expect(200);
    const clubs = (await admin(a, 'get', `/friends/${bOnA}/clubs.json`).expect(200)).body;
    expect(clubs).toHaveLength(1);
    expect(clubs[0].progress).toBe(50);
    expect(clubs[0].members).toMatchObject([
      { name: 'Bea', host: true, you: false },
      { name: 'Ann', host: false, you: true },
    ]);
    expect(clubs[0].comments.map((c: { text: string | null }) => c.text)).toEqual([
      'Lovely start',
      null,
    ]);
    expect(clubs[0].comments[0].name).toBe('Bea');
    const index = (await admin(a, 'get', '/data/friends.json').expect(200)).body;
    expect(index.friends.find((f: { slug: string }) => f.slug === bOnA).clubs).toBe(1);
  });

  it('takes comments from members on their own dashboard', async () => {
    await admin(a, 'post', `/api/admin/federation/following/${bOnA}/clubs/${clubId}/comments`)
      .send({ position: 45, text: 'Agreed!' })
      .expect(200);
    const { clubs } = (await admin(b, 'get', '/api/clubs').expect(200)).body;
    expect(clubs[0].comments.map((c: { name: string; text: string }) => [c.name, c.text])).toEqual([
      ['Bea', 'Lovely start'],
      ['Ann', 'Agreed!'],
      ['Bea', null],
    ]);
    // nobody else can
    await request(b.server)
      .post(`/api/federation/clubs/${clubId}/comments`)
      .set('Authorization', 'Bearer nope')
      .send({ position: 1, text: 'hi' })
      .expect(401);
    await request(b.server).get('/api/federation/clubs').expect(401);
  });

  it('can be ended by the admin', async () => {
    await request(b.server).delete(`/api/admin/clubs/${clubId}`).expect(403);
    await admin(b, 'delete', `/api/admin/clubs/${clubId}`).expect(200);
    expect((await admin(b, 'get', '/api/clubs').expect(200)).body.clubs).toEqual([]);
  });
});
