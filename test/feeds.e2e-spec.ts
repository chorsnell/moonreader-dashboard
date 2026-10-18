/**
 * Feeds (BOO-74): the admin makes Atom and iCal feeds at secret URLs; each is built from
 * what its audience may see, works behind the read password, and stops working when its
 * address is rotated or it's revoked. Only hashes of the secrets are kept.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PRESETS } from '../src/privacy/privacy';
import { makeBackup } from './support/fake-backup';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let dash: TestDashboard;
let admin: string;

const everything = { ...PRESETS.everything };
const as = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
  request(dash.server)[method](path).set('Cookie', admin);
const path = (url: string) => new URL(url).pathname;

async function make(kind: 'atom' | 'ical', audience = 'public') {
  const res = await as('post', '/api/admin/feeds').send({ kind, audience }).expect(200);
  return res.body as { feed: { id: string }; url: string };
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-feeds-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  dash = await TestDashboard.start();
  await request(dash.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(await readFile(join(tmp, 'test.mrpro')))
    .expect(200);
  expect(await waitFor(fileExists(dash.path('data', 'meta.json')))).toBe(true);
  expect(await waitFor(fileExists(dash.path('covers', 'alpha.png')), 5000)).toBe(true);
  const res = await request(dash.server).post('/api/login').send({ password: TOKEN }).expect(200);
  admin = String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
});

afterAll(async () => {
  await dash.stop();
  await rm(tmp, { recursive: true, force: true });
});

describe('feeds', () => {
  it('are made by the admin only, and only their hashes are kept', async () => {
    await request(dash.server).get('/api/admin/feeds').expect(403);
    await request(dash.server).post('/api/admin/feeds').send({ kind: 'atom' }).expect(403);
    await as('post', '/api/admin/feeds').send({ kind: 'rss' }).expect(400);
    const { url, feed } = await make('atom');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/feeds\/[A-Za-z0-9_-]{43}\.atom$/);
    const secret = /feeds\/(.+)\.atom/.exec(url)![1];
    const listed = (await as('get', '/api/admin/feeds').expect(200)).body.feeds;
    expect(listed.map((f: { id: string }) => f.id)).toContain(feed.id);
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(JSON.stringify(listed)).not.toContain('token_hash');
    const file = await readFile(dash.path('feeds.json'), 'utf8');
    expect(file).not.toContain(secret);
    expect(file).toContain('token_hash');
    expect((await stat(dash.path('feeds.json'))).mode & 0o077).toBe(0);
  });

  it('serve an Atom feed of finished books with covers', async () => {
    const { url } = await make('atom');
    const res = await request(dash.server).get(path(url)).expect(200);
    expect(res.headers['content-type']).toMatch(/^application\/atom\+xml/);
    const xml = res.text;
    expect(xml).toContain('<title>Alpha, Ann Author</title>');
    expect(xml).not.toContain('Beta'); // half way, not finished
    const cover = /<img src="([^"&]+)/.exec(xml.replace(/&quot;/g, '"').replace(/&lt;/g, '<'));
    expect(cover).not.toBeNull();
    const img = await request(dash.server)
      .get(path(cover![1].replace(/&amp;/g, '&')))
      .expect(200);
    expect(img.headers['content-type']).toMatch(/image/);
    // the feed's secret doesn't open other feeds' URLs or the wrong extension
    await request(dash.server).get(path(url).replace('.atom', '.ics')).expect(404);
    await request(dash.server).get('/feeds/not-a-real-secret-at-all-xxxxxxx.atom').expect(404);
  });

  it('serve an iCal calendar of reading days, finishes and club check-ins', async () => {
    await as('put', '/api/admin/friends/settings').send({ visible_to: 'public' }).expect(200);
    await as('post', '/api/admin/clubs')
      .send({
        book: { title: 'Beta', author: 'Bob Writer', book_id: 'beta' },
        start: '2026-03-01',
        pct_per_week: 50,
      })
      .expect(200);
    const { url } = await make('ical');
    const res = await request(dash.server).get(path(url)).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    const ics = res.text;
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Finished Alpha');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260301');
    expect(ics).toMatch(/SUMMARY:Read \d+ min/);
    expect(ics).toContain('SUMMARY:Book club starts: Beta');
    expect(ics).toContain('SUMMARY:Book club finishes: Beta');
    // clubs stay out once friends are the admin's again
    await as('put', '/api/admin/friends/settings').send({ visible_to: 'admin' }).expect(200);
    expect((await request(dash.server).get(path(url)).expect(200)).text).not.toContain('Book club');
  });

  it("follow their audience's privacy settings", async () => {
    const atom = await make('atom', 'public');
    const ical = await make('ical', 'public');
    const readerIcal = await make('ical', 'reader');
    await as('put', '/api/admin/privacy')
      .send({ public: PRESETS.taste, reader: everything, private_books: ['alpha'] })
      .expect(200);
    const xml = (await request(dash.server).get(path(atom.url)).expect(200)).text;
    expect(xml).not.toContain('Alpha');
    expect(xml).not.toContain('<entry>');
    const ics = (await request(dash.server).get(path(ical.url)).expect(200)).text;
    expect(ics).not.toContain('Alpha');
    expect(ics).not.toMatch(/SUMMARY:Read /); // taste only: no reading days
    const cover = /feeds\/(.+)\.atom/.exec(atom.url)![1];
    await request(dash.server).get(`/feeds/${cover}/covers/alpha.png`).expect(404);

    await as('put', '/api/admin/privacy')
      .send({ public: PRESETS.taste, reader: everything })
      .expect(200);
    const month = (await request(dash.server).get(path(ical.url)).expect(200)).text;
    // finishes span the month the public's dates are rounded to
    expect(month).toMatch(
      /DTSTART;VALUE=DATE:20260301\r\nDTEND;VALUE=DATE:20260401\r\nSUMMARY:Finished Alpha/,
    );
    const reader = (await request(dash.server).get(path(readerIcal.url)).expect(200)).text;
    expect(reader).toMatch(/SUMMARY:Read /);
    await as('put', '/api/admin/privacy').send({ public: everything }).expect(200);
  });

  it('work behind the read password', async () => {
    const { url } = await make('atom', 'reader');
    await request(dash.server)
      .post('/api/access')
      .set('Cookie', admin)
      .send({ access: 'password', password: 'friends' })
      .expect(200);
    await request(dash.server).get('/data/books.json').expect(401);
    expect((await request(dash.server).get(path(url)).expect(200)).text).toContain('Alpha');
    await request(dash.server)
      .post('/api/access')
      .set('Cookie', admin)
      .send({ access: 'public' })
      .expect(200);
  });

  it('stop working when rotated or revoked', async () => {
    const { url, feed } = await make('atom');
    const rotated = await as('post', `/api/admin/feeds/${feed.id}/rotate`).expect(200);
    expect(rotated.body.url).not.toBe(url);
    await request(dash.server).get(path(url)).expect(404);
    await request(dash.server).get(path(rotated.body.url)).expect(200);
    await as('delete', `/api/admin/feeds/${feed.id}`).expect(200);
    await request(dash.server).get(path(rotated.body.url)).expect(404);
    await as('delete', `/api/admin/feeds/${feed.id}`).expect(404);
  });

  it('survive a broken feeds.json', async () => {
    await writeFile(dash.path('feeds.json'), '{nope');
    expect((await as('get', '/api/admin/feeds').expect(200)).body.feeds).toEqual([]);
  });
});
