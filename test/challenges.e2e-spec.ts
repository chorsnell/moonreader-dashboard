/**
 * Reading challenges (BOO-80): only the admin sets them, they live in settings.json next to
 * the other sections, and everyone reads them as data/challenges.json.
 */
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { DEFAULT_CHALLENGES } from '../src/challenges/challenges';
import { TOKEN, TestDashboard } from './support/test-dashboard';

let dash: TestDashboard | undefined;
afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

const as = (d: TestDashboard) => ({
  get: (url: string) => request(d.server).get(url).set('X-Upload-Token', TOKEN),
  put: (url: string, body: object) =>
    request(d.server).put(url).set('X-Upload-Token', TOKEN).send(body),
  post: (url: string, body: object = {}) =>
    request(d.server).post(url).set('X-Upload-Token', TOKEN).send(body),
});

describe('reading challenges', () => {
  it('are set by the admin only', async () => {
    dash = await TestDashboard.start();
    await request(dash.server).get('/api/admin/challenges').expect(403);
    await request(dash.server).put('/api/admin/challenges').send({ challenges: [] }).expect(403);
    await request(dash.server).post('/api/admin/challenges/reset').expect(403);
  });

  it('start as the defaults, served to everyone as data/challenges.json', async () => {
    dash = await TestDashboard.start();
    const got = await as(dash).get('/api/admin/challenges').expect(200);
    expect(got.body).toMatchObject({ challenges: DEFAULT_CHALLENGES, custom: false });
    const served = await request(dash.server).get('/data/challenges.json').expect(200);
    expect(served.body).toEqual(DEFAULT_CHALLENGES);
  });

  it('saves into settings.json, keeping its other sections, and publishes them', async () => {
    dash = await TestDashboard.start();
    const d = dash;
    await as(d).post('/api/access', { access: 'password', password: 'friends' }).expect(200);
    const mine = [{ kind: 'genres', title: 'Eight genres', target: 8, period: 'all' }];
    const saved = await as(d).put('/api/admin/challenges', { challenges: mine }).expect(200);
    expect(saved.body.challenges).toEqual([{ id: 'genres', ...mine[0] }]);
    const settings = JSON.parse(await readFile(d.path('settings.json'), 'utf8'));
    expect(settings).toMatchObject({ access: 'password', challenges: saved.body.challenges });
    // and saving who can see the dashboard keeps the challenges
    await as(d).post('/api/access', { access: 'public' }).expect(200);
    const again = JSON.parse(await readFile(d.path('settings.json'), 'utf8'));
    expect(again.challenges).toEqual(saved.body.challenges);
    expect(JSON.parse(await readFile(d.path('data', 'challenges.json'), 'utf8'))).toEqual(
      saved.body.challenges,
    );

    const bad = await as(d)
      .put('/api/admin/challenges', { challenges: [{ kind: 'women', title: 'x', target: 500 }] })
      .expect(400);
    expect(bad.body.error).toMatch(/between 1 and 100/);

    const reset = await as(d).post('/api/admin/challenges/reset').expect(200);
    expect(reset.body).toEqual({ challenges: DEFAULT_CHALLENGES, custom: false });
    const after = JSON.parse(await readFile(d.path('settings.json'), 'utf8'));
    expect(after).not.toHaveProperty('challenges');
    expect(after.access).toBe('public');
  });
});
