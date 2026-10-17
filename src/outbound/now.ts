/**
 * The "now" summary (BOO-71): what you're reading, today's and this week's minutes, the
 * streak and whether it's at risk, the year's goal and a quote of the day, in one small
 * object. Home Assistant's REST sensor reads it, and so do the badges and the e-ink view.
 *
 * Pure functions of the data files and calcs as one audience gets them (StatsSet), so a
 * summary never says more than that audience's page would. What the audience's policy
 * hides comes back as null rather than as a misleading 0.
 */
import type { Policy } from '../privacy/privacy';

type Row = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const DAY_MS = 86_400_000;
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A book being read now. */
export interface NowBook {
  id: string;
  title: string;
  author: string;
  genre: string | null;
  /** Percent through, 0 to 100, or null when unknown. */
  progress: number | null;
  last_read: string | null;
  /** The cover's path under the dashboard (covers/<id>.jpg?v=…), or null for none. */
  cover: string | null;
}

/** The streak of days in a row with some reading, as of `today`. */
export interface Streak {
  /** Days in a row up to today, or up to yesterday while today has no reading yet. */
  current: number;
  /** The longest run ever. */
  best: number;
  /** The last day with reading, or null. */
  last_day: string | null;
  read_today: boolean;
  /** A streak is going (read yesterday) but nothing has been read today yet. */
  at_risk: boolean;
}

export interface YearGoal {
  year: number;
  /** Reads finished this year (re-reads count). */
  finished: number;
  /** Books to finish this year, or null when no goal is set. */
  goal: number | null;
  /** finished / goal as a percent (may pass 100), or null. */
  percent: number | null;
  /** How many should be finished by today to keep pace, or null. */
  expected: number | null;
  /** finished - expected (negative: behind), or null. */
  ahead: number | null;
}

export interface Quote {
  text: string;
  note: string | null;
  book_id: string;
  title: string;
  author: string;
}

export interface NowSummary {
  /** The day the summary is for (the server's local date). */
  today: string;
  /** The last day in the reading data. */
  as_of: string | null;
  /** When the data was built. */
  generated: string | null;
  reading: NowBook[] | null;
  /** Minutes read today and this week (Monday on), or null when the days are hidden. */
  today_minutes: number | null;
  week_minutes: number | null;
  /** null when streaks are hidden. */
  streak: Streak | null;
  year: YearGoal;
  quote: Quote | null;
}

export interface NowInputs {
  /** books.json, reads.json, daily.json as the audience gets them. */
  books: unknown;
  reads: unknown;
  daily: unknown;
  /** The `current` calc's rows (books on the go). */
  current: unknown;
  /** The `quote_pool` calc's rows (highlights worth showing). */
  quotes: unknown;
  /** The `as_of` calc's rows. */
  asOf: unknown;
  generated: string | null;
  /** {book id: cover path} as /api/covers gives this audience. */
  covers: Record<string, string>;
  /** The audience's policy, or null for the admin (everything). */
  policy: Policy | null;
  /** Books to finish this year, or null. */
  goal: number | null;
  /** The server's local date, YYYY-MM-DD. */
  today: string;
}

/**
 * The streak as of `today` from the reading days (dates of days with any reading, in any
 * order, repeats allowed). Exported for push notifications (BOO-72): `at_risk` is the "you
 * haven't read today" nudge.
 */
export function streakOf(days: Iterable<string>, today: string): Streak {
  const t = ms(today);
  const set = [...new Set([...days].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && ms(d) <= t))];
  set.sort();
  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const d of set) {
    const x = ms(d);
    run = x - prev === DAY_MS ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  const has = new Set(set);
  const readToday = has.has(today);
  let current = 0;
  for (let x = readToday ? t : t - DAY_MS; has.has(iso(x)); x -= DAY_MS) current++;
  return {
    current,
    best,
    last_day: set.length ? set[set.length - 1] : null,
    read_today: readToday,
    at_risk: !readToday && current > 0,
  };
}

/** The day of the week (Monday) a day is in. */
export function weekStart(day: string): string {
  const t = ms(day);
  return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS);
}

/** The page's quote-of-the-day pick (web/features/quote-of-the-day.js): FNV-1a of the day. */
export function quoteIndex(day: string, count: number): number {
  let x = 2166136261;
  for (const c of day) x = Math.imul(x ^ (c.codePointAt(0) ?? 0), 16777619);
  return (x >>> 0) % count;
}

/** Whether the audience gets exact days in daily.json (see effectiveDates in privacy.ts). */
function exactDays(p: Policy | null): boolean {
  return !p || (p.diary && p.dates === 'day' && p.streaks);
}

export function nowSummary(input: NowInputs): NowSummary {
  const p = input.policy;
  const { today } = input;
  const daily = rows(input.daily);
  const asOf = str(rows(input.asOf)[0]?.date) || null;

  const reading =
    p && !p.current
      ? null
      : rows(input.current).map((b): NowBook => ({
          id: str(b.id),
          title: str(b.title),
          author: str(b.author),
          genre: str(b.genre) || null,
          progress: typeof b.progress === 'number' ? b.progress : null,
          last_read: str(b.last_read) || null,
          cover: input.covers[str(b.id)] ?? null,
        }));

  const exact = exactDays(p);
  const minutesFrom = (from: string) =>
    Math.round(
      daily
        .filter((d) => str(d.date) >= from && str(d.date) <= today)
        .reduce((a, d) => a + num(d.minutes), 0),
    );
  const read = (d: Row) => num(d.minutes) > 0 || num(d.words) > 0;
  // week rows (dates rounded to the week) still add up to this week's minutes
  const weekly = !p || (p.diary && (p.dates === 'day' || p.dates === 'week'));

  const year = Number(today.slice(0, 4));
  const finished = rows(input.reads).filter(
    (r) => r.finished === true && str(r.end).slice(0, 4) === String(year),
  ).length;
  const goal = input.goal && input.goal > 0 ? input.goal : null;
  const start = Date.UTC(year, 0, 1);
  const fraction = (ms(today) + DAY_MS - start) / (Date.UTC(year + 1, 0, 1) - start);
  const expected = goal === null ? null : Math.round(goal * fraction * 10) / 10;

  const pool = rows(input.quotes).filter((q) => str(q.text));
  const q = pool.length ? pool[quoteIndex(today, pool.length)] : null;

  return {
    today,
    as_of: asOf,
    generated: input.generated,
    reading,
    today_minutes: exact ? minutesFrom(today) : null,
    week_minutes: weekly ? minutesFrom(weekStart(today)) : null,
    streak:
      exact && (!p || p.streaks)
        ? streakOf(
            daily.filter(read).map((d) => str(d.date)),
            today,
          )
        : null,
    year: {
      year,
      finished,
      goal,
      percent: goal === null ? null : Math.round((finished / goal) * 100),
      expected,
      ahead: expected === null ? null : Math.round((finished - expected) * 10) / 10,
    },
    quote: q
      ? {
          text: str(q.text),
          note: str(q.note) || null,
          book_id: str(q.book_id),
          title: str(q.title),
          author: str(q.author),
        }
      : null,
  };
}
