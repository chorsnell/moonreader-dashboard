import { loadCalcs } from '../support/feature-calcs';

type Stat = { stat: string; value: number | null };

const run = loadCalcs('calcs.js', 'features/friend-profiles.js', 'features/friends-boards.js');
const day = (date: string, minutes: number, words: number) => ({
  date,
  book_id: 'a',
  minutes,
  words,
});

describe('leaderboard stats', () => {
  it('counts the last 12 months up to the latest day', () => {
    const rows = run<Stat>('leaderboard_stats', {
      reads: [
        { book_id: 'a', finished: true, end: '2026-03-03' },
        { book_id: 'b', finished: true, end: '2025-01-01' }, // over a year before
        { book_id: 'c', finished: false, end: '2026-03-01' },
      ],
      daily: [
        day('2025-01-01', 600, 120000), // over a year before
        day('2026-03-01', 30, 9000),
        day('2026-03-02', 30, 9000),
        day('2026-03-03', 60, 18000),
        day('2026-03-05', 0, 0),
        day('2026-03-06', 60, 18000),
      ],
    });
    expect(Object.fromEntries(rows.map((r) => [r.stat, r.value]))).toEqual({
      books: 1,
      hours: 3,
      words: 54000,
      streak: 3,
      speed: 300,
      days: 4,
    });
  });

  it('leaves out what needs days when there are none', () => {
    const rows = run<Stat>('leaderboard_stats', {
      reads: [{ book_id: 'a', finished: true, end: new Date().toISOString().slice(0, 10) }],
      daily: [],
    });
    expect(rows.find((r) => r.stat === 'books')?.value).toBe(1);
    expect(rows.filter((r) => r.value === null).map((r) => r.stat)).toEqual([
      'hours',
      'words',
      'streak',
      'speed',
      'days',
    ]);
  });
});
