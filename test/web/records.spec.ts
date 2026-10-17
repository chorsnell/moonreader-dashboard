import { loadCalcs } from '../support/feature-calcs';

type Rec = {
  id: string;
  value: number;
  date: string;
  start: string;
  end: string;
  prev_value: number | null;
  times_broken: number;
  recent: boolean;
  history: { date: string; value: number }[];
  book_id: string | null;
};

const run = loadCalcs('calcs.js', 'features/records.js');
const day = (date: string, minutes: number, words: number, book_id = 'a') => ({
  date,
  book_id,
  minutes,
  words,
});
const read = (book_id: string, start: string, end: string) => ({
  read_id: book_id + '#1',
  book_id,
  title: book_id.toUpperCase(),
  start,
  end,
  finished: true,
});

function records(daily: object[], reads: object[] = []) {
  return Object.fromEntries(run<Rec>('records', { daily, reads }).map((r) => [r.id, r]));
}

describe('personal records', () => {
  const daily = [
    day('2025-01-01', 60, 20_000),
    day('2025-01-02', 30, 10_000),
    day('2025-01-02', 40, 12_000, 'b'),
    day('2025-01-03', 20, 6_000),
    day('2025-01-10', 90, 30_000),
    day('2025-03-01', 10, 3_000),
    day('2025-03-02', 10, 3_000),
    day('2025-03-03', 10, 3_000),
    day('2025-03-04', 10, 3_000),
    day('2025-03-20', 120, 40_000, 'b'),
  ];
  const r = records(daily, [
    read('a', '2025-01-01', '2025-01-10'),
    read('b', '2025-01-02', '2025-03-20'),
  ]);

  it('finds the biggest day across books, with each time it was broken', () => {
    expect(r.biggest_day).toMatchObject({
      value: 120,
      date: '2025-03-20',
      prev_value: 90,
      times_broken: 3,
    });
    expect(r.biggest_day.history.map((h) => h.value)).toEqual([60, 70, 90, 120]);
  });

  it('counts a streak once it beats the last', () => {
    expect(r.longest_streak).toMatchObject({
      value: 4,
      start: '2025-03-01',
      end: '2025-03-04',
      prev_value: 3,
    });
  });

  it('finds the fewest days holding 100,000 words', () => {
    // 130,000 words in all; the last 100,000 of them run from 2 Jan to 20 Mar
    expect(r.fastest_100k).toMatchObject({ value: 78, start: '2025-01-02', end: '2025-03-20' });
    expect(r.fastest_1m).toBeUndefined();
    const big = records([
      day('2025-01-01', 60, 60_000),
      day('2025-01-05', 60, 50_000),
      day('2025-02-01', 60, 70_000),
      day('2025-02-02', 60, 40_000),
    ]);
    expect(big.fastest_100k).toMatchObject({
      value: 2,
      start: '2025-02-01',
      end: '2025-02-02',
      prev_value: 5,
    });
  });

  it('buckets weeks from Monday and months by calendar month', () => {
    // 1–3 Jan 2025 is Wed–Fri: 150 minutes = 2.5 h
    expect(r.best_week).toMatchObject({ value: 2.5, start: '2024-12-30', end: '2025-01-05' });
    expect(r.best_month).toMatchObject({ value: 4, start: '2025-01-01' });
    expect(r.most_books_month).toMatchObject({
      value: 1,
      start: '2025-01-01',
      times_broken: 0,
      recent: false,
    });
  });

  it('picks the fastest finished read and flags recent records', () => {
    // a: 66,000 words in 200 minutes; b: 52,000 in 160, slower, so not a record
    expect(r.fastest_book).toMatchObject({
      book_id: 'a',
      value: 330,
      prev_value: null,
      times_broken: 0,
    });
    // the backup ends 20 Mar: records broken in the 30 days before are recent
    expect(r.biggest_day.recent).toBe(true);
    expect(r.longest_streak.recent).toBe(true);
    // …but a first-ever best isn't a broken record
    expect(r.best_month.recent).toBe(false);
  });
});
