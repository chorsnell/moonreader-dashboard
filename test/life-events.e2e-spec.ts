/**
 * Holidays, trips and life events (BOO-86): the admin endpoints, the calendar feed (from a
 * fake iCal server) and what visitors get of data/life_events.json.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { PRESETS } from '../src/privacy/privacy';
import { TOKEN, TestDashboard, fileExists, waitFor } from './support/test-dashboard';

let dash: TestDashboard | undefined;
let cal: Server;
let calUrl = '';
let feed = '';
let status = 200;
let hits: string[] = [];

const ICS = (summary: string) =>
  [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:summer',
    `SUMMARY:${summary}`,
    'DTSTART;VALUE=DATE:20250801',
    'DTEND;VALUE=DATE:20250815',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:dentist',
    'SUMMARY:Dentist',
    'DTSTART:20250903T090000Z',
    'DTEND:20250903T100000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

beforeAll(async () => {
  cal = createServer((req, res) => {
    hits.push(req.url ?? '');
    res.writeHead(status, { 'Content-Type': 'text/calendar' });
    res.end(feed);
  });
  await new Promise<void>((r) => cal.listen(0, '127.0.0.1', r));
  calUrl = `http://127.0.0.1:${(cal.address() as AddressInfo).port}/secret-token-123/basic.ics`;
});

afterAll(() => new Promise<void>((r) => cal.close(() => r())));

beforeEach(() => {
  feed = ICS('Summer holiday');
  status = 200;
  hits = [];
});

afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

const admin = (d: TestDashboard) => ({
  get: (url: string) => request(d.server).get(url).set('X-Upload-Token', TOKEN),
  put: (url: string, body: object) =>
    request(d.server).put(url).set('X-Upload-Token', TOKEN).send(body),
  post: (url: string, body: object = {}) =>
    request(d.server).post(url).set('X-Upload-Token', TOKEN).send(body),
  del: (url: string) => request(d.server).delete(url).set('X-Upload-Token', TOKEN),
});

describe('life events', () => {
  it('are only for the admin', async () => {
    dash = await TestDashboard.start({ lifeEventsRefreshHours: 0 });
    await request(dash.server).get('/api/admin/life-events').expect(403);
    await request(dash.server)
      .post('/api/admin/life-events')
      .send({ title: 'x', start: '2025-01-01' })
      .expect(403);
    await request(dash.server)
      .put('/api/admin/life-events/calendar')
      .send({ url: calUrl })
      .expect(403);
    expect(hits).toEqual([]);
  });

  it('adds, changes and removes events marked by hand', async () => {
    dash = await TestDashboard.start({ lifeEventsRefreshHours: 0 });
    const a = admin(dash);
    expect((await a.get('/api/admin/life-events').expect(200)).body.events).toEqual([]);
    await request(dash.server).get('/data/life_events.json').expect(404);

    const bad = await a.post('/api/admin/life-events', { title: 'A', start: 'soon' }).expect(400);
    expect(bad.body.error).toMatch(/start/);
    const r = await a
      .post('/api/admin/life-events', {
        title: 'New job',
        kind: 'job',
        start: '2025-02-03',
        end: '2025-02-28',
      })
      .expect(200);
    expect(r.body.event).toMatchObject({ id: 'new-job', kind: 'job', source: 'manual' });
    await a
      .put('/api/admin/life-events/new-job', {
        title: 'New job at Acme',
        kind: 'job',
        start: '2025-02-03',
      })
      .expect(200);
    const served = await a.get('/data/life_events.json').expect(200);
    expect(served.body).toEqual([
      {
        id: 'new-job',
        title: 'New job at Acme',
        kind: 'job',
        start: '2025-02-03',
        end: '2025-02-03',
        source: 'manual',
      },
    ]);
    await a.del('/api/admin/life-events/new-job').expect(200);
    expect(await waitFor(() => !fileExists(dash!.path('data', 'life_events.json'))(), 500)).toBe(
      true,
    );
  });

  it('reads a calendar feed, never handing out its address', async () => {
    dash = await TestDashboard.start({ lifeEventsRefreshHours: 0 });
    const a = admin(dash);
    const set = await a.put('/api/admin/life-events/calendar', { url: calUrl }).expect(200);
    expect(set.body).toMatchObject({ read: 1, error: null });
    expect(set.body.calendar).toMatchObject({ set: true, host: expect.stringMatching(/^127/) });
    expect(JSON.stringify(set.body)).not.toContain('secret-token');
    expect(hits).toEqual(['/secret-token-123/basic.ics']);

    const served = (await a.get('/data/life_events.json').expect(200)).body;
    expect(served).toEqual([
      {
        id: 'cal-summer',
        title: 'Summer holiday',
        kind: 'holiday',
        start: '2025-08-01',
        end: '2025-08-14',
        source: 'calendar',
      },
    ]); // the dentist appointment is too short to count
    const listed = await a.get('/api/admin/life-events').expect(200);
    expect(JSON.stringify(listed.body)).not.toContain('secret-token');

    // a failed read keeps what the last good one found
    status = 500;
    const failed = await a.post('/api/admin/life-events/calendar/refresh').expect(200);
    expect(failed.body.error).toMatch(/HTTP 500/);
    expect(failed.body.calendar.events).toHaveLength(1);
    expect((await a.get('/data/life_events.json').expect(200)).body).toHaveLength(1);

    // a feed that isn't a calendar
    status = 200;
    feed = '<html>nope</html>';
    expect(
      (await a.post('/api/admin/life-events/calendar/refresh').expect(200)).body.error,
    ).toMatch(/iCalendar/);

    // removing the calendar removes its events
    await a.put('/api/admin/life-events/calendar', { url: '' }).expect(200);
    await request(dash.server)
      .get('/data/life_events.json')
      .set('X-Upload-Token', TOKEN)
      .expect(404);
  });

  it('fails soft when the calendar is unreachable', async () => {
    dash = await TestDashboard.start({ lifeEventsRefreshHours: 0 });
    const r = await admin(dash)
      .put('/api/admin/life-events/calendar', { url: 'http://127.0.0.1:9/cal.ics' })
      .expect(200);
    expect(r.body.error).toMatch(/reach/);
    await admin(dash).put('/api/admin/life-events/calendar', { url: 'ftp://x/y' }).expect(400);
  });

  it('are kept from visitors unless the owner shows them', async () => {
    dash = await TestDashboard.start({ lifeEventsRefreshHours: 0 });
    const a = admin(dash);
    await a
      .post('/api/admin/life-events', { title: 'Baby', kind: 'baby', start: '2025-05-05' })
      .expect(200);
    // the default policy, and the everything preset, keep them back
    expect((await request(dash.server).get('/data/life_events.json').expect(200)).body).toEqual([]);
    await a.put('/api/admin/privacy', { public: PRESETS.everything }).expect(200);
    expect((await request(dash.server).get('/data/life_events.json').expect(200)).body).toEqual([]);
    await a
      .put('/api/admin/privacy', { public: { ...PRESETS.everything, life_events: true } })
      .expect(200);
    const shown = (await request(dash.server).get('/data/life_events.json').expect(200)).body;
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: 'Baby', start: '2025-05-05' });
  });
});
