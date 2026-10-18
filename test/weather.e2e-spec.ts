/**
 * Reading and the weather (BOO-85): the admin endpoints against a fake Open-Meteo (geocoding
 * and archive), the cache, failing soft offline, and what visitors get of data/weather.json.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PRESETS } from '../src/privacy/privacy';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;
let meteo: Server;
let base = '';
let calls: URL[] = [];
let down = false;

const DAY_MS = 86_400_000;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-weather-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
  meteo = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    calls.push(u);
    res.setHeader('Content-Type', 'application/json');
    if (down) {
      res.writeHead(503).end(JSON.stringify({ error: true, reason: 'Down for a bit' }));
    } else if (u.pathname === '/v1/search') {
      const found = u.searchParams.get('name') === 'Leeds';
      res.end(
        JSON.stringify(
          found
            ? {
                results: [
                  { name: 'Leeds', country: 'United Kingdom', latitude: 53.8, longitude: -1.55 },
                ],
              }
            : {},
        ),
      );
    } else if (u.pathname === '/v1/archive') {
      const start = Date.parse(u.searchParams.get('start_date')!);
      const end = Date.parse(u.searchParams.get('end_date')!);
      const time: string[] = [];
      for (let t = start; t <= end; t += DAY_MS) time.push(new Date(t).toISOString().slice(0, 10));
      res.end(
        JSON.stringify({
          daily: {
            time,
            temperature_2m_max: time.map(() => 12),
            temperature_2m_min: time.map(() => 4),
            precipitation_sum: time.map((_, i) => (i % 2 ? 6 : 0)),
            daylight_duration: time.map(() => 36_000),
          },
        }),
      );
    } else res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => meteo.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(meteo.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => meteo.close(() => r()));
  await rm(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  down = false;
});

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

async function withData(): Promise<TestDashboard> {
  const d = await TestDashboard.start({
    weatherLookup: true,
    weatherArchiveUrl: base,
    weatherGeocodingUrl: base,
  });
  await request(d.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup)
    .expect(200);
  expect(await waitFor(fileExists(d.path('data', 'meta.json')))).toBe(true);
  return d;
}

const admin = (d: TestDashboard) => ({
  get: (url: string) => request(d.server).get(url).set('X-Upload-Token', TOKEN),
  put: (url: string, body: object) =>
    request(d.server).put(url).set('X-Upload-Token', TOKEN).send(body),
  post: (url: string) => request(d.server).post(url).set('X-Upload-Token', TOKEN).send({}),
});

describe('weather', () => {
  it('is only for the admin', async () => {
    dash = await TestDashboard.start({ weatherArchiveUrl: base, weatherGeocodingUrl: base });
    await request(dash.server).get('/api/admin/weather').expect(403);
    await request(dash.server)
      .put('/api/admin/weather/location')
      .send({ place: 'Leeds' })
      .expect(403);
    expect(calls).toEqual([]);
  });

  it('finds a place, fetches and caches its weather, and serves it without the location', async () => {
    dash = await withData();
    const a = admin(dash);
    await a.put('/api/admin/weather/location', { place: 'Atlantis' }).expect(400);
    const r = await a.put('/api/admin/weather/location', { place: 'Leeds' }).expect(200);
    expect(r.body.location).toMatchObject({ name: 'Leeds, United Kingdom', lat: 53.8 });
    expect(r.body.error).toBeNull();
    expect(r.body.days).toBeGreaterThan(0); // by this call, or by the rebuild that came just before
    const archive = calls.filter((c) => c.pathname === '/v1/archive');
    expect(archive).toHaveLength(1);
    expect(archive[0].searchParams.get('latitude')).toBe('53.8');
    // from the first logged day in the fake backup
    expect(archive[0].searchParams.get('start_date')).toBe('2026-03-01');

    const served = (await a.get('/data/weather.json').expect(200)).body;
    expect(served[0]).toEqual({
      date: '2026-03-01',
      t_max: 12,
      t_min: 4,
      precip_mm: 0,
      daylight_h: 10,
    });
    expect(JSON.stringify(served)).not.toMatch(/Leeds|53\.8/);

    // cached: asking again fetches nothing
    calls = [];
    expect((await a.post('/api/admin/weather/refresh').expect(200)).body.added).toBe(0);
    expect(calls).toEqual([]);
  });

  it('takes coordinates, and fails soft offline', async () => {
    dash = await withData();
    const a = admin(dash);
    down = true;
    const r = await a.put('/api/admin/weather/location', { place: '51.5, -0.12' }).expect(200);
    expect(r.body.location).toMatchObject({ lat: 51.5, lon: -0.12 });
    expect(r.body.error).toMatch(/503.*Down for a bit/);
    expect(r.body.days).toBe(0);
    down = false;
    const again = await a.post('/api/admin/weather/refresh').expect(200);
    expect(again.body.error).toBeNull();
    expect(again.body.days).toBeGreaterThan(0);
    // a place name while offline is a 400 with a reason, and keeps the old location
    down = true;
    const geo = await a.put('/api/admin/weather/location', { place: 'Leeds' }).expect(400);
    expect(geo.body.error).toMatch(/503/);
    expect((await a.get('/api/admin/weather').expect(200)).body.location.lat).toBe(51.5);
  });

  it('is kept from visitors without exact days', async () => {
    dash = await withData();
    const a = admin(dash);
    await a.put('/api/admin/weather/location', { place: 'Leeds' }).expect(200);
    await a.put('/api/admin/privacy', { public: PRESETS.everything }).expect(200);
    expect(
      (await request(dash.server).get('/data/weather.json').expect(200)).body.length,
    ).toBeGreaterThan(0);
    await a.put('/api/admin/privacy', { public: PRESETS.no_dates }).expect(200);
    expect((await request(dash.server).get('/data/weather.json').expect(200)).body).toEqual([]);
    await a
      .put('/api/admin/privacy', { public: { ...PRESETS.everything, diary: false } })
      .expect(200);
    expect((await request(dash.server).get('/data/weather.json').expect(200)).body).toEqual([]);
  });
});
