/**
 * Notifications (BOO-72): channels for ntfy, Gotify, Discord and a webhook (fake servers),
 * set by the admin without their secrets ever coming back; events found by comparing with
 * what was already notified, so a rebuild or a restart never sends anything twice.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { NotifyWatchService } from '../src/notify/notify-watch.service';
import { NotifierService } from '../src/notify/notifier.service';
import { makeBackup } from './support/fake-backup';
import { FakeHooks } from './support/fake-hooks';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let tmp: string;
let dash: TestDashboard;
let admin: string;
const hooks = new FakeHooks();
let base: string;
let dead: string;

const as = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
  request(dash.server)[method](path).set('Cookie', admin);
const watch = (d = dash) => d.app.get(NotifyWatchService);
/** A day in the fake backup's March, at 10 pm local time. */
const evening = (day: number) => new Date(2026, 2, day, 22, 0, 0);
const state = async () =>
  JSON.parse(await readFile(dash.path('notify-state.json'), 'utf8')) as Record<string, unknown>;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'e2e-notify-'));
  await makeBackup(join(tmp, 'test.mrpro'));
  base = await hooks.start();
  // somewhere nothing answers
  const gone = new FakeHooks();
  dead = await gone.start();
  await gone.stop();
  dash = await TestDashboard.start({ publicUrl: 'https://reading.example' });
  const res = await request(dash.server).post('/api/login').send({ password: TOKEN }).expect(200);
  admin = String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
});

afterAll(async () => {
  await dash.stop();
  await hooks.stop();
  await rm(tmp, { recursive: true, force: true });
});

describe('notification channels', () => {
  it('are the admin’s only, and their secrets never come back', async () => {
    await request(dash.server).get('/api/admin/notify').expect(403);
    await request(dash.server)
      .post('/api/admin/notify/channels')
      .send({ type: 'ntfy', url: `${base}/x` })
      .expect(403);
    await as('post', '/api/admin/notify/channels').send({ type: 'gotify', url: base }).expect(400);
    await as('post', '/api/admin/notify/channels').send({ type: 'pager', url: base }).expect(400);
    for (const c of [
      { type: 'ntfy', url: `${base}/ntfy/reading-topic-SECRET`, token: 'tk_NTFY' },
      { type: 'gotify', url: `${base}/gotify`, token: 'GOTIFYAPP' },
      { type: 'discord', url: `${base}/api/webhooks/1/DISCORDSECRET` },
      { type: 'webhook', url: `${base}/hook`, token: 'HOOKTOKEN', name: 'Home Assistant' },
    ]) {
      await as('post', '/api/admin/notify/channels').send(c).expect(200);
    }
    const got = await as('get', '/api/admin/notify').expect(200);
    const text = JSON.stringify(got.body);
    for (const secret of ['SECRET', 'tk_NTFY', 'GOTIFYAPP', 'HOOKTOKEN', '/hook', '/gotify']) {
      expect(text).not.toContain(secret);
    }
    expect(got.body.channels.map((c: { type: string }) => c.type)).toEqual([
      'ntfy',
      'gotify',
      'discord',
      'webhook',
    ]);
    expect(got.body.events).toMatchObject({ book_finished: true, streak_at_risk: true });
    // the page's settings response doesn't carry them either
    const cfg = await as('get', '/api/config').expect(200);
    expect(JSON.stringify(cfg.body)).not.toContain('GOTIFYAPP');
  });

  it('get a test message from "Send test"', async () => {
    const { channels } = (await as('get', '/api/admin/notify').expect(200)).body;
    for (const c of channels) {
      const r = await as('post', `/api/admin/notify/channels/${c.id}/test`).expect(200);
      expect(r.body).toEqual({ ok: true });
    }
    const ntfy = hooks.at('/ntfy')[0];
    expect(ntfy.headers.authorization).toBe('Bearer tk_NTFY');
    expect(ntfy.body).toMatchObject({
      topic: 'reading-topic-SECRET',
      title: 'Test from your reading dashboard',
    });
    const gotify = hooks.at('/gotify/message')[0];
    expect(gotify.headers['x-gotify-key']).toBe('GOTIFYAPP');
    expect(gotify.body.title).toBe('Test from your reading dashboard');
    expect((hooks.at('/api/webhooks/1/DISCORDSECRET')[0].body.embeds as unknown[]).length).toBe(1);
    const hook = hooks.at('/hook')[0];
    expect(hook.headers.authorization).toBe('Bearer HOOKTOKEN');
    expect(hook.body.event).toBe('test');
    hooks.clear();

    // a channel that doesn't answer says so, without its address
    const add = await as('post', '/api/admin/notify/channels')
      .send({ type: 'webhook', url: `${dead}/SECRETPATH`, name: 'Gone' })
      .expect(200);
    const r = await as('post', `/api/admin/notify/channels/${add.body.id}/test`).expect(200);
    expect(r.body.ok).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain('SECRETPATH');
    await as('delete', `/api/admin/notify/channels/${add.body.id}`).expect(200);
    await as('delete', `/api/admin/notify/channels/${add.body.id}`).expect(404);
  });
});

describe('events', () => {
  it('start from a silent baseline after the first rebuild', async () => {
    await request(dash.server)
      .put('/upload?name=test.mrpro')
      .set('X-Upload-Token', TOKEN)
      .type('application/octet-stream')
      .send(await readFile(join(tmp, 'test.mrpro')))
      .expect(200);
    expect(await waitFor(fileExists(dash.path('notify-state.json')))).toBe(true);
    expect((await state()).finished).toEqual(['alpha#1']);
    expect(hooks.received).toEqual([]);
  });

  it('are sent once to every channel when something new comes in', async () => {
    // as if Alpha's finish hadn't been seen yet, and the streak record were shorter
    const s = await state();
    await writeFile(
      dash.path('notify-state.json'),
      JSON.stringify({
        ...s,
        finished: [],
        records: { ...(s.records as object), longest_streak: 2 },
      }),
    );
    const sent = await watch().check('test', evening(5));
    expect(sent.map((e) => e.kind).sort()).toEqual([
      'book_finished',
      'new_record',
      'streak_at_risk',
    ]);
    const ntfy = hooks.at('/ntfy').map((r) => r.body.title);
    expect(ntfy).toEqual(
      expect.arrayContaining([
        'Finished Alpha',
        'New record: longest streak',
        'Your 4-day streak is at risk',
      ]),
    );
    const finished = hooks.at('/hook').find((r) => r.body.event === 'book_finished')!;
    expect(finished.body).toMatchObject({
      title: 'Finished Alpha',
      url: 'https://reading.example/#book/alpha',
      data: { book_id: 'alpha', author: 'Ann Author' },
    });
    expect(hooks.at('/gotify/message')).toHaveLength(3);
    expect(hooks.at('/api/webhooks/1/DISCORDSECRET')).toHaveLength(3);

    // the same data again, and later the same evening: nothing more
    hooks.clear();
    expect(await watch().check('test', evening(5))).toEqual([]);
    expect(await watch().check('test', new Date(2026, 2, 5, 23, 30))).toEqual([]);
    await as('post', '/api/admin/rebuild')
      .send({})
      .expect((r) => expect(r.status).toBeLessThan(300));
    expect(hooks.received).toEqual([]);
  });

  it('are not sent again by a restarted server', async () => {
    const again = await TestDashboard.start({ library: dash.lib });
    try {
      expect(await watch(again).check('test', evening(5))).toEqual([]);
    } finally {
      await again.app.close();
    }
    expect(hooks.received).toEqual([]);
  });

  it('follow the toggles in admin', async () => {
    const put = await as('put', '/api/admin/notify')
      .send({ events: { streak_at_risk: false }, streak_hour: 20, streak_min: 1 })
      .expect(200);
    expect(put.body).toMatchObject({ streak_hour: 20, streak_min: 1 });
    // the year goal is the one set under Widgets & devices (BOO-71)
    await as('put', '/api/admin/outbound/goal').send({ goal: 1 }).expect(200);
    // 7 March: read yesterday, not today, but "streak at risk" is off; the goal of 1 is met
    const sent = await watch().check('test', evening(7));
    expect(sent.map((e) => [e.kind, e.title])).toEqual([
      ['year_goal', 'Year goal reached: 1 book'],
    ]);
    expect(hooks.at('/hook').map((r) => r.body.event)).toEqual(['year_goal']);
    hooks.clear();
    expect(await watch().check('test', evening(7))).toEqual([]);
    // switched back on the same evening, it warns: that isn't old news
    await as('put', '/api/admin/notify')
      .send({ events: { streak_at_risk: true } })
      .expect(200);
    const warned = await watch().check('test', evening(7));
    expect(warned.map((e) => e.title)).toEqual(['Your 1-day streak is at risk']);
    expect((await state()).streak_warned).toBe('2026-03-07');
    hooks.clear();
  });

  it('can be sent by other features through NotifierService.send', async () => {
    const r = await dash.app.get(NotifierService).send({
      kind: 'highlight_review',
      title: 'Your morning highlights',
      message: 'Three passages from a year ago.',
      data: { count: 3 },
    });
    expect(r).toEqual({ enabled: true, sent: 4, failed: [] });
    expect(hooks.at('/hook')[0].body).toMatchObject({
      event: 'highlight_review',
      data: { count: 3 },
    });
    await as('put', '/api/admin/notify')
      .send({ events: { highlight_review: false } })
      .expect(200);
    expect(
      (
        await dash.app
          .get(NotifierService)
          .send({ kind: 'highlight_review', title: 'x', message: 'y' })
      ).enabled,
    ).toBe(false);
  });
});
