/**
 * KOReader's own progress sync (KOSync) pointed at the dashboard: log in with UPLOAD_TOKEN,
 * push a position from one device and get it on another.
 */
import { createHash } from 'node:crypto';
import { readFile, utimes } from 'node:fs/promises';
import request from 'supertest';
import { DAV_AUTH, TOKEN, TestDashboard } from './support/test-dashboard';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const KOSYNC = {
  'x-auth-user': 'me',
  'x-auth-key': md5(TOKEN),
  accept: 'application/vnd.koreader.v1+json',
};

let dash: TestDashboard | undefined;
afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

describe('KOSync server', () => {
  it('answers the health check and logs in with UPLOAD_TOKEN only', async () => {
    dash = await TestDashboard.start();
    await request(dash.server).get('/kosync/healthcheck').expect(200, { state: 'OK' });
    await request(dash.server).get('/kosync/users/auth').set(KOSYNC).expect(200, {
      authorized: 'OK',
    });
    await request(dash.server)
      .get('/kosync/users/auth')
      .set({ ...KOSYNC, 'x-auth-key': md5('wrong') })
      .expect(401);
    await request(dash.server).get('/kosync/users/auth').expect(401);
  });

  it('"registers" only with the admin password', async () => {
    dash = await TestDashboard.start();
    await request(dash.server)
      .post('/kosync/users/create')
      .send({ username: 'me', password: md5(TOKEN) })
      .expect(201, { username: 'me' });
    const refused = await request(dash.server)
      .post('/kosync/users/create')
      .send({ username: 'me', password: md5('guess') })
      .expect(402);
    expect(refused.body.code).toBe(2002);
  });

  it('is off without UPLOAD_TOKEN', async () => {
    dash = await TestDashboard.start({ uploadToken: '' });
    await request(dash.server).get('/kosync/users/auth').set(KOSYNC).expect(404);
  });

  it('keeps the latest position for each document', async () => {
    dash = await TestDashboard.start();
    await request(dash.server).get('/kosync/syncs/progress/abc123').set(KOSYNC).expect(200, {});

    const put = await request(dash.server)
      .put('/kosync/syncs/progress')
      .set(KOSYNC)
      .send({
        document: 'abc123',
        progress: '/body/DocFragment[3]/body/p[2]/text().0',
        percentage: 0.25,
        device: 'Kobo Libra 2',
        device_id: 'K1',
      })
      .expect(200);
    expect(put.body.document).toBe('abc123');
    expect(typeof put.body.timestamp).toBe('number');

    const got = await request(dash.server)
      .get('/kosync/syncs/progress/abc123')
      .set(KOSYNC)
      .expect(200);
    expect(got.body).toMatchObject({
      document: 'abc123',
      progress: '/body/DocFragment[3]/body/p[2]/text().0',
      percentage: 0.25,
      device: 'Kobo Libra 2',
      device_id: 'K1',
    });
    expect(await dash.json('progress-sync', 'koreader.json')).toHaveProperty('abc123');
  });

  it('refuses a position without its fields', async () => {
    dash = await TestDashboard.start();
    await request(dash.server)
      .put('/kosync/syncs/progress')
      .set(KOSYNC)
      .send({ document: 'abc123' })
      .expect(400);
    await request(dash.server)
      .put('/kosync/syncs/progress')
      .set({ ...KOSYNC, 'x-auth-key': md5('wrong') })
      .send({ document: 'abc', progress: '1', percentage: 0.1 })
      .expect(401);
  });
});

describe('Moon+ positions for KOReader', () => {
  const PO = '/dav/Apps/Books/.Moon+/Cache/Dune.epub.po';
  const DUNE = md5('Dune.epub');

  async function moonplusSyncs(d: TestDashboard, text: string, atSeconds: number) {
    const res = await request(d.server).put(PO).set('Authorization', DAV_AUTH).send(text);
    expect([201, 204]).toContain(res.status);
    const file = d.path('dav', 'Apps', 'Books', '.Moon+', 'Cache', 'Dune.epub.po');
    await utimes(file, atSeconds, atSeconds);
  }

  it('gives KOReader the Moon+ position when it is the newest', async () => {
    dash = await TestDashboard.start();
    const now = Math.floor(Date.now() / 1000);
    await moonplusSyncs(dash, '1700000000000*5@0#1234:42.5%', now - 100);

    const got = await request(dash.server)
      .get(`/kosync/syncs/progress/${DUNE}`)
      .set(KOSYNC)
      .expect(200);
    expect(got.body).toEqual({
      document: DUNE,
      progress: '/body/DocFragment[6]',
      percentage: 0.425,
      device: 'Moon+ Reader',
      device_id: 'moonplus',
      timestamp: now - 100,
    });

    // KOReader reads on: its position is newer
    await request(dash.server)
      .put('/kosync/syncs/progress')
      .set(KOSYNC)
      .send({
        document: DUNE,
        progress: '/body/DocFragment[7]/body/p[3]/text().0',
        percentage: 0.5,
        device: 'Kobo',
        device_id: 'K1',
      })
      .expect(200);
    const after = await request(dash.server).get(`/kosync/syncs/progress/${DUNE}`).set(KOSYNC);
    expect(after.body.device).toBe('Kobo');

    // then Moon+ again
    await moonplusSyncs(dash, '1700000000000*9@0#10:61%', now + 100);
    const later = await request(dash.server).get(`/kosync/syncs/progress/${DUNE}`).set(KOSYNC);
    expect(later.body).toMatchObject({ progress: '/body/DocFragment[10]', percentage: 0.61 });
  });

  it('finds the book by the file name the KOReader plugin reported', async () => {
    dash = await TestDashboard.start();
    await moonplusSyncs(dash, '1*2@0#0:9%', Math.floor(Date.now() / 1000));
    await request(dash.server)
      .post('/api/koreader/books')
      .set('X-Upload-Token', TOKEN)
      .send({
        device: 'Kobo',
        books: [{ md5: 'partialmd5', file: 'Dune.kepub.epub', title: 'Dune' }],
      })
      .expect(200);
    const got = await request(dash.server)
      .get('/kosync/syncs/progress/partialmd5')
      .set(KOSYNC)
      .expect(200);
    expect(got.body).toMatchObject({ device: 'Moon+ Reader', progress: '/body/DocFragment[3]' });
  });
});

describe('KOReader positions for Moon+', () => {
  const CACHE = ['dav', 'Apps', 'Books', '.Moon+', 'Cache'];

  async function moonplusHasSynced(d: TestDashboard, bookFile: string, text: string) {
    const res = await request(d.server)
      .put(`/dav/Apps/Books/.Moon+/Cache/${encodeURIComponent(bookFile)}.po`)
      .set('Authorization', DAV_AUTH)
      .send(text);
    expect([201, 204]).toContain(res.status);
  }

  const push = (d: TestDashboard, document: string, progress: string, percentage: number) =>
    request(d.server)
      .put('/kosync/syncs/progress')
      .set(KOSYNC)
      .send({ document, progress, percentage, device: 'Kobo', device_id: 'K1' })
      .expect(200);

  it("writes KOReader's position into the book's .po file, and doesn't echo it back", async () => {
    dash = await TestDashboard.start();
    await moonplusHasSynced(dash, 'Dune.epub', '1700000000000*2@0#50:10%');
    await push(dash, md5('Dune.epub'), '/body/DocFragment[7]/body/p[3]/text().0', 0.5);

    const text = await readFile(dash.path(...CACHE, 'Dune.epub.po'), 'utf8');
    expect(text).toMatch(/^\d{13}\*6@0#0:50\.0%$/);

    // the .po file is newer now, but it's the dashboard's own: KOReader keeps its xpointer
    const got = await request(dash.server)
      .get(`/kosync/syncs/progress/${md5('Dune.epub')}`)
      .set(KOSYNC)
      .expect(200);
    expect(got.body).toMatchObject({
      device: 'Kobo',
      progress: '/body/DocFragment[7]/body/p[3]/text().0',
    });
  });

  it('starts a .po file for a book Moon+ has not synced, named as the plugin reported', async () => {
    dash = await TestDashboard.start();
    await moonplusHasSynced(dash, 'Dune.epub', '1*2@0#50:10%');
    await request(dash.server)
      .post('/api/koreader/books')
      .set('X-Upload-Token', TOKEN)
      .send({
        device: 'Kobo',
        books: [{ md5: 'fnd', file: 'Foundation.epub', title: 'Foundation' }],
      })
      .expect(200);
    await push(dash, 'fnd', '/body/DocFragment[2]/body/p[1]/text().0', 0.08);
    expect(await readFile(dash.path(...CACHE, 'Foundation.epub.po'), 'utf8')).toMatch(
      /\*1@0#0:8\.0%$/,
    );
  });

  it('leaves Moon+ alone for page numbers and unknown books', async () => {
    dash = await TestDashboard.start();
    await moonplusHasSynced(dash, 'Dune.epub', '1*2@0#50:10%');
    await push(dash, md5('Dune.epub'), '42', 0.5);
    await push(dash, 'unknown', '/body/DocFragment[2]', 0.1);
    expect(await readFile(dash.path(...CACHE, 'Dune.epub.po'), 'utf8')).toBe('1*2@0#50:10%');
  });
});
