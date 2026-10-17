/**
 * Link previews: the Open Graph tags in the page and the cover collage they point at, for a
 * public dashboard, and nothing about the reading for one behind a password.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode, encode } from 'jpeg-js';
import request from 'supertest';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let backup: Buffer;
let dash: TestDashboard | undefined;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-share-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

/** A dashboard with the fake backup built, and a real cover for one book. */
async function withData(overrides: Parameters<typeof TestDashboard.start>[0] = {}) {
  const d = await TestDashboard.start(overrides);
  await request(d.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup)
    .expect(200);
  expect(await waitFor(fileExists(d.path('data', 'meta.json')))).toBe(true);
  const data = Buffer.alloc(40 * 60 * 4, 200);
  await writeFile(d.path('covers', 'beta.jpg'), encode({ width: 40, height: 60, data }).data);
  return d;
}

const meta = (html: string, name: string) =>
  new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)">`).exec(html)?.[1] ?? null;

describe('link previews', () => {
  it('describes a public dashboard and shows its covers', async () => {
    dash = await withData();
    const page = await request(dash.server)
      .get('/')
      .set('Host', 'books.test')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);
    expect(meta(page.text, 'og:title')).toMatch(/^Reading history/);
    expect(meta(page.text, 'og:description')).toMatch(/words/);
    expect(meta(page.text, 'og:url')).toBe('https://books.test/');
    const image = meta(page.text, 'og:image')!;
    expect(image).toMatch(/^https:\/\/books\.test\/share\.jpg\?v=[\w-]+$/);
    expect(meta(page.text, 'twitter:card')).toBe('summary_large_image');

    const res = await request(dash.server)
      .get(image.slice('https://books.test'.length))
      .buffer(true)
      .expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    const img = decode(res.body as Buffer);
    expect([img.width, img.height]).toEqual([1200, 630]);
    await request(dash.server).get('/share.jpg').set('If-None-Match', res.headers.etag).expect(304);
  });

  it('uses PUBLIC_URL when it is set', async () => {
    dash = await withData({ publicUrl: 'https://example.test/reading' });
    const page = await request(dash.server).get('/').expect(200);
    expect(meta(page.text, 'og:url')).toBe('https://example.test/reading/');
    expect(meta(page.text, 'og:image')).toMatch(/^https:\/\/example\.test\/reading\/share\.jpg/);
  });

  it('says nothing about the reading behind a password', async () => {
    dash = await withData();
    await request(dash.server)
      .post('/api/access')
      .set('X-Upload-Token', TOKEN)
      .send({ access: 'password', password: 'friends' })
      .expect(200);
    const page = await request(dash.server).get('/').expect(200);
    expect(meta(page.text, 'og:title')).toBe('Reading history');
    expect(meta(page.text, 'og:description')).toBe('A reading history from Moon+ Reader.');
    expect(meta(page.text, 'og:image')).toBeNull();
    await request(dash.server).get('/share.jpg').expect(404);
  });

  it('has plain tags and no picture before there is any data', async () => {
    dash = await TestDashboard.start();
    const page = await request(dash.server).get('/').expect(200);
    expect(meta(page.text, 'og:title')).toBe('Reading history');
    await request(dash.server).get('/share.jpg').expect(404);
  });
});
