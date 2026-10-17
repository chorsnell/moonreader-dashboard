import type { ActivityEntry } from './activity-log.service';

const HOUR_MS = 3_600_000;
/** Never warn before this long without a sync. */
const MIN_QUIET_HOURS = 48;
/** Warn after this many times the usual gap between days with a sync. */
const QUIET_FACTOR = 3;
/** Only judge once there have been syncs on this many different days. */
const MIN_SYNC_DAYS = 3;

export interface ActivityHealth {
  last_sync: string | null;
  hours_since_sync: number | null;
  /** The usual number of hours between days with a sync, or null with too few to tell. */
  usual_gap_hours: number | null;
  /** True when syncing seems to have stopped: much longer than usual since the last one. */
  sync_stopped: boolean;
  /** A failed sync (wrong password, bad file) newer than the last good one. */
  last_sync_failure: { time: string; error: string | null } | null;
  last_rebuild: {
    time: string;
    outcome: string;
    trigger: string | null;
    error: string | null;
  } | null;
  last_upload: string | null;
}

const ms = (time: string) => new Date(time).getTime();
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Health at a glance, from the activity log (oldest first). */
export function activityHealth(entries: ActivityEntry[], now = new Date()): ActivityHealth {
  const syncs = entries.filter((e) => e.type === 'sync');
  const good = syncs.filter((e) => e.outcome === 'ok');
  const last = good.at(-1) ?? null;
  const failed = syncs.filter((e) => e.outcome === 'failed').at(-1);
  const days = [...new Set(good.map((e) => e.time.slice(0, 10)))].slice(-31);
  let usual: number | null = null;
  if (days.length >= MIN_SYNC_DAYS) {
    const gaps = days.slice(1).map((d, i) => (ms(d) - ms(days[i])) / HOUR_MS);
    usual = Math.round(median(gaps));
  }
  const since = last ? Math.max(0, (now.getTime() - ms(last.time)) / HOUR_MS) : null;
  const rebuild = entries.filter((e) => e.type === 'rebuild').at(-1);
  return {
    last_sync: last?.time ?? null,
    hours_since_sync: since === null ? null : Math.round(since * 10) / 10,
    usual_gap_hours: usual,
    sync_stopped:
      usual !== null && since !== null && since > Math.max(MIN_QUIET_HOURS, QUIET_FACTOR * usual),
    last_sync_failure:
      failed && (!last || failed.time >= last.time)
        ? { time: failed.time, error: failed.error ?? null }
        : null,
    last_rebuild: rebuild
      ? {
          time: rebuild.time,
          outcome: rebuild.outcome,
          trigger: rebuild.trigger ?? null,
          error: rebuild.error ?? null,
        }
      : null,
    last_upload:
      entries.filter((e) => e.type === 'upload' && e.outcome === 'ok').at(-1)?.time ?? null,
  };
}

export interface ActivityFilter {
  type?: string;
  outcome?: string;
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  q?: string;
}

const searchText = (e: ActivityEntry) =>
  [e.message, e.error, e.trigger, ...Object.values(e.details ?? {}).map((v) => JSON.stringify(v))]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

/** The entries matching a filter, newest first. */
export function filterActivity(entries: ActivityEntry[], f: ActivityFilter): ActivityEntry[] {
  const q = f.q?.trim().toLowerCase();
  return entries
    .filter(
      (e) =>
        (!f.type || e.type === f.type) &&
        (!f.outcome || e.outcome === f.outcome) &&
        (!f.from || e.time.slice(0, 10) >= f.from) &&
        (!f.to || e.time.slice(0, 10) <= f.to) &&
        (!q || searchText(e).includes(q)),
    )
    .reverse();
}
