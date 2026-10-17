import { loadCalcs } from '../support/feature-calcs';

type Point = {
  date: string;
  cur: number | null;
  ghost: number;
  proj?: number;
  lo?: number;
  hi?: number;
};
type Forecast = {
  metric: string;
  ytd: number;
  ghost_ytd: number;
  ghost_total: number;
  proj: number;
  lo: number;
  hi: number;
  banded: boolean;
  has_ghost: boolean;
  days_left: number;
  series: Point[];
};

const run = loadCalcs('calcs.js', 'features/forecast.js');

// an hour a day from 1 Jan 2025 to 1 Jul 2026, 10,000 words a day; a book finished every 10 days
const daily: object[] = [];
const reads: object[] = [];
for (let t = Date.parse('2025-01-01'), i = 0; t <= Date.parse('2026-07-01'); t += 864e5, i++) {
  const date = new Date(t).toISOString().slice(0, 10);
  daily.push({ date, book_id: 'b', minutes: 60, words: 10_000 });
  if (i % 10 === 9) reads.push({ book_id: 'b' + i, start: date, end: date, finished: true });
}
const byMetric = Object.fromEntries(
  run<Forecast>('forecast', { daily, reads }).map((f) => [f.metric, f]),
);

describe('year-end forecast', () => {
  it('projects the rest of the year at the last 365 days’ pace', () => {
    const h = byMetric.hours;
    // 1 Jan to 1 Jul 2026 is 182 days; 183 days left
    expect(h.ytd).toBe(182);
    expect(h.days_left).toBe(183);
    expect(h.proj).toBeCloseTo(365);
    // a perfectly steady reader has no spread
    expect(h.banded).toBe(true);
    expect(h.hi - h.lo).toBeCloseTo(0);
  });

  it('races last year by the same date', () => {
    const w = byMetric.words;
    expect(w.has_ghost).toBe(true);
    expect(w.ghost_ytd).toBe(182 * 10_000);
    expect(w.ghost_total).toBe(365 * 10_000);
    const jul = w.series.find((p) => p.date === '2026-07-01')!;
    expect(jul).toMatchObject({ cur: 1_820_000, ghost: 1_820_000, proj: 1_820_000 });
    expect(w.series.find((p) => p.date === '2026-07-02')!.cur).toBeNull();
    expect(w.series).toHaveLength(365);
  });

  it('widens the band with an uneven pace', () => {
    const lumpy = daily.map((d, i) => ({ ...d, minutes: i % 60 < 30 ? 120 : 0 }));
    const h = run<Forecast>('forecast', { daily: lumpy, reads }).find((f) => f.metric === 'hours')!;
    expect(h.hi).toBeGreaterThan(h.proj);
    expect(h.lo).toBeLessThan(h.proj);
    expect(h.lo).toBeGreaterThanOrEqual(h.ytd);
  });
});

describe('unfinished books', () => {
  const books = [
    {
      id: 'a',
      title: 'A',
      author: 'X',
      status: 'finished',
      words: 100_000,
      times_read: 1,
      progress: 100,
    },
    {
      id: 'b',
      title: 'B',
      author: 'X',
      status: 'finished',
      words: 300_000,
      times_read: 2,
      progress: 100,
    },
    {
      id: 'c',
      title: 'C',
      author: 'X',
      status: 'in_progress',
      words: 50_000,
      times_read: 1,
      progress: 25,
    },
    {
      id: 'd',
      title: 'D',
      author: 'X',
      status: 'not_started',
      words: 0,
      times_read: 0,
      progress: 0,
    },
    {
      id: 'e',
      title: 'E',
      author: 'X',
      status: 'unknown',
      words: 0,
      times_read: 0,
      progress: null,
    },
  ];
  const rows = run<{ id: string; length: number; words_left: number; estimated: boolean }>(
    'unfinished',
    { books, daily },
  );

  it('measures a book from what you have read of it', () => {
    expect(rows.find((r) => r.id === 'c')).toMatchObject({
      length: 200_000,
      words_left: 150_000,
      estimated: false,
    });
  });

  it('takes the median finished length for books not started, and skips unknown progress', () => {
    // finished lengths: 100,000 and 150,000 a read
    expect(rows.find((r) => r.id === 'd')).toMatchObject({
      length: 150_000,
      words_left: 150_000,
      estimated: true,
    });
    expect(rows.map((r) => r.id)).toEqual(['c', 'd']);
  });
});
