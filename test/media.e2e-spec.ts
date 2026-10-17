/**
 * Other media end to end: upload a Netflix export, choose a profile, and get media_*.json,
 * with TMDB played by a local server.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { ZipFile } from 'yazl';
import { JPEG } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

const HEADER =
  'Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country';
const ACTIVITY = [
  HEADER,
  'Chris,2025-01-04 12:00:00,00:50:00,,Copper Valley: Season 1: Pilot,,Smart TV,00:50:00,Not latest view,GB (United Kingdom)',
  'Chris,2025-01-05 12:00:00,00:49:00,,Copper Valley: Season 1: The Mine,,Smart TV,00:49:00,Latest view,GB (United Kingdom)',
  'Chris,2025-01-05 13:00:00,00:00:40,,Copper Valley: Season 1: Teaser,TRAILER,Smart TV,00:00:40,Latest view,GB (United Kingdom)',
  'Chris,2025-02-01 12:00:00,02:20:00,,Metropolis,,Laptop,02:20:00,Latest view,GB (United Kingdom)',
  'Sam,2025-02-02 12:00:00,01:00:00,,Something Else,,Phone,01:00:00,Latest view,GB (United Kingdom)',
].join('\n');

interface ItemRow {
  id: string;
  media: string;
  title: string;
  genre: string | null;
  units: number | null;
  units_total: number | null;
  status: string;
}

let dash: TestDashboard | undefined;

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

const uploadCsv = (d: TestDashboard, body: Buffer | string, name = 'ViewingActivity.csv') =>
  request(d.server)
    .put(`/upload?source=netflix&name=${name}`)
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(Buffer.from(body));

const items = (d: TestDashboard) => d.json<ItemRow[]>('data', 'media_items.json');
const mediaBuilt = (d: TestDashboard) => fileExists(d.path('data', 'media_meta.json'));

function zipOf(name: string, text: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from(text), name);
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

describe('Netflix import', () => {
  it('waits for the admin to choose a profile, then builds the media files', async () => {
    dash = await TestDashboard.start();
    const res = await uploadCsv(dash, ACTIVITY).expect(200);
    expect(res.body.profiles).toEqual(['Chris', 'Sam']);
    expect(await waitFor(mediaBuilt(dash))).toBe(true);
    expect(fileExists(dash.path('data', 'media_items.json'))()).toBe(false);

    const status = await request(dash.server)
      .get('/api/admin/media')
      .set('X-Upload-Token', TOKEN)
      .expect(200);
    expect(status.body.netflix.profiles_found).toEqual(['Chris', 'Sam']);
    expect(status.body.netflix.profiles).toEqual([]);
    await request(dash.server).get('/api/admin/media').expect(403);

    await request(dash.server)
      .post('/api/admin/media/netflix')
      .set('X-Upload-Token', TOKEN)
      .send({ profiles: ['Chris'] })
      .expect(200);
    expect(await waitFor(fileExists(dash.path('data', 'media_items.json')))).toBe(true);
    const rows = await items(dash);
    expect(rows.map((r) => [r.id, r.media, r.units])).toEqual([
      ['tv-copper-valley-s1', 'tv', 2],
      ['film-metropolis', 'film', null],
    ]);
    for (const f of ['media_runs', 'media_daily', 'media_sessions', 'media_parts']) {
      const data = await request(dash.server).get(`/data/${f}.json`).expect(200);
      expect(Array.isArray(data.body)).toBe(true);
    }
    // no books, but something to show
    const config = await request(dash.server).get('/api/config').expect(200);
    expect(config.body).toMatchObject({ has_data: true, has_books: false, has_media: true });
  });

  it("takes the zip Netflix sends, and refuses files that aren't Netflix's", async () => {
    dash = await TestDashboard.start();
    const one = ACTIVITY.split('\n')
      .filter((l) => !l.startsWith('Sam'))
      .join('\n');
    const zip = await zipOf('CONTENT_INTERACTION/ViewingActivity.csv', one);
    await uploadCsv(dash, zip, 'netflix-report.zip').expect(200);
    // one profile: imported without asking
    expect(await waitFor(fileExists(dash.path('data', 'media_items.json')))).toBe(true);
    expect((await items(dash)).length).toBe(2);

    const bad = await uploadCsv(dash, 'name,value\n1,2\n', 'other.csv').expect(400);
    expect(bad.body.error).toMatch(/Netflix/);
    const noCsv = await uploadCsv(dash, await zipOf('readme.txt', 'hi'), 'x.zip').expect(400);
    expect(noCsv.body.error).toMatch(/ViewingActivity/);
    await request(dash.server)
      .put('/upload?source=netflix&name=a.csv')
      .type('application/octet-stream')
      .send(Buffer.from(ACTIVITY))
      .expect(403);
  });

  describe('with TMDB', () => {
    let tmdb: Server;
    const calls: string[] = [];

    beforeAll(async () => {
      tmdb = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        calls.push(`${url.pathname}?${url.searchParams.get('query') ?? ''}`);
        const json = (body: unknown) =>
          res.setHeader('Content-Type', 'application/json').end(JSON.stringify(body));
        if (url.searchParams.get('api_key') !== 'k' && !url.pathname.startsWith('/img')) {
          res.writeHead(401).end();
        } else if (url.pathname === '/search/tv') {
          json({
            results:
              url.searchParams.get('query') === 'Copper Valley'
                ? [{ id: 7, name: 'Copper Valley' }]
                : [],
          });
        } else if (url.pathname === '/tv/7') {
          json({
            id: 7,
            name: 'Copper Valley',
            created_by: [{ name: 'A. Writer' }],
            genres: [{ name: 'Drama' }, { name: 'Mystery' }],
            first_air_date: '2024-09-01',
            poster_path: '/cv.jpg',
            seasons: [{ season_number: 1, episode_count: 6, poster_path: '/cv1.jpg' }],
          });
        } else if (url.pathname === '/tv/7/season/1') {
          json({
            episodes: [
              { episode_number: 1, name: 'Pilot', runtime: 52 },
              { episode_number: 2, name: 'The Mine', runtime: 50 },
            ],
          });
        } else if (url.pathname === '/search/movie') {
          json({
            results:
              url.searchParams.get('query') === 'Metropolis'
                ? [{ id: 19, title: 'Metropolis' }]
                : [],
          });
        } else if (url.pathname === '/movie/19') {
          json({
            id: 19,
            title: 'Metropolis',
            genres: [{ name: 'Science Fiction' }],
            runtime: 148,
            release_date: '1927-01-10',
            poster_path: '/m.jpg',
            credits: { crew: [{ job: 'Director', name: 'Fritz Lang' }] },
          });
        } else if (url.pathname.startsWith('/img/w342/')) {
          res.setHeader('Content-Type', 'image/jpeg').end(JPEG);
        } else {
          res.writeHead(404).end();
        }
      });
      tmdb.listen(0, '127.0.0.1');
      await new Promise((r) => tmdb.once('listening', r));
    });

    afterAll(() => new Promise((r) => tmdb.close(r)));

    it('adds genres, episode counts and posters', async () => {
      const url = `http://127.0.0.1:${(tmdb.address() as AddressInfo).port}`;
      dash = await TestDashboard.start({
        tmdbApiKey: 'k',
        tmdbUrl: url,
        tmdbImageUrl: `${url}/img`,
        coverPauseMs: 0,
      });
      await uploadCsv(
        dash,
        ACTIVITY.split('\n')
          .filter((l) => !l.startsWith('Sam'))
          .join('\n'),
      ).expect(200);
      expect(await waitFor(fileExists(dash.path('data', 'media_items.json')))).toBe(true);
      const rows = await items(dash);
      expect(rows.map((r) => [r.id, r.genre, r.units_total, r.status])).toEqual([
        ['tv-copper-valley-s1', 'Drama', 6, 'in_progress'],
        ['film-metropolis-1927', 'Science Fiction', null, 'finished'],
      ]);
      expect(await waitFor(fileExists(dash.path('covers', 'film-metropolis-1927.jpg')))).toBe(true);
      expect(await waitFor(fileExists(dash.path('covers', 'tv-copper-valley-s1.jpg')))).toBe(true);
      const covers = await request(dash.server).get('/api/covers').expect(200);
      expect(Object.keys(covers.body).sort()).toEqual([
        'film-metropolis-1927',
        'tv-copper-valley-s1',
      ]);

      // cached: a rebuild asks TMDB nothing new
      const before = calls.length;
      await request(dash.server)
        .post('/api/admin/media/rebuild')
        .set('X-Upload-Token', TOKEN)
        .expect(200);
      await waitFor(
        async () =>
          (await request(dash!.server).get('/api/admin/media').set('X-Upload-Token', TOKEN)).body
            .building === false,
      );
      expect(calls.slice(before).filter((c) => !c.startsWith('/img'))).toEqual([]);
    });

    it('carries on without metadata when TMDB is down', async () => {
      dash = await TestDashboard.start({
        tmdbApiKey: 'k',
        tmdbUrl: 'http://127.0.0.1:9',
        coverPauseMs: 0,
      });
      await uploadCsv(
        dash,
        ACTIVITY.split('\n')
          .filter((l) => !l.startsWith('Sam'))
          .join('\n'),
      ).expect(200);
      expect(await waitFor(fileExists(dash.path('data', 'media_items.json')))).toBe(true);
      expect((await items(dash)).map((r) => r.genre)).toEqual([null, null]);
    });
  });
});
