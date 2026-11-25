import { loadCalcs } from '../support/feature-calcs';

type Overview = {
  since: string;
  sessions: number;
  session_days: number;
  per_day: number | null;
  median: number | null;
  minutes: number;
  longest: { minutes: number; date: string; title: string } | null;
};

const run = loadCalcs('calcs.js', 'features/page-turns.js');

const grid = Array.from({ length: 7 }, (_, d) =>
  Array.from({ length: 24 }, (_, h) => (d === 0 && h === 21 ? 90 : 0)),
);
const session = (start: string, minutes: number) => ({ book_id: 'a', start, minutes });
const file = {
  coverage: { since: '2026-11-02', until: '2026-11-09', sessions_since: '2026-11-02' },
  session_gap_minutes: 10,
  recent_days: 14,
  time_of_day: grid,
  sessions: [
    session('2026-11-02T08:00:00', 10),
    session('2026-11-02T21:00:00', 40),
    session('2026-11-09T21:00:00', 30),
    session('2026-11-09T22:00:00', 20),
  ],
  books: [{ book_id: 'a', since: '2026-11-02' }],
};
const books = [{ id: 'a', title: 'Alpha' }];
const overview = (sessions: unknown) => run('sessions_overview', { sessions, books }) as Overview[];

describe('page-level views', () => {
  it('counts sessions per day with one, the median length and the longest', () => {
    const [o] = overview(file);
    expect(o).toMatchObject({
      since: '2026-11-02',
      sessions: 4,
      session_days: 2,
      per_day: 2,
      median: 25,
      minutes: 90,
      longest: { minutes: 40, date: '2026-11-02', title: 'Alpha' },
    });
  });

  it('keeps the time of day when a visitor gets no sessions', () => {
    const [o] = overview({ ...file, sessions: [] });
    expect(o).toMatchObject({ sessions: 0, per_day: null, median: null, longest: null });
    expect(o.minutes).toBe(90);
  });

  it('has nothing without page data, or without the file', () => {
    const none = { ...file, coverage: { since: null }, sessions: [], books: [] };
    for (const sessions of [[], none]) expect(overview(sessions)).toEqual([]);
    expect(run('page_books', { sessions: [] })).toEqual([]);
  });

  it('gives each book the days its pace is taken over', () => {
    expect(run('page_books', { sessions: file })).toEqual([
      { book_id: 'a', since: '2026-11-02', recent_days: 14 },
    ]);
  });
});
