/**
 * The admin page's endpoints: the data and kept backups, rebuilding on demand, editing the
 * catalogue, and covers. Only the admin may use any of them.
 */
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { JPEG, makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

interface BookRow {
  id: string;
  title: string;
  author: string;
  series: string | null;
  series_no: number | null;
  genre: string;
  subgenre: string;
}

interface CatalogueBook extends BookRow {
  files: string[];
  untagged: boolean;
  has_cover: boolean;
}

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-admin-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

const admin = (d: TestDashboard) => ({
  get: (path: string) => request(d.server).get(path).set('X-Upload-Token', TOKEN),
  post: (path: string, body: object = {}) =>
    request(d.server).post(path).set('X-Upload-Token', TOKEN).send(body),
  put: (path: string, body: object) =>
    request(d.server).put(path).set('X-Upload-Token', TOKEN).send(body),
});

/** Uploads the fake backup and waits for its build. */
async function withData(overrides = {}): Promise<TestDashboard> {
  const d = await TestDashboard.start(overrides);
  await request(d.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup)
    .expect(200);
  expect(await waitFor(fileExists(d.path('data', 'meta.json')))).toBe(true);
  return d;
}

const metaTime = async (d: TestDashboard) => (await stat(d.path('data', 'meta.json'))).mtimeMs;
const books = (d: TestDashboard) => d.json<BookRow[]>('data', 'books.json');

describe('admin endpoints', () => {
  it('are only for the admin', async () => {
    dash = await TestDashboard.start();
    await request(dash.server).post('/api/access').set('X-Upload-Token', TOKEN).send({
      access: 'password',
      password: 'friends',
    });
    const login = await request(dash.server).post('/api/login').send({ password: 'friends' });
    const reader = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0];
    const calls: [string, string][] = [
      ['GET', '/api/admin/status'],
      ['POST', '/api/admin/rebuild'],
      ['GET', '/api/admin/catalogue'],
      ['PUT', '/api/admin/catalogue'],
      ['GET', '/api/admin/covers'],
      ['POST', '/api/admin/covers/lookup'],
      ['PUT', '/api/admin/covers/alpha'],
    ];
    for (const [method, path] of calls) {
      for (const cookie of ['', reader, 'mrd_session=admin.9999999999.forged']) {
        const req = request(dash.server)[method.toLowerCase() as 'get'](path);
        if (cookie) req.set('Cookie', cookie);
        const res = await req.send({});
        expect([method, path, res.status]).toEqual([method, path, 403]);
      }
    }
  });
});

describe('the Data section', () => {
  it('shows the current data and the kept backups', async () => {
    dash = await withData();
    const res = await admin(dash).get('/api/admin/status').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.meta.backup_file).toBe('test.mrpro');
    expect(res.body.keep_backups).toBe(5);
    expect(res.body.backups).toEqual([
      expect.objectContaining({ name: 'inbox/test.mrpro', folder: 'inbox', failed: false }),
    ]);
    expect(res.body.backups[0].size).toBe(backup.length);
  });

  it('rebuilds on demand, even when nothing changed', async () => {
    dash = await TestDashboard.start();
    await admin(dash).post('/api/admin/rebuild').expect(409); // no backup yet
    await rm(dash.path('data', 'meta.json'), { force: true });
    await request(dash.server)
      .put('/upload?name=test.mrpro')
      .set('X-Upload-Token', TOKEN)
      .type('application/octet-stream')
      .send(backup);
    expect(await waitFor(fileExists(dash.path('data', 'meta.json')))).toBe(true);
    const before = await metaTime(dash);
    await new Promise((r) => setTimeout(r, 1100));
    await admin(dash).post('/api/admin/rebuild').expect(202, { ok: true });
    const d = dash;
    expect(await waitFor(async () => (await metaTime(d)) !== before)).toBe(true);
    expect(await readFile(dash.path('update.log'), 'utf8')).toContain('Rebuild asked for');
  });
});

describe('the Catalogue section', () => {
  it('lists untagged books and saves edits to catalogue.json, then rebuilds', async () => {
    dash = await withData();
    const list = (await admin(dash).get('/api/admin/catalogue').expect(200)).body as {
      books: CatalogueBook[];
    };
    expect(list.books.map((b) => [b.id, b.untagged])).toEqual([
      ['alpha', true],
      ['beta', true],
    ]);
    const beta = list.books.find((b) => b.id === 'beta')!;
    expect(beta.files).toEqual(['Beta - Bob Writer.epub']);
    expect(list.books.find((b) => b.id === 'alpha')!.has_cover).toBe(true);

    // a title is required, and the series number must be a number
    await admin(dash).put('/api/admin/catalogue', { files: beta.files, title: '' }).expect(400);
    await admin(dash).put('/api/admin/catalogue', { title: 'X' }).expect(400);
    await admin(dash)
      .put('/api/admin/catalogue', { files: beta.files, title: 'B', series: 'S', series_no: 'x' })
      .expect(400);

    await admin(dash)
      .put('/api/admin/catalogue', {
        files: beta.files,
        title: 'Beta Reborn',
        author: 'Bob Writer',
        series: 'The Greek Letters',
        series_no: 2,
        genre: 'Fantasy',
        subgenre: 'Epic',
      })
      .expect(200, { ok: true });
    const catalogue = await dash.json<{ books: Record<string, BookRow> }>('catalogue.json');
    expect(catalogue.books['beta - bob writer.epub']).toEqual({
      title: 'Beta Reborn',
      author: 'Bob Writer',
      series: 'The Greek Letters',
      series_no: 2,
      genre: 'Fantasy',
      subgenre: 'Epic',
    });
    expect(Object.keys(catalogue.books).length).toBeGreaterThan(10); // the rest is kept
    expect((await readdir(dash.lib)).filter((f) => f.endsWith('.part'))).toEqual([]);

    const d = dash;
    const rebuilt = async () => (await books(d)).some((b) => b.title === 'Beta Reborn');
    expect(await waitFor(rebuilt)).toBe(true);
    const row = (await books(dash)).find((b) => b.title === 'Beta Reborn')!;
    expect([row.genre, row.subgenre, row.series, row.series_no]).toEqual([
      'Fantasy',
      'Epic',
      'The Greek Letters',
      2,
    ]);
    // reading_history.json, which the list reads, is written just after books.json
    const reborn = async () =>
      ((await admin(d).get('/api/admin/catalogue')).body as { books: CatalogueBook[] }).books.find(
        (b) => b.title === 'Beta Reborn',
      );
    expect(await waitFor(async () => (await reborn()) !== undefined)).toBe(true);
    expect((await reborn())!.untagged).toBe(false);
  });

  it('hides a file that is not a book', async () => {
    dash = await withData();
    await admin(dash)
      .put('/api/admin/catalogue', { files: ['Beta - Bob Writer.epub'], exclude: true })
      .expect(200);
    const catalogue = await dash.json<{ exclude: string[] }>('catalogue.json');
    expect(catalogue.exclude).toContain('beta - bob writer.epub');
    const d = dash;
    expect(await waitFor(async () => (await books(d)).length === 1)).toBe(true);
  });
});

describe('the Covers section', () => {
  it('lists the missing covers and takes one the admin chooses', async () => {
    dash = await withData();
    const res = await admin(dash).get('/api/admin/covers').expect(200);
    expect(res.body).toMatchObject({ lookup: false, total: 2, with_cover: 1 });
    expect(res.body.missing).toEqual([
      { id: 'beta', title: 'Beta', author: 'Bob Writer', missed: null },
    ]);
    // lookups are off on this server
    await admin(dash).post('/api/admin/covers/lookup').expect(409);

    const put = (id: string, body: Buffer) =>
      request(dash!.server)
        .put(`/api/admin/covers/${id}`)
        .set('X-Upload-Token', TOKEN)
        .type('image/jpeg')
        .send(body);
    await put('beta', Buffer.from('not an image')).expect(400);
    await put('../x', JPEG).expect(404);
    await put('beta', JPEG).expect(200);
    expect(await readFile(dash.path('covers', 'beta.jpg'))).toEqual(JPEG);
    // replacing one the backup had
    await put('alpha', JPEG).expect(200);
    expect(await fileExists(dash.path('covers', 'alpha.png'))()).toBe(false);
    expect((await admin(dash).get('/api/admin/covers')).body.missing).toEqual([]);
  });

  describe('looking up again', () => {
    let openLibrary: Server;
    beforeAll(async () => {
      openLibrary = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/search.json') {
          const docs = url.searchParams.get('title') === 'Beta' ? [{ cover_i: 7 }] : [];
          res.setHeader('Content-Type', 'application/json').end(JSON.stringify({ docs }));
        } else if (url.pathname === '/b/id/7-M.jpg') {
          res.setHeader('Content-Type', 'image/jpeg').end(JPEG);
        } else res.writeHead(404).end();
      });
      openLibrary.listen(0, '127.0.0.1');
      await new Promise((r) => openLibrary.once('listening', r));
    });
    afterAll(() => new Promise((r) => openLibrary.close(r)));

    it('forgets that a book was not found and tries it again', async () => {
      const url = `http://127.0.0.1:${(openLibrary.address() as AddressInfo).port}`;
      // the first lookup is pointed at nothing, so beta is recorded as not found
      const today = new Date().toISOString().slice(0, 10);
      dash = await TestDashboard.start({
        coverLookup: true,
        openLibraryUrl: url,
        openLibraryCoversUrl: url,
        coverPauseMs: 0,
      });
      await writeFile(dash.path('covers', '.misses.json'), JSON.stringify({ beta: today }));
      await request(dash.server)
        .put('/upload?name=test.mrpro')
        .set('X-Upload-Token', TOKEN)
        .type('application/octet-stream')
        .send(backup);
      expect(await waitFor(fileExists(dash.path('data', 'meta.json')))).toBe(true);
      const listed = (await admin(dash).get('/api/admin/covers')).body;
      expect(listed.missing).toEqual([expect.objectContaining({ id: 'beta', missed: today })]);
      expect(await fileExists(dash.path('covers', 'beta.jpg'))()).toBe(false);

      await admin(dash)
        .post('/api/admin/covers/lookup', { ids: ['beta'] })
        .expect(202);
      expect(await waitFor(fileExists(dash.path('covers', 'beta.jpg')))).toBe(true);
    });
  });
});
