/**
 * KOReader's own progress sync (KOSync) pointed at the dashboard: log in with UPLOAD_TOKEN,
 * push a position from one device and get it on another.
 */
import { createHash } from 'node:crypto';
import request from 'supertest';
import { TOKEN, TestDashboard } from './support/test-dashboard';

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
