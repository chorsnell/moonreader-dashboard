/**
 * The "now" summary for Home Assistant (BOO-71): who may read it, the device token, and
 * that it never says more than the asker's privacy role allows. The fake backup: Alpha by
 * Ann Author (finished, with a cover and highlights) and Beta by Bob Writer (half way).
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
  tmp = await mkdtemp(join(tmpdir(), 'e2e-outbound-'));
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
const asAdmin = (method: 'put' | 'post' | 'delete', path: string, body?: object) =>
  request(dash.server)[method](path).set('Cookie', admin).send(body);
const setPrivacy = (body: object) => asAdmin('put', '/api/admin/privacy', body).expect(200);
const setAccess = (body: object) => asAdmin('post', '/api/access', body).expect(200);

describe('GET /api/now', () => {
  it('sums up now for a public dashboard', async () => {
    await setPrivacy({ public: PRESETS.everything });
    const now = (await get('/api/now').expect(200)).body;
    expect(now.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(now.as_of).toBe('2026-03-06');
    expect(now.reading).toEqual(expect.any(Array));
    expect(now.streak).toMatchObject({ current: expect.any(Number), at_risk: expect.any(Boolean) });
    expect(now.year).toMatchObject({ goal: null, finished: expect.any(Number) });
    expect(now.quote).toMatchObject({ title: 'Alpha', text: expect.any(String) });
    // by default the public don't get highlights
    await setPrivacy({});
    expect((await get('/api/now').expect(200)).body.quote).toBeNull();
  });

  it('keeps to what the role may see', async () => {
    await setPrivacy({ public: PRESETS.taste, private_books: ['alpha'] });
    const now = (await get('/api/now').expect(200)).body;
    expect(now.reading).toBeNull();
    expect(now.streak).toBeNull();
    expect(now.today_minutes).toBeNull();
    expect(JSON.stringify(now)).not.toMatch(/Alpha|Ann Author|dark and stormy/);
    // the admin gets everything
    const mine = (await get('/api/now', admin).expect(200)).body;
    expect(mine.streak).not.toBeNull();
    await setPrivacy({});
  });

  it('needs sign-in or the device token behind a read password', async () => {
    await setAccess({ access: 'password', password: 'letmein' });
    await get('/api/now').expect(401);
    await get('/api/now/cover').expect(401);
    const made = await asAdmin('post', '/api/admin/outbound/token').expect(200);
    const token = String(made.body.token);
    expect(token.length).toBeGreaterThan(20);
    // a token is never shown again
    const st = (await get('/api/admin/outbound', admin).expect(200)).body;
    expect(st).toMatchObject({ device_token: true, device_audience: 'admin' });
    expect(JSON.stringify(st)).not.toContain(token);
    // three ways to send it
    await get('/api/now').set('Authorization', `Bearer ${token}`).expect(200);
    await get('/api/now').set('X-Device-Token', token).expect(200);
    await get(`/api/now?token=${encodeURIComponent(token)}`).expect(200);
    await get('/api/now').set('Authorization', 'Bearer nope').expect(401);
    // it opens nothing else
    await get('/data/books.json').set('Authorization', `Bearer ${token}`).expect(401);
    await get('/api/stats/kpis').set('Authorization', `Bearer ${token}`).expect(401);
    await request(dash.server)
      .get('/api/admin/outbound')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    // the token's view can be a visitor's
    await setPrivacy({ public: PRESETS.taste });
    await asAdmin('put', '/api/admin/outbound/audience', { audience: 'public' }).expect(200);
    const pub = (await get('/api/now').set('Authorization', `Bearer ${token}`).expect(200)).body;
    expect(pub.streak).toBeNull();
    await asAdmin('put', '/api/admin/outbound/audience', { audience: 'nobody' }).expect(400);
    await asAdmin('put', '/api/admin/outbound/audience', { audience: 'admin' }).expect(200);
    // revoked: refused at once
    await asAdmin('delete', '/api/admin/outbound/token').expect(200);
    await get('/api/now').set('Authorization', `Bearer ${token}`).expect(401);
    await setAccess({ access: 'public' });
    await setPrivacy({});
  });

  it('shows progress against the goal the admin sets', async () => {
    await asAdmin('put', '/api/admin/outbound/goal', { goal: 0.5 }).expect(400);
    await asAdmin('put', '/api/admin/outbound/goal', { goal: 5000 }).expect(400);
    await asAdmin('put', '/api/admin/outbound/goal', { goal: 12 }).expect(200);
    const now = (await get('/api/now').expect(200)).body;
    expect(now.year).toMatchObject({ goal: 12, expected: expect.any(Number) });
    await request(dash.server).put('/api/admin/outbound/goal').send({ goal: 3 }).expect(403);
    await asAdmin('put', '/api/admin/outbound/goal', { goal: null }).expect(200);
    expect((await get('/api/now').expect(200)).body.year.goal).toBeNull();
  });

  it('serves the current cover, or 404 without one', async () => {
    // Beta is the book on the go and has no cover; Alpha, finished, isn't current
    await get('/api/now/cover', admin).expect(404);
  });
});

describe('GET /badge/*.svg', () => {
  afterAll(async () => {
    await setAccess({ access: 'public' });
    await setPrivacy({});
  });

  const svgOf = async (path: string, cookie = '') =>
    String((await get(path, cookie).buffer(true).expect(200)).body);

  it('serves SVG badges from what the public may see, cached', async () => {
    await setPrivacy({ public: PRESETS.everything });
    const res = await get('/badge/reading.svg').buffer(true).expect(200);
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(res.headers['cache-control']).toBe('public, max-age=1800');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    const svg = String(res.body);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('Beta');
    await get('/badge/reading.svg').set('If-None-Match', String(res.headers.etag)).expect(304);
    expect(await svgOf('/badge/reading.svg?theme=dark')).toContain('#211f1d');
    expect(await svgOf('/badge/year.svg')).toContain('Books in');
    expect(await svgOf('/badge/year.svg?style=card')).toContain('hours');
    expect(await svgOf('/badge/heatmap.svg?weeks=52')).toContain('days');
    await get('/badge/nope.svg').expect(404);
  });

  it('shows the public view even to the admin, and keeps to it', async () => {
    await setPrivacy({ public: PRESETS.taste, private_books: ['beta'] });
    const reading = await svgOf('/badge/reading.svg', admin);
    expect(reading).toContain('Not shared');
    expect(reading).not.toContain('Beta');
    expect(await svgOf('/badge/year.svg?style=card', admin)).not.toContain('hours');
    await get('/badge/heatmap.svg').expect(404);
  });

  it('are off behind a read password', async () => {
    await setAccess({ access: 'password', password: 'letmein' });
    await get('/badge/year.svg').expect(404);
    await get('/badge/year.svg', admin).expect(404);
  });
});
