/**
 * End-to-end tests for the owner's want-to-read list (BOO-102): the admin endpoints, the
 * rebuild that puts the list on the pile (data/to_read.json), hiding pile rows, the Open
 * Library search (against a fake), and the note kept from visitors.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

interface PileRow {
  book_id: string;
  title: string;
  sources: string[];
  note?: string;
  want_id?: string;
  up_next?: number;
}

const GOODREADS = [
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies',
  '13,Wishlist,Wanda Wish,"Wish, Wanda",,"=""""","=""""",0,4.0,,,300,2019,2019,,2023/04/01,to-read,to-read (#1),to-read,,,,0,0',
  '14,Second Wish,Wanda Wish,"Wish, Wanda",,"=""""","=""""",0,4.0,,,200,2019,2019,,2023/05/01,to-read,to-read (#1),to-read,,,,0,0',
].join('\n');

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-want-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

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

const admin = (d: TestDashboard) => ({
  get: (url: string) => request(d.server).get(url).set('X-Upload-Token', TOKEN),
  put: (url: string, body: object) =>
    request(d.server).put(url).set('X-Upload-Token', TOKEN).send(body),
  post: (url: string, body: object) =>
    request(d.server).post(url).set('X-Upload-Token', TOKEN).send(body),
  del: (url: string) => request(d.server).delete(url).set('X-Upload-Token', TOKEN),
});

const metaTime = async (d: TestDashboard) => (await stat(d.path('data', 'meta.json'))).mtimeMs;
const pile = (d: TestDashboard) => d.json<PileRow[]>('data', 'to_read.json');
/** Waits until data/to_read.json says what `ok` wants. */
const pileWhen = (d: TestDashboard, ok: (rows: PileRow[]) => boolean) =>
  waitFor(async () => ok(await pile(d).catch(() => [])));

describe('the want-to-read list', () => {
  it('is only for the admin', async () => {
    dash = await TestDashboard.start();
    const s = dash.server;
    await request(s).get('/api/admin/want').expect(403);
    await request(s).post('/api/admin/want').send({ title: 'Kim' }).expect(403);
    await request(s).put('/api/admin/want/mine:kim').send({ note: 'x' }).expect(403);
    await request(s).delete('/api/admin/want/mine:kim').expect(403);
    await request(s).post('/api/admin/want/hide').send({ key: 'goodreads:1' }).expect(403);
    await request(s).delete('/api/admin/want/hide/goodreads:1').expect(403);
    await request(s).get('/api/admin/want/search?q=kim').expect(403);
    expect(await fileExists(dash.path('want_to_read.json'))()).toBe(false);
  });

  it('adds, edits and removes books, and the rebuild puts them on the pile', async () => {
    const d = (dash = await withData());
    const a = admin(d);
    expect((await a.get('/api/admin/want').expect(200)).body).toEqual({
      schema_version: 1,
      books: [],
      hidden: [],
      order: [],
    });

    await a.post('/api/admin/want', { title: '' }).expect(400);
    await a.post('/api/admin/want', { title: 'x'.repeat(400) }).expect(400);
    const before = await metaTime(d);
    const added = await a
      .post('/api/admin/want', {
        title: ' Lorna Doone ',
        author: 'R. D. Blackmore',
        isbn13: '9780140433524',
        note: 'the green Penguin',
        from: 'search',
      })
      .expect(200);
    expect(added.body.book).toMatchObject({
      id: 'mine:lorna-doone',
      title: 'Lorna Doone',
      genre: 'Untagged',
      from: 'search',
    });
    expect(added.body.book.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // the same book again: by title and author, or by ISBN
    await a.post('/api/admin/want', { title: 'Lorna Doone', author: 'Blackmore' }).expect(409);
    await a.post('/api/admin/want', { title: 'Other', isbn13: '978-0-14-043352-4' }).expect(409);
    // a different book with the same title gets its own id
    const other = await a
      .post('/api/admin/want', { title: 'Lorna Doone', author: 'Someone Else' })
      .expect(200);
    expect(other.body.book.id).toBe('mine:lorna-doone-2');

    expect(await waitFor(async () => (await metaTime(d)) !== before)).toBe(true);
    expect(
      await pileWhen(d, (rows) => rows.filter((r) => r.sources.includes('mine')).length === 2),
    ).toBe(true);
    expect((await pile(d)).find((r) => r.book_id === 'mine:lorna-doone')).toMatchObject({
      title: 'Lorna Doone',
      sources: ['mine'],
      note: 'the green Penguin',
      want_id: 'mine:lorna-doone',
    });

    // the note is the admin's: visitors get the book without it
    const visitor = (await request(d.server).get('/data/to_read.json').expect(200))
      .body as PileRow[];
    expect(visitor.find((r) => r.book_id === 'mine:lorna-doone')).toBeDefined();
    expect(JSON.stringify(visitor)).not.toContain('green Penguin');
    const own = (await a.get('/data/to_read.json').expect(200)).body as PileRow[];
    expect(JSON.stringify(own)).toContain('green Penguin');

    await a.put('/api/admin/want/mine:lorna-doone', { note: 'a library copy' }).expect(200);
    await a.put('/api/admin/want/mine:lorna-doone', { title: '' }).expect(400);
    await a.put('/api/admin/want/mine:nothing', { note: 'x' }).expect(404);
    // an edit that would make it a copy of another entry
    await a.put('/api/admin/want/mine:lorna-doone-2', { author: 'R. D. Blackmore' }).expect(409);
    expect(await pileWhen(d, (rows) => rows.some((r) => r.note === 'a library copy'))).toBe(true);

    await a.del('/api/admin/want/mine:lorna-doone-2').expect(200);
    await a.del('/api/admin/want/mine:lorna-doone-2').expect(404);
    expect(await pileWhen(d, (rows) => !rows.some((r) => r.book_id === 'mine:lorna-doone-2'))).toBe(
      true,
    );
    const file = await d.json<{ books: { id: string }[] }>('want_to_read.json');
    expect(file.books.map((b) => b.id)).toEqual(['mine:lorna-doone']);
    expect(await fileExists(d.path('want_to_read.json.part'))()).toBe(false);
  });

  it('keeps an Up next order of any pile books, which the rebuild marks', async () => {
    dash = await withData();
    const d = dash;
    const api = admin(d);
    await request(d.server).post('/api/admin/want/order').send({ key: 'x', to: 0 }).expect(403);
    await request(d.server)
      .put('/api/admin/imports?name=goodreads.csv')
      .set('X-Upload-Token', TOKEN)
      .type('application/octet-stream')
      .send(Buffer.from(GOODREADS))
      .expect(200);
    const kim = (
      await api.post('/api/admin/want', { title: 'Kim', author: 'Rudyard Kipling' }).expect(200)
    ).body.book;
    expect(
      await pileWhen(d, (rows) =>
        ['Kim', 'Wishlist', 'Second Wish'].every((t) => rows.some((x) => x.title === t)),
      ),
    ).toBe(true);

    let r = await api.post('/api/admin/want/order', { key: 'goodreads:14', to: 0 }).expect(200);
    r = await api.post('/api/admin/want/order', { key: kim.id, to: 0 }).expect(200);
    expect(r.body.order).toEqual([kim.id, 'goodreads:14']);
    // past the end goes last; a bad place or key is refused
    r = await api.post('/api/admin/want/order', { key: 'goodreads:13', to: 99 }).expect(200);
    expect(r.body.order).toEqual([kim.id, 'goodreads:14', 'goodreads:13']);
    await api.post('/api/admin/want/order', { key: 'goodreads:13', to: -1 }).expect(400);
    await api.post('/api/admin/want/order', { key: '', to: 0 }).expect(400);
    r = await api.post('/api/admin/want/order', { key: 'goodreads:13', to: null }).expect(200);
    expect(r.body.order).toEqual([kim.id, 'goodreads:14']);
    expect((await api.get('/api/admin/want').expect(200)).body.order).toEqual([
      kim.id,
      'goodreads:14',
    ]);

    const placed = (rows: PileRow[]) =>
      Object.fromEntries(rows.filter((x) => x.up_next).map((x) => [x.title, x.up_next]));
    expect(
      await pileWhen(
        d,
        (rows) => JSON.stringify(placed(rows)) === JSON.stringify({ 'Second Wish': 2, Kim: 1 }),
      ),
    ).toBe(true);

    await api.post('/api/admin/want/order', { reset: true }).expect(200);
    expect(await pileWhen(d, (rows) => rows.every((x) => !x.up_next))).toBe(true);
  });

  it('keeps and hides books from a to-read shelf', async () => {
    const d = (dash = await withData());
    const a = admin(d);
    await request(d.server)
      .put('/api/admin/imports?name=goodreads_library_export.csv')
      .set('X-Upload-Token', TOKEN)
      .type('text/csv')
      .send(GOODREADS)
      .expect(200);
    expect(await pileWhen(d, (rows) => rows.length === 2)).toBe(true);

    // keep the first: a copy on the list, merged with the shelf's row
    await a
      .post('/api/admin/want', {
        title: 'Wishlist',
        author: 'Wanda Wish',
        pages: 300,
        added: '2023-04-01',
        from: 'goodreads',
      })
      .expect(200);
    // hide the second
    await a.post('/api/admin/want/hide', { key: '' }).expect(400);
    await a.post('/api/admin/want/hide', { key: 'mine:wishlist' }).expect(400);
    await a.post('/api/admin/want/hide', { key: 'goodreads:14' }).expect(200);
    await a.post('/api/admin/want/hide', { key: 'goodreads:14' }).expect(200); // once
    expect(
      await pileWhen(
        d,
        (rows) =>
          rows.length === 1 &&
          rows[0].book_id === 'goodreads:13' &&
          rows[0].sources.join() === 'goodreads,mine',
      ),
    ).toBe(true);
    expect((await a.get('/api/admin/want').expect(200)).body.hidden).toEqual(['goodreads:14']);

    // the shelf is removed: the kept book stays on the pile
    await a.del('/api/admin/imports/goodreads').expect(200);
    expect(
      await pileWhen(d, (rows) => rows.length === 1 && rows[0].book_id === 'mine:wishlist'),
    ).toBe(true);

    await a.del('/api/admin/want/hide/goodreads:14').expect(200);
    await a.del('/api/admin/want/hide/goodreads:14').expect(404);
  });

  describe('searching Open Library', () => {
    let openLibrary: Server;
    const asked: string[] = [];
    beforeAll(async () => {
      openLibrary = createServer((req, res) => {
        asked.push(req.url ?? '');
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            docs: [
              {
                key: '/works/OL123W',
                title: 'Lorna Doone',
                author_name: ['R. D. Blackmore'],
                first_publish_year: 1869,
                number_of_pages_median: 640,
                isbn: ['0140433522', '9780140433524'],
                cover_i: 42,
              },
              { key: '/works/OL9W' }, // no title: left out
            ],
          }),
        );
      });
      openLibrary.listen(0, '127.0.0.1');
      await new Promise((r) => openLibrary.once('listening', r));
    });
    afterAll(() => new Promise((r) => openLibrary.close(r)));

    it('returns candidates to pick from', async () => {
      const url = `http://127.0.0.1:${(openLibrary.address() as AddressInfo).port}`;
      dash = await TestDashboard.start({ openLibraryUrl: url });
      const a = admin(dash);
      await a.get('/api/admin/want/search?q=a').expect(400);
      const res = await a.get('/api/admin/want/search?q=lorna%20doone').expect(200);
      expect(res.body.results).toEqual([
        {
          title: 'Lorna Doone',
          author: 'R. D. Blackmore',
          published_year: 1869,
          work_id: 'OL123W',
          isbn13: '9780140433524',
          pages: 640,
          cover_id: 42,
        },
      ]);
      expect(asked.at(-1)).toContain('q=lorna+doone');
      expect(asked.at(-1)).toContain('limit=10');
    });

    it("says so when Open Library can't be reached", async () => {
      // a port nothing listens on
      const closed = createServer();
      closed.listen(0, '127.0.0.1');
      await new Promise((r) => closed.once('listening', r));
      const port = (closed.address() as AddressInfo).port;
      await new Promise((r) => closed.close(r));
      dash = await TestDashboard.start({ openLibraryUrl: `http://127.0.0.1:${port}` });
      const res = await admin(dash).get('/api/admin/want/search?q=lorna').expect(502);
      expect(res.body.error).toMatch(/Open Library/);
    });
  });
});
