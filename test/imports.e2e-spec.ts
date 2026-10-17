/**
 * Admin → Imports: a Goodreads export adds ratings, shelves and books read elsewhere to the
 * build; it can be removed again, and finished books exported back as a Goodreads CSV.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { makeBackup } from './support/fake-backup';
import { KINDLE_SESSIONS, KINDLE_TITLES, MY_CLIPPINGS, makeKoboDb } from './support/fake-kobo';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

interface BookRow {
  id: string;
  title: string;
  author: string;
  status: string;
  hours: number | null;
  rating?: number;
  shelves?: string[];
  source?: string;
}

interface ReadRow {
  book_id: string;
  start: string;
  end: string;
  finished: boolean;
  source?: string;
}

const GOODREADS = [
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies',
  '11,Alpha,Ann Author,"Author, Ann",,"=""""","=""""",4,3.9,,,200,2020,2020,,2024/01/01,favourites,favourites (#1),read,,,,1,0',
  '12,Paper Book (Paper Saga #2),Pat Paper,"Paper, Pat",,"=""""","=""""",5,4.1,,,300,2019,2019,2023/05/06,2023/04/01,,,read,,,,1,0',
  '13,Wishlist,Wanda Wish,"Wish, Wanda",,"=""""","=""""",0,4.0,,,300,2019,2019,,2023/04/01,to-read,to-read (#1),to-read,,,,0,0',
].join('\n');

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-imports-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

async function withData(): Promise<TestDashboard> {
  const d = await TestDashboard.start();
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

describe('imports', () => {
  it('are only for the admin', async () => {
    dash = await TestDashboard.start();
    for (const [method, path] of [
      ['get', '/api/admin/imports'],
      ['put', '/api/admin/imports'],
      ['delete', '/api/admin/imports/goodreads'],
      ['get', '/api/admin/imports/export/goodreads'],
    ] as const) {
      const res = await request(dash.server)[method](path);
      expect([path, res.status]).toEqual([path, 403]);
    }
  });

  it('leave the data as it was without an import', async () => {
    dash = await withData();
    const books = await dash.json<BookRow[]>('data', 'books.json');
    expect(books.some((b) => 'rating' in b || 'source' in b || 'shelves' in b)).toBe(false);
    expect(await dash.json('data', 'meta.json')).not.toHaveProperty('imports');
  });

  it('add a Goodreads export to the build, and come out again', async () => {
    dash = await withData();
    const d = dash;
    const before = await metaTime(d);
    await new Promise((r) => setTimeout(r, 1100));
    const res = await request(d.server)
      .put('/api/admin/imports?name=goodreads_library_export.csv')
      .set('X-Upload-Token', TOKEN)
      .type('text/csv')
      .send(GOODREADS)
      .expect(200);
    expect(res.body).toMatchObject({ source: 'goodreads', books: 3, rated: 2, rebuilding: true });
    expect(await waitFor(async () => (await metaTime(d)) !== before)).toBe(true);

    const books = await d.json<BookRow[]>('data', 'books.json');
    expect(books.find((b) => b.id === 'alpha')).toMatchObject({
      rating: 4,
      shelves: ['favourites'],
    });
    expect(books.find((b) => b.title === 'Paper Book')).toMatchObject({
      id: 'paper-book',
      author: 'Pat Paper',
      status: 'finished',
      hours: null,
      rating: 5,
      source: 'goodreads',
    });
    expect(books.some((b) => b.title === 'Wishlist')).toBe(false);
    const reads = await d.json<ReadRow[]>('data', 'reads.json');
    expect(reads.filter((r) => r.book_id === 'paper-book')).toEqual([
      expect.objectContaining({ start: '2023-05-06', end: '2023-05-06', source: 'goodreads' }),
    ]);
    const daily = await d.json<{ book_id: string }[]>('data', 'daily.json');
    expect(daily.some((r) => r.book_id === 'paper-book')).toBe(false);
    expect(await d.json('data', 'meta.json')).toMatchObject({
      imports: [{ source: 'goodreads', file: 'goodreads_library_export.csv' }],
    });

    const list = await request(d.server)
      .get('/api/admin/imports')
      .set('X-Upload-Token', TOKEN)
      .expect(200);
    expect(list.body.imports).toEqual([
      expect.objectContaining({ source: 'goodreads', books: 3, read: 2, rated: 2 }),
    ]);

    // finished Moon+ books go back to Goodreads; books from Goodreads don't
    const csv = await request(d.server)
      .get('/api/admin/imports/export/goodreads')
      .set('X-Upload-Token', TOKEN)
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe(
      'Title,Author,ISBN,ISBN13,My Rating,Date Read,Date Added,Bookshelves,Exclusive Shelf,Read Count',
    );
    expect(csv.text).not.toContain('Paper Book');

    const log = await readFile(d.path('activity.jsonl'), 'utf8');
    expect(log).toContain('"type":"import"');

    const mid = await metaTime(d);
    await new Promise((r) => setTimeout(r, 1100));
    await request(d.server)
      .delete('/api/admin/imports/goodreads')
      .set('X-Upload-Token', TOKEN)
      .expect(200);
    expect(await waitFor(async () => (await metaTime(d)) !== mid)).toBe(true);
    const after = await d.json<BookRow[]>('data', 'books.json');
    expect(after.some((b) => b.source || b.rating)).toBe(false);
  });

  it('refuse a file that is not an export', async () => {
    dash = await TestDashboard.start();
    const res = await request(dash.server)
      .put('/api/admin/imports?name=x.csv')
      .set('X-Upload-Token', TOKEN)
      .type('text/csv')
      .send('a,b\n1,2\n')
      .expect(400);
    expect(res.body.error).toMatch(/Goodreads or StoryGraph/);
  });

  it('build from a Kobo alone, then merge it with Moon+ and Kindle files', async () => {
    dash = await TestDashboard.start();
    const d = dash;
    makeKoboDb(join(tmp, 'KoboReader.sqlite'));
    const put = (name: string, body: Buffer | string) =>
      request(d.server)
        .put(`/api/admin/imports?name=${name}`)
        .set('X-Upload-Token', TOKEN)
        .type('application/octet-stream')
        .send(typeof body === 'string' ? Buffer.from(body) : body);

    const kobo = await put('KoboReader.sqlite', await readFile(join(tmp, 'KoboReader.sqlite')));
    expect(kobo.status).toBe(200);
    expect(kobo.body).toMatchObject({ source: 'kobo', books: 2, days: 2, highlights: 3 });
    expect(kobo.body.rebuilding).toBe(true);
    expect(await waitFor(fileExists(d.path('data', 'meta.json')))).toBe(true);
    let books = await d.json<BookRow[]>('data', 'books.json');
    expect(books.map((b) => b.id).sort()).toEqual(['alpha', 'kobo-only-book']);
    expect(books.find((b) => b.id === 'kobo-only-book')).toMatchObject({
      status: 'in_progress',
      source: 'kobo',
      hours: 1,
    });
    expect(await d.json('data', 'meta.json')).toMatchObject({ backup_file: null });
    const daily = await d.json<{ book_id: string; date: string }[]>('data', 'daily.json');
    expect(daily.filter((r) => r.book_id === 'kobo-only-book').map((r) => r.date)).toEqual([
      '2026-03-01',
      '2026-03-03',
    ]);

    // a Moon+ backup arrives: Alpha is one book, with Moon+'s days and the Kobo's read
    const before = await metaTime(d);
    await new Promise((r) => setTimeout(r, 1100));
    await request(d.server)
      .put('/upload?name=test.mrpro')
      .set('X-Upload-Token', TOKEN)
      .type('application/octet-stream')
      .send(backup)
      .expect(200);
    expect(await waitFor(async () => (await metaTime(d)) !== before)).toBe(true);
    books = await d.json<BookRow[]>('data', 'books.json');
    expect(books.filter((b) => b.title === 'Alpha')).toHaveLength(1);
    expect(books.find((b) => b.id === 'alpha')?.source).toBeUndefined();

    const mid = await metaTime(d);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await put('My Clippings.txt', MY_CLIPPINGS)).body).toMatchObject({
      source: 'kindle_clippings',
      books: 2,
      highlights: 3,
    });
    expect(await waitFor(async () => (await metaTime(d)) !== mid)).toBe(true);
    const highlights = await d.json<{ book_id: string; text: string }[]>('data', 'highlights.json');
    expect(highlights.find((h) => h.text === 'Beta has a line.')?.book_id).toBe('beta');
    expect(highlights.filter((h) => h.book_id === 'kobo-only-book')).toHaveLength(2);

    // reading sessions name books by ASIN until a title list arrives
    expect((await put('Kindle.Devices.ReadingSession.csv', KINDLE_SESSIONS)).body).toMatchObject({
      source: 'kindle',
      books: 1,
      days: 2,
    });
    const named = await put('orders.csv', KINDLE_TITLES);
    expect(named.body).toMatchObject({ source: 'kindle_titles', titles: 1, renamed: 1 });
    expect(
      await waitFor(async () =>
        (await d.json<BookRow[]>('data', 'books.json')).some((b) => b.title === 'The Kindle Book'),
      ),
    ).toBe(true);

    const list = await request(d.server)
      .get('/api/admin/imports')
      .set('X-Upload-Token', TOKEN)
      .expect(200);
    expect(list.body.imports.map((i: { source: string }) => i.source)).toEqual([
      'kobo',
      'kindle',
      'kindle_clippings',
    ]);
    expect(list.body.kindle_titles).toBe(1);
  });
});
