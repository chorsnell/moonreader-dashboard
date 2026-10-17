/**
 * End-to-end tests: build a tiny fake Moon+ backup, run the real app against a temporary
 * library, and check rebuilding, uploads, covers, reverse-proxy prefixes and WebDAV.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { JPEG, PNG, makeBackup } from './support/fake-backup';
import { DAV_AUTH, TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

interface BookRow {
  title: string;
  status: string;
  progress: number | null;
  last_read: string | null;
}

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

const upload = (d: TestDashboard, prefix = '') =>
  request(d.server)
    .put(`${prefix}/upload?name=test.mrpro`)
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup);

/** A build has finished: meta.json is written after every other data file. */
const built = (d: TestDashboard) => fileExists(d.path('data', 'meta.json'));

const booksByTitle = async (d: TestDashboard) =>
  Object.fromEntries(
    (await d.json<BookRow[]>('data', 'books.json')).map((b) => [b.title, b]),
  ) as Record<string, BookRow>;

describe('rebuilding', () => {
  it('has no data on the first run', async () => {
    dash = await TestDashboard.start();
    const res = await request(dash.server).get('/api/config').expect(200);
    expect(res.body.has_data).toBe(false);
    expect(res.body.uploads).toBe(false); // only the admin sees the upload button
    expect(res.body).toMatchObject({ access: 'public', role: null, can_read: true, admin: true });
    const admin = await request(dash.server).get('/api/config').set('X-Upload-Token', TOKEN);
    expect(admin.body.uploads).toBe(true);
  });

  it('builds the data from an upload', async () => {
    dash = await TestDashboard.start();
    await upload(dash).expect(200, { ok: true });
    expect(await waitFor(built(dash))).toBe(true);
    const books = await booksByTitle(dash);
    expect(books.Alpha.status).toBe('finished');
    expect(books.Beta.progress).toBe(50);
    expect(books.Alpha).toMatchObject({ isbn13: null, isbn10: null, work_id: null });
    const daily = await dash.json<{ minutes: number; progress: number }[]>('data', 'daily.json');
    expect(daily).toHaveLength(5);
    expect(daily[0].minutes).toBe(30);
    expect(daily[0].progress).toBe(40);
    const highlights = await dash.json<{ book_id: string; kind: string; text: string }[]>(
      'data',
      'highlights.json',
    );
    expect(highlights.map((h) => [h.book_id, h.kind, h.text])).toEqual([
      ['alpha', 'highlight', 'It was a dark\nand stormy night.'],
      ['alpha', 'note', 'The end.'],
      ['beta', 'bookmark', 'Chapter 3'],
    ]);
    await request(dash.server).get('/data/highlights.json').expect(200);
  });
});

describe('covers', () => {
  it('saves the covers in the backup and serves only those', async () => {
    dash = await TestDashboard.start();
    await upload(dash);
    expect(await waitFor(built(dash))).toBe(true);
    expect(await readFile(dash.path('covers', 'alpha.png'))).toEqual(PNG); // the larger image
    const covers = (await request(dash.server).get('/api/covers').expect(200)).body as Record<
      string,
      string
    >;
    expect(Object.keys(covers)).toEqual(['alpha']);
    expect(covers.alpha).toMatch(/^covers\/alpha\.png\?v=/);
    const res = await request(dash.server).get(`/${covers.alpha}`).buffer(true).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body).toEqual(PNG);
    for (const path of ['/covers/beta.png', '/covers/.misses.json', '/covers/alpha.gif']) {
      expect((await dash.raw('GET', path)).status).toBe(404);
    }
    expect((await dash.raw('GET', '/covers/../catalogue.json')).status).toBe(404);
  });

  describe('missing ones', () => {
    let openLibrary: Server;
    const searches: string[] = [];

    // knows one book, Beta, whose cover is id 42
    beforeAll(async () => {
      openLibrary = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/search.json') {
          const title = url.searchParams.get('title') ?? '';
          searches.push(title);
          const docs = title === 'Beta' ? [{ title: 'Beta', cover_i: 42 }] : [];
          res.setHeader('Content-Type', 'application/json').end(JSON.stringify({ docs }));
        } else if (url.pathname === '/b/id/42-M.jpg') {
          res.setHeader('Content-Type', 'image/jpeg').end(JPEG);
        } else {
          res.writeHead(404).end();
        }
      });
      openLibrary.listen(0, '127.0.0.1');
      await new Promise((r) => openLibrary.once('listening', r));
    });

    afterAll(() => new Promise((r) => openLibrary.close(r)));

    it('looks them up on Open Library', async () => {
      const url = `http://127.0.0.1:${(openLibrary.address() as AddressInfo).port}`;
      dash = await TestDashboard.start({
        coverLookup: true,
        openLibraryUrl: url,
        openLibraryCoversUrl: url,
        coverPauseMs: 0,
      });
      await upload(dash);
      expect(await waitFor(fileExists(dash.path('covers', 'beta.jpg')))).toBe(true);
      expect(await readFile(dash.path('covers', 'beta.jpg'))).toEqual(JPEG);
      expect(searches).not.toContain('Alpha'); // the backup already had it
      const covers = (await request(dash.server).get('/api/covers')).body as object;
      expect(Object.keys(covers).sort()).toEqual(['alpha', 'beta']);
    });
  });
});

describe('metadata lookup', () => {
  let server: Server;
  const asked: string[] = [];

  // Open Library knows Beta (by Bob Writer, OL7A); Wikidata knows Bob as Q7, a French man
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      asked.push(url.pathname);
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/search.json') {
        const beta = url.searchParams.get('title') === 'Beta';
        const docs = beta
          ? [
              {
                key: '/works/OL9W',
                title: 'Beta',
                author_key: ['OL7A'],
                first_publish_year: 1899,
                number_of_pages_median: 321,
                isbn: ['0141439513'],
              },
            ]
          : [];
        res.end(JSON.stringify({ docs }));
      } else if (url.pathname === '/authors/OL7A.json') {
        res.end(JSON.stringify({ remote_ids: { wikidata: 'Q7' } }));
      } else if (url.pathname === '/w/api.php') {
        const v = (id: string) => ({
          mainsnak: { snaktype: 'value', datavalue: { value: { id } } },
          rank: 'normal',
        });
        const entities: Record<string, object> = {
          Q7: { id: 'Q7', claims: { P21: [v('Q6581097')], P27: [v('Q142')] } },
          Q142: {
            id: 'Q142',
            claims: { P297: [{ mainsnak: { snaktype: 'value', datavalue: { value: 'FR' } } }] },
          },
        };
        const ids = (url.searchParams.get('ids') ?? '').split('|');
        res.end(JSON.stringify({ entities: Object.fromEntries(ids.map((i) => [i, entities[i]])) }));
      } else {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
  });

  afterAll(() => new Promise((r) => server.close(r)));

  it('looks up books and authors, then rebuilds with what it found', async () => {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    dash = await TestDashboard.start({
      metadataLookup: true,
      openLibraryUrl: url,
      wikidataUrl: url,
      coverPauseMs: 0,
    });
    await upload(dash);
    const beta = async () => (await booksByTitle(dash!)).Beta as unknown as Record<string, unknown>;
    expect(await waitFor(async () => (await beta()).published_year === 1899)).toBe(true);
    expect(await beta()).toMatchObject({
      pages: 321,
      isbn13: '9780141439518',
      isbn10: '0141439513',
      work_id: 'OL9W',
      author_country: 'FR',
      author_country_name: 'France',
      author_gender: 'male',
    });
    expect((await booksByTitle(dash)).Alpha).toMatchObject({ published_year: null });
    const misses = await dash.json<{ books: Record<string, string> }>('.metadata-misses.json');
    expect(Object.keys(misses.books)).toEqual(['alpha']);
    expect(asked).toContain('/authors/OL7A.json');
    // metadata.json isn't served
    expect((await dash.raw('GET', '/metadata.json')).status).toBe(404);
  });
});

describe('uploads', () => {
  it('refuses a wrong token and files that are not backups', async () => {
    dash = await TestDashboard.start();
    const put = (name: string, body: string, token: string) =>
      request(dash!.server)
        .put(`/upload?name=${name}`)
        .set('X-Upload-Token', token)
        .type('application/octet-stream')
        .send(Buffer.from(body));
    const wrong = await put('a.mrpro', 'PK..', 'nope').expect(403);
    expect(wrong.body).toEqual({ error: 'Sign in as the admin to upload.' });
    await put('a.mrpro', 'hello', TOKEN).expect(400);
    await put('a.zip', 'PK..', TOKEN).expect(400);
  });

  it('is turned off without a token', async () => {
    dash = await TestDashboard.start({ uploadToken: '' });
    await request(dash.server).put('/upload?name=a.mrpro').send(Buffer.from('PK')).expect(404);
    await request(dash.server).propfind('/dav/').expect(404);
  });
});

describe('serving', () => {
  it('does not serve private files', async () => {
    dash = await TestDashboard.start();
    for (const path of [
      '/server.py',
      '/main.js',
      '/catalogue.json',
      '/update.log',
      '/data/../catalogue.json',
      '/../src/main.ts',
      '/../package.json',
    ]) {
      expect([path, (await dash.raw('GET', path)).status]).toEqual([path, 404]);
    }
  });

  it('serves the page and its scripts', async () => {
    dash = await TestDashboard.start();
    const page = await request(dash.server).get('/').expect(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    await request(dash.server).get('/runtime.js').expect(200);
    await request(dash.server).get('/vendor/d3.min.js').expect(200);
    await request(dash.server).get('/upload').expect(302).expect('Location', '/#admin');
  });

  it('follows the proxy prefix in the <base> tag', async () => {
    dash = await TestDashboard.start();
    const ok = await request(dash.server).get('/').set('X-Forwarded-Prefix', '/reading');
    expect(ok.text).toContain('<base href="/reading/">');
    const bad = await request(dash.server).get('/').set('X-Forwarded-Prefix', '/bad"><script>');
    expect(bad.text).toContain('<base href="/">');
  });

  it('works under BASE_PATH without stripping', async () => {
    dash = await TestDashboard.start({ basePath: '/books' });
    await request(dash.server).get('/books').expect(301).expect('Location', '/books/');
    const page = await request(dash.server).get('/books/').expect(200);
    expect(page.text).toContain('<base href="/books/">');
    await request(dash.server).get('/books/runtime.js').expect(200);
    await request(dash.server).get('/books/api/config').expect(200);
  });
});

describe('signing in', () => {
  const signIn = async (d: TestDashboard, password: string) => {
    const res = await request(d.server).post('/api/login').send({ password });
    const cookie = String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
    return { status: res.status, body: res.body as { role?: string }, cookie };
  };
  const setAccess = (d: TestDashboard, cookie: string, access: string, password = '') => {
    const req = request(d.server).post('/api/access');
    if (cookie) req.set('Cookie', cookie);
    return req.send({ access, password });
  };
  const get = (d: TestDashboard, path: string, cookie = '') => {
    const req = request(d.server).get(path);
    return cookie ? req.set('Cookie', cookie) : req;
  };

  it('lets the admin sign in to upload', async () => {
    dash = await TestDashboard.start();
    expect((await signIn(dash, 'wrong')).status).toBe(403);
    const admin = await signIn(dash, TOKEN);
    expect([admin.status, admin.body.role]).toEqual([200, 'admin']);
    const cfg = (await get(dash, '/api/config', admin.cookie)).body;
    expect([cfg.role, cfg.uploads]).toEqual(['admin', true]);
    await request(dash.server)
      .put('/upload?name=test.mrpro')
      .set('Cookie', admin.cookie)
      .type('application/octet-stream')
      .send(backup)
      .expect(200);
    await request(dash.server)
      .put('/upload?name=test.mrpro')
      .set('Cookie', 'mrd_session=admin.9999999999.forged')
      .type('application/octet-stream')
      .send(Buffer.from('PK..'))
      .expect(403);
    const out = await request(dash.server).post('/api/logout').set('Cookie', admin.cookie);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('keeps a private dashboard behind the read password', async () => {
    dash = await TestDashboard.start();
    await upload(dash);
    expect(await waitFor(built(dash))).toBe(true);
    const { cookie: admin } = await signIn(dash, TOKEN);

    // only the admin can change it, and only with a JSON body (so other sites can't)
    expect((await setAccess(dash, '', 'password', 'friends')).status).toBe(403);
    await request(dash.server)
      .post('/api/access')
      .set('Cookie', admin)
      .type('form')
      .send('access=public')
      .expect(400);
    expect((await setAccess(dash, admin, 'password')).status).toBe(400); // no read password yet
    expect((await setAccess(dash, admin, 'password', TOKEN)).status).toBe(400); // must differ
    expect((await setAccess(dash, admin, 'password', 'friends')).status).toBe(200);
    expect(await readFile(dash.path('settings.json'), 'utf8')).not.toContain('friends');

    expect((await get(dash, '/api/config')).body).toEqual({
      access: 'password',
      role: null,
      admin: true,
      can_read: false,
    });
    for (const path of [
      '/data/books.json',
      '/data/meta.json',
      '/api/covers',
      '/covers/alpha.png',
    ]) {
      expect([path, (await get(dash, path)).status]).toEqual([path, 401]);
    }
    await get(dash, '/').expect(200); // the page itself shows the password box
    await get(dash, '/data/books.json', admin).expect(200);

    expect((await signIn(dash, 'wrong')).status).toBe(403);
    const reader = await signIn(dash, 'friends');
    expect([reader.status, reader.body.role]).toEqual([200, 'reader']);
    await get(dash, '/data/books.json', reader.cookie).expect(200);
    const cover = await get(dash, '/covers/alpha.png', reader.cookie).expect(200);
    expect(cover.headers['cache-control']).toMatch(/^private/);
    const cfg = (await get(dash, '/api/config', reader.cookie)).body;
    expect([cfg.role, cfg.can_read, cfg.uploads]).toEqual(['reader', true, false]);
    // readers can't upload or change the setting
    await request(dash.server)
      .put('/upload?name=test.mrpro')
      .set('Cookie', reader.cookie)
      .type('application/octet-stream')
      .send(Buffer.from('PK..'))
      .expect(403);
    expect((await setAccess(dash, reader.cookie, 'public')).status).toBe(403);

    // a new read password signs out everyone using the old one; keeping it doesn't
    expect((await setAccess(dash, admin, 'password')).status).toBe(200);
    await get(dash, '/data/books.json', reader.cookie).expect(200);
    expect((await setAccess(dash, admin, 'password', 'new friends')).status).toBe(200);
    await get(dash, '/data/books.json', reader.cookie).expect(401);

    expect((await setAccess(dash, admin, 'public')).status).toBe(200);
    await get(dash, '/data/books.json').expect(200);
  });
});

describe('WebDAV', () => {
  it('requires the password', async () => {
    dash = await TestDashboard.start();
    const anon = await request(dash.server).propfind('/dav/').expect(401);
    expect(anon.headers['www-authenticate']).toMatch(/^Basic /);
    const bad = `Basic ${Buffer.from('moon:wrong').toString('base64')}`;
    await request(dash.server).propfind('/dav/').set('Authorization', bad).expect(401);
    await request(dash.server)
      .propfind('/dav/')
      .set('Authorization', DAV_AUTH)
      .set('Depth', '0')
      .expect(207);
    await request(dash.server).options('/dav/').expect(200).expect('DAV', '1, 2');
  });

  it('handles folders, files and paths', async () => {
    dash = await TestDashboard.start();
    const dav = () => request(dash!.server);
    await dav().mkcol('/dav/Books/').set('Authorization', DAV_AUTH).expect(201);
    await dav()
      .put('/dav/Books/a.txt')
      .set('Authorization', DAV_AUTH)
      .type('text/plain')
      .send('hi')
      .expect(201);
    const got = await dav().get('/dav/Books/a.txt').set('Authorization', DAV_AUTH).expect(200);
    expect(got.text).toBe('hi');
    const listing = await dav()
      .propfind('/dav/Books/')
      .set('Authorization', DAV_AUTH)
      .set('Depth', '1')
      .buffer(true)
      .parse((res, done) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => done(null, text));
      })
      .expect(207);
    expect(listing.body).toContain('<D:href>/dav/Books/a.txt</D:href>');
    const { port } = dash.server.address() as AddressInfo;
    await dav()
      .move('/dav/Books/a.txt')
      .set('Authorization', DAV_AUTH)
      .set('Destination', `http://127.0.0.1:${port}/dav/Books/b.txt`)
      .expect(201);
    await dav().get('/dav/Books/b.txt').set('Authorization', DAV_AUTH).expect(200);
    await dav().delete('/dav/Books/b.txt').set('Authorization', DAV_AUTH).expect(204);
    const escape = await dash.raw('PUT', '/dav/../escape.txt', Buffer.from('x'), {
      Authorization: DAV_AUTH,
    });
    expect(escape.status).toBe(400);
    expect(fileExists(dash.path('escape.txt'))()).toBe(false);
  });

  it('picks up a backup and a synced reading position', async () => {
    dash = await TestDashboard.start();
    await request(dash.server)
      .put('/dav/Backup/test.mrpro')
      .set('Authorization', DAV_AUTH)
      .type('application/octet-stream')
      .send(backup)
      .expect(201);
    expect(await waitFor(built(dash))).toBe(true);

    // Moon+ syncs "<book file>.po" holding "<ms timestamp>*<chapter>@<split>#<pos>:<percent>%"
    const later = new Date(2026, 3, 2, 9, 30).getTime();
    await request(dash.server).mkcol('/dav/Books/').set('Authorization', DAV_AUTH);
    await request(dash.server)
      .put('/dav/Books/Beta%20-%20Bob%20Writer.epub.po')
      .set('Authorization', DAV_AUTH)
      .type('application/octet-stream')
      .send(Buffer.from(`${later}*7@0#100:83.5%`))
      .expect(201);
    expect(await waitFor(async () => (await booksByTitle(dash!)).Beta.progress === 83.5)).toBe(
      true,
    );
    expect((await booksByTitle(dash)).Beta.last_read).toBe('2026-04-02');
    // meta.json is written after books.json, so it can briefly still be the previous build's
    const synced = async () =>
      (await dash!.json<{ synced_positions: number }>('data', 'meta.json')).synced_positions;
    expect(await waitFor(async () => (await synced()) === 1)).toBe(true);
  });
});
