import { activityHealth, filterActivity } from './activity-health';
import type { ActivityEntry } from './activity-log.service';

const sync = (time: string, outcome: 'ok' | 'failed' = 'ok', error?: string): ActivityEntry => ({
  type: 'sync',
  time,
  outcome,
  message: 'WebDAV: reading position Books/a.epub.po',
  ...(error ? { error } : {}),
  details: { kind: 'position', book: 'a.epub' },
});

describe('activityHealth', () => {
  const daily = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04'].flatMap((d) => [
    sync(`${d}T08:00:00`),
    sync(`${d}T21:30:00`),
  ]);

  it('says when the last sync was and how often they usually come', () => {
    const h = activityHealth(daily, new Date('2026-05-05T09:30:00'));
    expect(h.last_sync).toBe('2026-05-04T21:30:00');
    expect(h.hours_since_sync).toBe(12);
    expect(h.usual_gap_hours).toBe(24);
    expect(h.sync_stopped).toBe(false);
  });

  it('warns when syncing seems to have stopped', () => {
    expect(activityHealth(daily, new Date('2026-05-06T21:00:00')).sync_stopped).toBe(false);
    expect(activityHealth(daily, new Date('2026-05-08T10:00:00')).sync_stopped).toBe(true);
  });

  it('does not judge with too few syncs', () => {
    const h = activityHealth(daily.slice(0, 3), new Date('2026-09-01T00:00:00'));
    expect([h.usual_gap_hours, h.sync_stopped]).toEqual([null, false]);
    expect(activityHealth([], new Date()).last_sync).toBeNull();
  });

  it('reports a failure newer than the last good sync', () => {
    const failed = sync('2026-05-05T07:00:00', 'failed', 'Wrong password');
    const h = activityHealth([...daily, failed], new Date('2026-05-05T08:00:00'));
    expect(h.last_sync_failure).toEqual({ time: '2026-05-05T07:00:00', error: 'Wrong password' });
    const fixed = activityHealth([...daily, failed, sync('2026-05-05T07:05:00')]);
    expect(fixed.last_sync_failure).toBeNull();
  });
});

describe('filterActivity', () => {
  const entries: ActivityEntry[] = [
    sync('2026-05-01T08:00:00'),
    {
      type: 'rebuild',
      time: '2026-05-02T08:00:00',
      outcome: 'failed',
      message: 'Rebuild from x.mrpro failed',
      error: 'no database',
      trigger: 'upload',
    },
    { type: 'upload', time: '2026-05-03T08:00:00', outcome: 'ok', message: 'Received x.mrpro' },
  ];

  it('filters by type, outcome, date and text, newest first', () => {
    expect(filterActivity(entries, {}).map((e) => e.type)).toEqual(['upload', 'rebuild', 'sync']);
    expect(filterActivity(entries, { type: 'sync' })).toHaveLength(1);
    expect(filterActivity(entries, { outcome: 'failed' })[0].type).toBe('rebuild');
    expect(filterActivity(entries, { from: '2026-05-02', to: '2026-05-02' })).toHaveLength(1);
    expect(filterActivity(entries, { q: 'DATABASE' })[0].type).toBe('rebuild');
    expect(filterActivity(entries, { q: 'a.epub' })[0].type).toBe('sync');
    expect(filterActivity(entries, { q: 'time' })).toEqual([]); // not the field names
  });
});
