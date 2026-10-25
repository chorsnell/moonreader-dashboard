/**
 * The KOReader plugin's sync (koreader/API.md): statistics and sidecars in, what the
 * dashboard knows about the device's books out, and KOReader's own WebDAV statistics sync.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { makeBackup } from './support/fake-backup';
import { makeKoreaderDb } from './support/fake-koreader';
import { DAV_AUTH, TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

interface BookRow {
  id: string;
  title: string;
  status: string;
  progress: number | null;
  source?: string;
}
interface HighlightRow {
  book_id: string;
  text: string;
  note: string | null;
}

let tmp: string;
let backup: Buffer;
let stats: Buffer;
let dash: TestDashboard | undefined;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-koreader-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
  makeKoreaderDb(join(tmp, 'statistics.sqlite3'));
  stats = await readFile(join(tmp, 'statistics.sqlite3'));
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

/** Runs `change`, then waits for the rebuild it causes. */
async function andRebuild(d: TestDashboard, change: () => Promise<unknown>): Promise<void> {
  const before = await metaTime(d);
  await new Promise((r) => setTimeout(r, 1100));
  await change();
  expect(await waitFor(async () => (await metaTime(d)) !== before)).toBe(true);
  // a second change during the build gets its own; let it settle
  await new Promise((r) => setTimeout(r, 300));
}

describe('KOReader sync', () => {
  it('is only for the admin, and POSTs must be JSON', async () => {
    dash = await TestDashboard.start();
    for (const [method, path] of [
      ['put', '/api/koreader/stats'],
      ['post', '/api/koreader/books'],
      ['post', '/api/koreader/match'],
    ] as const) {
      await request(dash.server)[method](path).send('{}').type('application/json').expect(403);
    }
    await request(dash.server)
      .post('/api/koreader/books')
      .set('X-Upload-Token', TOKEN)
      .type('text/plain')
      .send('{"books":[]}')
      .expect(400);
  });

  it('takes statistics and sidecars, and sends back what Moon+ knows', async () => {
    dash = await withData();
    const d = dash;

    // a database that isn't KOReader's is refused
    await request(d.server)
      .put('/api/koreader/stats')
      .set('X-Upload-Token', TOKEN)
      .type('application/octet-stream')
      .send(Buffer.from('not a database at all'))
      .expect(400);

    await andRebuild(d, () =>
      request(d.server)
        .put('/api/koreader/stats?device=Kobo%20Libra')
        .set('X-Upload-Token', TOKEN)
        .type('application/octet-stream')
        .send(stats)
        .expect(200)
        .then((res) => expect(res.body).toMatchObject({ ok: true, books: 3, days: 6 })),
    );
    let books = await d.json<BookRow[]>('data', 'books.json');
    expect(books.find((b) => b.title === 'KOReader Only Book')).toMatchObject({
      status: 'finished',
      source: 'koreader',
    });

    // a large body is fine here (the app's JSON parser takes 4 kB)
    const filler = 'x'.repeat(20_000);
    await andRebuild(d, () =>
      request(d.server)
        .post('/api/koreader/books')
        .set('X-Upload-Token', TOKEN)
        .type('application/json')
        .send({
          device: 'Kobo Libra',
          books: [
            {
              md5: 'k0r3ad3r2',
              title: 'Gamma',
              authors: 'Gus Gamma',
              pages: 300,
              percent: 1,
              status: 'complete',
              annotations: [
                {
                  text: 'A Gamma passage.',
                  note: filler,
                  datetime: '2026-02-02 21:00:00',
                  pageno: 150,
                  drawer: 'lighten',
                },
              ],
            },
            // Moon+'s highlight, copied into KOReader by the plugin and sent back
            {
              md5: 'k0r3ad3r4',
              title: 'Alpha',
              authors: 'Ann Author',
              pages: 100,
              percent: 0.49,
              annotations: [{ text: 'It was a dark  and stormy night.', drawer: 'lighten' }],
            },
            { md5: 'moonplus:alpha', title: 'Alpha' },
          ],
        })
        .expect(200)
        .then((res) => expect(res.body).toEqual({ ok: true, books: 2 })),
    );
    books = await d.json<BookRow[]>('data', 'books.json');
    expect(books.find((b) => b.title === 'Gamma')).toMatchObject({ status: 'finished' });
    const highlights = await d.json<HighlightRow[]>('data', 'highlights.json');
    expect(highlights.filter((h) => h.text === 'A Gamma passage.')).toHaveLength(1);
    // the same passage isn't counted twice
    expect(highlights.filter((h) => h.book_id === 'alpha' && /stormy/.test(h.text))).toHaveLength(
      1,
    );

    const match = await request(d.server)
      .post('/api/koreader/match')
      .set('X-Upload-Token', TOKEN)
      .type('application/json')
      .send({
        files: [
          { md5: 'k0r3ad3r4', file: 'alpha.epub', title: 'Alpha', authors: 'Ann Author' },
          { md5: 'new-md5', file: '/mnt/onboard/Beta - Bob Writer.epub' },
          { md5: 'nothing', file: 'Unknown.epub', title: 'Unknown' },
        ],
        others: true,
      })
      .expect(200);
    const [alpha, beta, none] = match.body.books;
    expect(none).toEqual({ md5: 'nothing', match: null });
    expect(beta.match).toMatchObject({ id: 'beta', title: 'Beta' });
    expect(alpha.match.id).toBe('alpha');
    // Moon+'s days, without the one KOReader has (2 March)
    expect(alpha.match.days.map((x: { date: string }) => x.date)).toEqual([
      '2026-03-01',
      '2026-03-03',
    ]);
    expect(alpha.match.highlights.map((h: { text: string }) => h.text)).toEqual(['The end.']);
    // both Moon+ books were matched, so nothing else to bring in
    expect(match.body.others).toEqual([]);
  });

  it('imports statistics KOReader syncs over WebDAV, with ETags', async () => {
    dash = await withData();
    const d = dash;
    await andRebuild(d, () =>
      request(d.server)
        .put('/dav/KOReader/statistics.sqlite3')
        .set('Authorization', DAV_AUTH)
        .send(stats)
        .expect(201),
    );
    const books = await d.json<BookRow[]>('data', 'books.json');
    expect(books.find((b) => b.title === 'KOReader Only Book')?.source).toBe('koreader');

    const got = await request(d.server)
      .get('/dav/KOReader/statistics.sqlite3')
      .set('Authorization', DAV_AUTH)
      .expect(200);
    const etag = got.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    // a stale ETag means another device synced in between: KOReader merges again
    await request(d.server)
      .put('/dav/KOReader/statistics.sqlite3')
      .set('Authorization', DAV_AUTH)
      .set('If-Match', '"0-0"')
      .send(stats)
      .expect(412);
    await request(d.server)
      .put('/dav/KOReader/statistics.sqlite3')
      .set('Authorization', DAV_AUTH)
      .set('If-Match', `W/${etag}`)
      .send(stats)
      .expect(204);
  });

  it('adds up two devices without counting a shared book twice', async () => {
    dash = await withData();
    const d = dash;
    const second = join(tmp, 'second.sqlite3');
    makeKoreaderDb(second);
    const db = new DatabaseSync(second);
    db.prepare(
      `insert into book (id, title, authors, pages, md5) values (9, 'Phone Book', 'Pam', 50, 'phone')`,
    ).run();
    const start = Math.floor(Date.parse('2026-04-01T12:00:00Z') / 1000);
    for (let p = 1; p <= 10; p++) {
      db.prepare(
        'insert into page_stat_data (id_book, page, start_time, duration, total_pages) values (9, ?, ?, 60, 50)',
      ).run(p, start + p * 60);
    }
    db.close();
    for (const [device, body] of [
      ['Kobo', stats],
      ['Phone', await readFile(second)],
    ] as const) {
      await andRebuild(d, () =>
        request(d.server)
          .put(`/api/koreader/stats?device=${device}`)
          .set('X-Upload-Token', TOKEN)
          .type('application/octet-stream')
          .send(body)
          .expect(200),
      );
    }
    const daily = await d.json<{ book_id: string; title: string; minutes: number }[]>(
      'data',
      'daily.json',
    );
    const only = daily.filter((r) => r.title === 'KOReader Only Book');
    expect(only.map((r) => r.minutes)).toEqual([20, 90]);
    expect(daily.filter((r) => r.title === 'Phone Book')).toHaveLength(1);
  });
});
