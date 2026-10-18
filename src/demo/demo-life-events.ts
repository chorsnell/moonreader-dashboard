import type { LifeEvent } from '../life-events/life-events';
import type { DemoDay } from './simulate';

const DAY_MS = 86_400_000;
const iso = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * Made-up holidays and life events for the demo: each summer's busiest reading fortnight
 * as a holiday (so holidays read more, as they tend to), Christmas breaks, a new job and a
 * house move. Days are days since 1970; the history runs from firstDay to lastDay.
 */
export function demoLifeEvents(
  log: Map<string, DemoDay[]>,
  firstDay: number,
  lastDay: number,
): LifeEvent[] {
  const minutes = new Map<number, number>();
  for (const entries of log.values()) {
    for (const e of entries) {
      const d = firstDay + e.day;
      minutes.set(d, (minutes.get(d) ?? 0) + e.minutes);
    }
  }
  const out: LifeEvent[] = [];
  const add = (id: string, title: string, kind: LifeEvent['kind'], s: number, e: number) => {
    const a = Math.max(s, firstDay);
    const b = Math.min(e, lastDay);
    if (a <= b) out.push({ id, title, kind, start: iso(a), end: iso(b), source: 'manual' });
  };
  const y0 = +iso(firstDay).slice(0, 4);
  const y1 = +iso(lastDay).slice(0, 4);
  const places = ['Cornwall', 'the Lakes', 'Brittany', 'Skye', 'the Dordogne'];
  for (let y = y0; y <= y1; y++) {
    // the summer fortnight (starting on a Saturday) with the most reading
    const from = Date.UTC(y, 6, 1) / DAY_MS;
    const to = Date.UTC(y, 7, 18) / DAY_MS;
    let best = -1;
    let start = 0;
    for (let s = from; s <= to; s++) {
      if (new Date(s * DAY_MS).getUTCDay() !== 6) continue;
      let m = 0;
      for (let d = s; d < s + 14; d++) m += minutes.get(d) ?? 0;
      if (m > best) [best, start] = [m, s];
    }
    if (best > 0) {
      add(
        `summer-${y}`,
        `Summer in ${places[(y - y0) % places.length]}`,
        'holiday',
        start,
        start + 13,
      );
    }
    add(
      `christmas-${y}`,
      'Christmas break',
      'holiday',
      Date.UTC(y, 11, 23) / DAY_MS,
      Date.UTC(y + 1, 0, 1) / DAY_MS,
    );
  }
  // a new job about a third of the way in (its first month), and a move later on
  const job = firstDay + Math.floor((lastDay - firstDay) * 0.35);
  add('new-job', 'Started at the library', 'job', job, job + 27);
  const move = firstDay + Math.floor((lastDay - firstDay) * 0.62);
  add('house-move', 'Moved house', 'move', move, move + 9);
  const trip = firstDay + Math.floor((lastDay - firstDay) * 0.74);
  add(
    'city-break',
    'Weekend in Edinburgh',
    'trip',
    trip - ((new Date(trip * DAY_MS).getUTCDay() + 1) % 7),
    trip - ((new Date(trip * DAY_MS).getUTCDay() + 1) % 7) + 2,
  );
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}
