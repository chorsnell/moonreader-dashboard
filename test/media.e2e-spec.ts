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

describe('Plex through Tautulli', () => {
  let tautulli: Server;
  const calls: URLSearchParams[] = [];
  /** 520 plays of one show (more than a page), then one film for user 2. */
  const history = [
    ...Array.from({ length: 520 }, (_, i) => ({
      row_id: i + 1,
      started: Date.parse('2025-01-01T12:00:00Z') / 1000 + i * 86_400,
      play_duration: 2600,
      percent_complete: 97,
      watched_status: 1,
      media_type: 'episode',
      title: `Episode ${(i % 10) + 1}`,
      grandparent_title: 'Night Ferry',
      parent_media_index: Math.floor(i / 10) + 1,
      media_index: (i % 10) + 1,
      rating_key: 1000 + i,
      parent_rating_key: 500 + Math.floor(i / 10),
      grandparent_rating_key: 10,
      user_id: 1,
      player: 'Living Room',
    })),
    {
      row_id: 600,
      started: Date.parse('2026-01-01T20:00:00Z') / 1000,
      play_duration: 5000,
      percent_complete: 96,
      watched_status: 1,
      media_type: 'movie',
      title: 'Metropolis',
      year: 1927,
      rating_key: 77,
      user_id: 2,
    },
  ];

  beforeAll(async () => {
    tautulli = createServer((req, res) => {
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      calls.push(q);
      const send = (response: unknown) =>
        res.setHeader('Content-Type', 'application/json').end(JSON.stringify({ response }));
      const ok = (data: unknown) => send({ result: 'success', message: null, data });
      if (q.get('apikey') !== 'secret') return send({ result: 'error', message: 'Invalid apikey' });
      switch (q.get('cmd')) {
        case 'get_users':
          return ok([
            { user_id: 0, friendly_name: 'Local' },
            { user_id: 1, friendly_name: 'Chris' },
            { user_id: 2, friendly_name: 'Sam' },
          ]);
        case 'get_history': {
          const user = q.get('user_id');
          const rows = history.filter((r) => !user || String(r.user_id) === user);
          const start = Number(q.get('start'));
          const length = Number(q.get('length'));
          return ok({ recordsFiltered: rows.length, data: rows.slice(start, start + length) });
        }
        case 'get_metadata':
          return ok(
            q.get('rating_key') === '10'
              ? { title: 'Night Ferry', genres: ['Crime'], thumb: '/library/metadata/10/thumb' }
              : { title: 'Metropolis', genres: ['Science Fiction'], duration: 8880000 },
          );
        case 'get_children_metadata':
          return ok({ children_count: 10, children_list: [] });
        case 'pms_image_proxy':
          res.setHeader('Content-Type', 'image/jpeg').end(JPEG);
          return;
        default:
          res.writeHead(404).end();
      }
    });
    tautulli.listen(0, '127.0.0.1');
    await new Promise((r) => tautulli.once('listening', r));
  });

  afterAll(() => new Promise((r) => tautulli.close(r)));

  it('tests the connection, pulls every page for the chosen user, and builds', async () => {
    const url = `http://127.0.0.1:${(tautulli.address() as AddressInfo).port}`;
    const d = (dash = await TestDashboard.start({ coverPauseMs: 0 }));
    const admin = (path: string, body: object) =>
      request(d.server).post(`/api/admin/media/${path}`).set('X-Upload-Token', TOKEN).send(body);

    const bad = await admin('tautulli/test', { url, api_key: 'wrong' }).expect(400);
    expect(bad.body.error).toMatch(/Invalid apikey/);
    const test = await admin('tautulli/test', { url, api_key: 'secret' }).expect(200);
    expect(test.body.users).toEqual([
      { user_id: '1', name: 'Chris' },
      { user_id: '2', name: 'Sam' },
    ]);
    await admin('tautulli', { url: 'not a url', api_key: 'secret' }).expect(400);

    await admin('tautulli', { url, api_key: 'secret', user_id: '1' }).expect(200);
    expect(await waitFor(async () => (await items(d)).length === 52)).toBe(true);
    const rows = await items(d);
    expect(rows[0]).toMatchObject({
      id: 'tv-night-ferry-s1',
      genre: 'Crime',
      units: 10,
      units_total: 10,
      status: 'finished',
    });
    expect(rows.some((r) => r.media === 'film')).toBe(false); // Sam's film stays out
    const pages = calls.filter((c) => c.get('cmd') === 'get_history').map((c) => c.get('start'));
    expect(pages).toEqual(['0', '500']);
    expect(await waitFor(fileExists(d.path('covers', 'tv-night-ferry-s1.jpg')))).toBe(true);

    // the key is never shown back
    const status = await request(d.server).get('/api/admin/media').set('X-Upload-Token', TOKEN);
    expect(status.body.tautulli).toMatchObject({ url, user_id: '1', has_key: true });
    expect(JSON.stringify(status.body)).not.toContain('secret');

    // a sync only asks for plays since the day before the newest one
    calls.length = 0;
    const sync = await admin('tautulli/sync', {}).expect(200);
    expect(sync.body).toMatchObject({ new_rows: 0, total: 520 });
    expect(calls.find((c) => c.get('cmd') === 'get_history')?.get('after')).toBe('2026-06-03');
  });
});

describe('audiobooks from Audiobookshelf', () => {
  let abs: Server;
  const pages: string[] = [];
  const sessions = Array.from({ length: 150 }, (_, i) => ({
    id: `ls_${i}`,
    libraryItemId: i < 149 ? 'li_time' : 'li_mars',
    mediaType: 'book',
    displayTitle: i < 149 ? 'The Time Machine' : 'A Princess of Mars',
    displayAuthor: i < 149 ? 'H. G. Wells' : 'Edgar Rice Burroughs',
    mediaMetadata: {
      title: i < 149 ? 'The Time Machine' : 'A Princess of Mars',
      genres: ['Science Fiction'],
      series: i < 149 ? [] : [{ name: 'Barsoom', sequence: '1' }],
    },
    duration: 149 * 60,
    timeListening: i < 149 ? 60 : 600,
    currentTime: i < 149 ? (i + 1) * 60 : 600,
    startedAt: Date.parse('2025-01-01T12:00:00Z') + i * 3_600_000,
  }));

  beforeAll(async () => {
    abs = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.headers.authorization !== 'Bearer tok') return void res.writeHead(401).end();
      const json = (body: unknown) =>
        res.setHeader('Content-Type', 'application/json').end(JSON.stringify(body));
      if (url.pathname === '/api/me') return json({ username: 'chris' });
      if (url.pathname === '/api/me/listening-sessions') {
        const page = Number(url.searchParams.get('page'));
        const per = Number(url.searchParams.get('itemsPerPage'));
        pages.push(String(page));
        const newestFirst = [...sessions].reverse();
        return json({
          total: sessions.length,
          numPages: Math.ceil(sessions.length / per),
          page,
          itemsPerPage: per,
          sessions: newestFirst.slice(page * per, (page + 1) * per),
        });
      }
      if (url.pathname.startsWith('/api/items/') && url.pathname.endsWith('/cover')) {
        return void res.setHeader('Content-Type', 'image/jpeg').end(JPEG);
      }
      res.writeHead(404).end();
    });
    abs.listen(0, '127.0.0.1');
    await new Promise((r) => abs.once('listening', r));
  });

  afterAll(() => new Promise((r) => abs.close(r)));

  it('tests the token, pulls every page and builds audiobook items with covers', async () => {
    const url = `http://127.0.0.1:${(abs.address() as AddressInfo).port}`;
    const d = (dash = await TestDashboard.start({ coverPauseMs: 0 }));
    const admin = (path: string, body: object) =>
      request(d.server).post(`/api/admin/media/${path}`).set('X-Upload-Token', TOKEN).send(body);

    const bad = await admin('audiobookshelf/test', { url, token: 'nope' }).expect(400);
    expect(bad.body.error).toMatch(/refused/);
    const ok = await admin('audiobookshelf/test', { url, token: 'tok' }).expect(200);
    expect(ok.body.user).toBe('chris');

    await admin('audiobookshelf', { url, token: 'tok' }).expect(200);
    expect(await waitFor(async () => (await items(d)).length === 2)).toBe(true);
    const rows = await items(d);
    expect(rows.map((r) => [r.id, r.media, r.status])).toEqual([
      ['audiobook-the-time-machine', 'audiobook', 'finished'],
      ['audiobook-a-princess-of-mars', 'audiobook', 'in_progress'],
    ]);
    expect(pages).toEqual(['0', '1']);
    expect(await waitFor(fileExists(d.path('covers', 'audiobook-the-time-machine.jpg')))).toBe(
      true,
    );
    const status = await request(d.server).get('/api/admin/media').set('X-Upload-Token', TOKEN);
    expect(status.body.audiobookshelf).toMatchObject({ url, has_token: true });
    expect(JSON.stringify(status.body)).not.toContain('tok"');
  });
});
