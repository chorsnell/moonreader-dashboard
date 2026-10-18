/**
 * Daily highlight review (BOO-83): today's highlights, the owner's answers (admin only),
 * visitors' read-only list (empty when highlights are hidden), the Anki export, and the
 * morning send through notifications (BOO-72), to a stand-in webhook.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PRESETS } from '../src/privacy/privacy';
import { ReviewService } from '../src/review/review.service';
import { makeBackup } from './support/fake-backup';
import { FakeHooks } from './support/fake-hooks';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let backup: Buffer;
let dash: TestDashboard;
let hooks: FakeHooks;
let hookUrl: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-review-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  backup = await readFile(join(tmp, 'test.mrpro'));
  hooks = new FakeHooks();
  hookUrl = await hooks.start();
  dash = await TestDashboard.start();
  await request(dash.server)
    .put('/upload?name=test.mrpro')
    .set('X-Upload-Token', TOKEN)
    .type('application/octet-stream')
    .send(backup)
    .expect(200);
  expect(await waitFor(fileExists(dash.path('data', 'meta.json')))).toBe(true);
});

afterAll(async () => {
  await dash.stop();
  await hooks.stop();
  await rm(tmp, { recursive: true, force: true });
});

const admin = {
  get: (p: string) => request(dash.server).get(p).set('X-Upload-Token', TOKEN),
  put: (p: string, b: object) => request(dash.server).put(p).set('X-Upload-Token', TOKEN).send(b),
  post: (p: string, b: object) => request(dash.server).post(p).set('X-Upload-Token', TOKEN).send(b),
};

describe('daily highlight review', () => {
  it('keeps answers, settings and the Anki export for the admin', async () => {
    for (const [method, path] of [
      ['get', '/api/admin/review/settings'],
      ['put', '/api/admin/review/settings'],
      ['get', '/api/admin/review/anki.txt'],
      ['post', '/api/admin/review/0123456789abcdef0123'],
    ] as const) {
      const res = await request(dash.server)[method](path).send({ action: 'keep' });
      expect([path, res.status]).toEqual([path, 403]);
    }
  });

  it('gives the admin today’s highlights and spaces out answers', async () => {
    const t = (await admin.get('/api/review/today').expect(200)).body;
    expect(t.can_review).toBe(true);
    expect(t.highlights).toBe(2);
    expect(t.items.map((i: { title: string }) => i.title)).toEqual(['Alpha', 'Alpha']);
    // the same pick when asked again
    expect((await admin.get('/api/review/today').expect(200)).body.items).toEqual(t.items);

    const [first, second] = t.items as { key: string }[];
    await admin.post(`/api/admin/review/${first.key}`, { action: 'sometimes' }).expect(400);
    await admin.post('/api/admin/review/ffffffffffffffffffff', { action: 'keep' }).expect(404);
    const kept = (
      await admin.post(`/api/admin/review/${first.key}`, { action: 'keep' }).expect(200)
    ).body;
    expect(kept.card).toMatchObject({ interval: 7, reviews: 1 });
    expect(kept.next.when).toBe('in 7 days');
    const never = (
      await admin.post(`/api/admin/review/${second.key}`, { action: 'never' }).expect(200)
    ).body;
    expect(never).toMatchObject({ card: { never: true }, next: null });
    const state = await dash.json<{ cards: Record<string, unknown> }>('highlight-review.json');
    expect(Object.keys(state.cards).sort()).toEqual([first.key, second.key].sort());

    const anki = await admin.get('/api/admin/review/anki.txt').expect(200);
    const lines = anki.text.trimEnd().split('\n');
    expect(lines[0]).toBe('#separator:tab');
    expect(lines).toHaveLength(4); // the never-again one is left out
  });

  it('shows visitors a read-only list, and nothing when highlights are hidden', async () => {
    // by default the public doesn't see highlights
    const hidden = (await request(dash.server).get('/api/review/today').expect(200)).body;
    expect(hidden).toEqual({ date: expect.any(String), items: [], can_review: false });
    await admin.put('/api/admin/privacy', { public: PRESETS.everything }).expect(200);
    const shown = (await request(dash.server).get('/api/review/today').expect(200)).body;
    expect(shown.can_review).toBe(false);
    expect(shown.items.length).toBe(2);
    expect(shown.items[0]).not.toHaveProperty('card');
    expect(shown).not.toHaveProperty('settings');
    await request(dash.server)
      .post(`/api/admin/review/${shown.items[0].key}`)
      .send({ action: 'keep' })
      .expect(403);
  });

  it('sends today’s highlights each morning through notifications, once a day', async () => {
    await admin
      .post('/api/admin/notify/channels', { type: 'webhook', url: `${hookUrl}/hook` })
      .expect(200);
    const s = await admin.put('/api/admin/review/settings', { notify: true, hour: 7 }).expect(200);
    expect(s.body).toMatchObject({ notify: true, hour: 7, per_day: 5 });
    expect((await admin.get('/api/admin/review/settings').expect(200)).body.notifier).toBe(true);

    const review = dash.app.get(ReviewService);
    const day = new Date();
    day.setHours(6, 0, 0, 0);
    expect(await review.morning(day)).toBe(false); // too early
    expect(hooks.at('/hook')).toHaveLength(0);
    day.setHours(7, 30);
    // today's pick was made in an earlier test and stays for the day, answered or not
    hooks.clear();
    expect(await review.morning(day)).toBe(true);
    const got = hooks.at('/hook');
    expect(got).toHaveLength(1);
    const body = JSON.stringify(got[0].body);
    expect(body).toContain('highlight_review');
    expect(body).toContain('It was a dark');
    day.setHours(9);
    expect(await review.morning(day)).toBe(false); // once a day
  });
});
