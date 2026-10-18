/**
 * Highlights export (BOO-82): Markdown and Readwise CSV downloads, and pushing to a stand-in
 * for Readwise's v2 API. Admin only; the Readwise token never leaves the server.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

const RW_TOKEN = 'rw-secret-token';

/** Readwise's auth and highlights endpoints, remembering what it was sent. */
class FakeReadwise {
  calls: { method: string; path: string; auth: string; body: unknown }[] = [];
  status = 0;
  private server!: Server;
  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
        const auth = req.headers.authorization ?? '';
        this.calls.push({ method: req.method ?? '', path: req.url ?? '', auth, body });
        const ok = auth === `Token ${RW_TOKEN}`;
        const status = this.status || (!ok ? 401 : req.url === '/api/v2/auth/' ? 204 : 200);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(status === 204 ? undefined : JSON.stringify([]));
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }
}

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;
let rw: FakeReadwise;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-hl-export-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

beforeEach(async () => {
  rw = new FakeReadwise();
  const url = await rw.start();
  dash = await TestDashboard.start({ readwiseUrl: url });
});
afterEach(async () => {
  await dash?.stop();
  dash = undefined;
  await rw.stop();
});

const admin = (d: TestDashboard) => ({
  get: (p: string) => request(d.server).get(p).set('X-Upload-Token', TOKEN),
  put: (p: string, b: object) => request(d.server).put(p).set('X-Upload-Token', TOKEN).send(b),
  post: (p: string, b: object) => request(d.server).post(p).set('X-Upload-Token', TOKEN).send(b),
  delete: (p: string) => request(d.server).delete(p).set('X-Upload-Token', TOKEN),
});

async function withData(d: TestDashboard) {
  await request(d.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup)
    .expect(200);
  expect(await waitFor(fileExists(d.path('data', 'meta.json')))).toBe(true);
}

describe('highlights export', () => {
  it('is only for the admin', async () => {
    const d = dash!;
    for (const [method, path] of [
      ['get', '/api/admin/highlights'],
      ['get', '/api/admin/highlights/export/markdown.zip'],
      ['get', '/api/admin/highlights/export/readwise.csv'],
      ['put', '/api/admin/highlights/readwise'],
      ['delete', '/api/admin/highlights/readwise'],
      ['post', '/api/admin/highlights/readwise/push'],
    ] as const) {
      const res = await request(d.server)[method](path).send({});
      expect([path, res.status]).toEqual([path, 403]);
    }
  });

  it('downloads Markdown and a Readwise CSV', async () => {
    const d = dash!;
    await withData(d);
    const sum = await admin(d).get('/api/admin/highlights').expect(200);
    expect(sum.body).toMatchObject({ books: 1, highlights: 2, readwise: { token_set: false } });

    const zip = await admin(d)
      .get('/api/admin/highlights/export/markdown.zip')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    const body = zip.body as Buffer;
    expect(body.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(body.toString('utf8')).toContain('Highlights/Alpha');
    expect(body.toString('utf8')).toContain('> It was a dark');

    const csv = await admin(d).get('/api/admin/highlights/export/readwise.csv').expect(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    const lines = csv.text.split('\r\n');
    expect(lines[0]).toBe('Highlight,Title,Author,URL,Note,Location,Date');
    expect(lines.length).toBe(4); // two highlights and the closing newline
  });

  it('keeps the Readwise token on the server and sends only new highlights', async () => {
    const d = dash!;
    await withData(d);
    await admin(d).put('/api/admin/highlights/readwise', { token: 'wrong' }).expect(400);
    const set = await admin(d)
      .put('/api/admin/highlights/readwise', { token: RW_TOKEN })
      .expect(200);
    expect(JSON.stringify(set.body)).not.toContain(RW_TOKEN);
    const sum = await admin(d).get('/api/admin/highlights').expect(200);
    expect(JSON.stringify(sum.body)).not.toContain(RW_TOKEN);
    expect(sum.body.readwise.token_set).toBe(true);
    // nor in anything visitors or the page get
    const cfg = await admin(d).get('/api/config').expect(200);
    expect(JSON.stringify(cfg.body)).not.toContain(RW_TOKEN);

    const first = await admin(d).post('/api/admin/highlights/readwise/push', {}).expect(200);
    expect(first.body).toMatchObject({ sent: 2, skipped: 0, total: 2 });
    const pushes = rw.calls.filter((c) => c.path === '/api/v2/highlights/');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].auth).toBe(`Token ${RW_TOKEN}`);
    const sent = (pushes[0].body as { highlights: { title: string; location: number }[] })
      .highlights;
    expect(sent.map((h) => [h.title, h.location])).toEqual([
      ['Alpha', 1],
      ['Alpha', 2],
    ]);

    const again = await admin(d).post('/api/admin/highlights/readwise/push', {}).expect(200);
    expect(again.body).toMatchObject({ sent: 0, skipped: 2 });
    expect(rw.calls.filter((c) => c.path === '/api/v2/highlights/')).toHaveLength(1);
    const all = await admin(d)
      .post('/api/admin/highlights/readwise/push', { all: true })
      .expect(200);
    expect(all.body).toMatchObject({ sent: 2 });

    const rec = await d.json<{ pushed: Record<string, string> }>('readwise-pushed.json');
    expect(Object.keys(rec.pushed)).toHaveLength(2);

    rw.status = 429;
    await admin(d).post('/api/admin/highlights/readwise/push', { all: true }).expect(429);
    rw.status = 0;

    await admin(d).delete('/api/admin/highlights/readwise').expect(200);
    await admin(d).post('/api/admin/highlights/readwise/push', {}).expect(400);
  });
});
