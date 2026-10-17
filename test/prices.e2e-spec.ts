/**
 * End-to-end tests for the price list: the admin endpoints, the CSV import and the copy of
 * the prices the page reads (data/prices.json).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-prices-'));
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

const admin = (d: TestDashboard) => ({
  get: (url: string) => request(d.server).get(url).set('X-Upload-Token', TOKEN),
  put: (url: string, body: object) =>
    request(d.server).put(url).set('X-Upload-Token', TOKEN).send(body),
  post: (url: string) => request(d.server).post(url).set('X-Upload-Token', TOKEN),
  del: (url: string) => request(d.server).delete(url).set('X-Upload-Token', TOKEN),
});

describe('prices', () => {
  it('are only for the admin', async () => {
    dash = await TestDashboard.start();
    await request(dash.server).get('/api/admin/prices').expect(403);
    await request(dash.server)
      .put('/api/admin/prices/books/alpha')
      .send({ title: 'x' })
      .expect(403);
    await request(dash.server)
      .post('/api/admin/prices/import')
      .type('text/csv')
      .send('title\nA')
      .expect(403);
  });

  it('has no data/prices.json until a price is saved', async () => {
    dash = await withData();
    expect(await waitFor(fileExists(dash.path('data', 'prices.json')), 500)).toBe(false);
    await request(dash.server).get('/data/prices.json').expect(404);
  });

  it('saves a book price and serves it converted, without notes', async () => {
    dash = await withData();
    const a = admin(dash);
    const list = await a.get('/api/admin/prices').expect(200);
    expect(list.body.books.map((b: { id: string }) => b.id).sort()).toEqual(['alpha', 'beta']);
    expect(list.body.acquisitions).toContain('subscription');

    await a
      .put('/api/admin/prices/settings', { home_currency: 'GBP', rates: { USD: 0.5 } })
      .expect(200);
    await a
      .put('/api/admin/prices/books/alpha', {
        title: 'Alpha',
        author: 'Ann Author',
        price: 10,
        currency: 'USD',
        date: '2026-02-01',
        notes: 'birthday voucher',
      })
      .expect(200);
    await a.put('/api/admin/prices/books/alpha', { title: '' }).expect(400);

    const served = (await request(dash.server).get('/data/prices.json').expect(200)).body;
    expect(served.currency).toBe('GBP');
    expect(served.books).toEqual([
      expect.objectContaining({ book_id: 'alpha', price: 5, paid: 10, paid_currency: 'USD' }),
    ]);
    expect(JSON.stringify(served)).not.toContain('voucher');
    // the admin's own copy keeps them
    const mine = await dash.json<{ books: Record<string, { notes: string }> }>('prices.json');
    expect(mine.books.alpha.notes).toBe('birthday voucher');

    await a.del('/api/admin/prices/books/alpha').expect(200);
    expect((await request(dash.server).get('/data/prices.json')).body.books).toEqual([]);
  });

  it('previews a CSV, then saves it', async () => {
    dash = await withData();
    const a = admin(dash);
    const csv =
      'Title,Author,Price,Date\nAlpha,Ann Author,£3.49,05/01/2026\nGamma,Gail,£8,\nBeta,,oops,';
    const preview = await a.post('/api/admin/prices/import').type('text/csv').send(csv).expect(200);
    expect(preview.body).toMatchObject({ saved: false, matched: 1, unmatched: 1, errors: 1 });
    expect(await waitFor(fileExists(dash.path('prices.json')), 300)).toBe(false);

    await a.post('/api/admin/prices/import').type('application/json').send({ csv }).expect(400);

    const done = await a
      .post('/api/admin/prices/import?confirm=1&add_unmatched=1')
      .type('text/csv')
      .send(csv)
      .expect(200);
    expect(done.body).toMatchObject({ saved: 1, added: 1 });
    const served = (await request(dash.server).get('/data/prices.json').expect(200)).body;
    expect(
      served.books.map((b: { book_id: string; price: number }) => [b.book_id, b.price]),
    ).toEqual([
      ['alpha', 3.49],
      ['gamma', 8],
    ]);

    const out = await a.get('/api/admin/prices/export.csv').expect(200);
    expect(out.headers['content-type']).toContain('text/csv');
    expect(out.text.split('\n')[0]).toContain('title,author,isbn,price');
  });

  it('keeps subscriptions', async () => {
    dash = await withData();
    const a = admin(dash);
    await a
      .put('/api/admin/prices/subscriptions', [{ name: 'KU', monthly_fee: 9.49, start: '2026-01' }])
      .expect(200);
    await a.put('/api/admin/prices/subscriptions', [{ name: 'KU' }]).expect(400);
    const served = (await request(dash.server).get('/data/prices.json').expect(200)).body;
    expect(served.subscriptions).toEqual([
      { name: 'KU', monthly_fee: 9.49, currency: 'GBP', start: '2026-01', end: null },
    ]);
  });
});
