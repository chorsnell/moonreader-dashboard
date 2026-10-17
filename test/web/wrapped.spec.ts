import { loadCalcs } from '../support/feature-calcs';

type Year = {
  year: number;
  partial: boolean;
  finished: number;
  rereads: number;
  minutes: number;
  words: number;
  days_read: number;
  year_days: number;
  peak_month: { month: number; minutes: number } | null;
  quiet_month: { month: number } | null;
  book_month: { month: number; finished: number } | null;
  biggest_day: { date: string; minutes: number; books: { book_id: string }[] } | null;
  longest_streak: { start: string; end: string; days: number } | null;
  fastest: { book_id: string; wpm: number } | null;
  longest: { book_id: string; hours: number } | null;
  new_authors: { author: string; finished: number }[];
  genres: { genre: string; finished: number }[];
  records_broken: { id: string; times: number }[];
  comparison: { id: string; times: number } | null;
  prev: { year: number; finished: number; minutes: number } | null;
};

const run = loadCalcs(
  'calcs.js',
  'features/odometer.js',
  'features/records.js',
  'features/wrapped.js',
);

const book = (id: string, author: string, genre: string) => ({
  id,
  title: id.toUpperCase(),
  author,
  genre,
});
const books = [
  book('a', 'Old Friend', 'Classics'),
  book('b', 'Newcomer', 'Mystery'),
  book('c', 'Newcomer', 'Mystery'),
];
const read = (
  book_id: string,
  author: string,
  start: string,
  end: string,
  read_no = 1,
  hours = 5,
) => ({
  read_id: `${book_id}#${read_no}`,
  book_id,
  title: book_id.toUpperCase(),
  author,
  genre: books.find((b) => b.id === book_id)!.genre,
  read_no,
  start,
  end,
  hours,
  days_read: 3,
  finished: true,
});
const reads = [
  read('a', 'Old Friend', '2024-03-01', '2024-03-20'),
  read('a', 'Old Friend', '2025-02-01', '2025-02-10', 2, 4),
  read('b', 'Newcomer', '2025-05-01', '2025-05-03', 1, 3),
  read('c', 'Newcomer', '2025-05-10', '2025-05-12', 1, 6),
];
const day = (date: string, book_id: string, minutes: number, words: number) => ({
  date,
  book_id,
  title: book_id.toUpperCase(),
  minutes,
  words,
});
const daily = [
  day('2024-03-01', 'a', 60, 15_000),
  day('2025-02-01', 'a', 60, 15_000),
  day('2025-02-02', 'a', 30, 7_500),
  day('2025-05-01', 'b', 120, 36_000),
  day('2025-05-02', 'b', 90, 27_000),
  day('2025-05-02', 'c', 40, 8_000),
  day('2025-05-03', 'b', 60, 18_000),
  day('2025-06-01', 'c', 10, 2_500),
];

const years = Object.fromEntries(
  run<Year>('wrapped', { books, reads, daily }).map((y) => [y.year, y]),
);
const y = years[2025];

describe('Wrapped', () => {
  it('has a row per year, the last one partial', () => {
    expect(Object.keys(years)).toEqual(['2024', '2025']);
    expect(years[2024].partial).toBe(false);
    // the backup ends 1 Jun 2025
    expect(y).toMatchObject({ partial: true, year_days: 152 });
  });

  it('adds up the year', () => {
    expect(y).toMatchObject({
      finished: 3,
      rereads: 1,
      minutes: 410,
      words: 114_000,
      days_read: 6,
    });
    expect(y.prev).toEqual({ year: 2024, finished: 1, minutes: 60 });
  });

  it('finds the peak month, the best month for books and the biggest day', () => {
    expect(y.peak_month).toMatchObject({ month: 5, minutes: 310 });
    expect(y.book_month).toMatchObject({ month: 5, finished: 2 });
    // 2 May: 90 + 40 minutes over two books
    expect(y.biggest_day).toMatchObject({ date: '2025-05-02', minutes: 130 });
    expect(y.biggest_day!.books.map((b) => b.book_id)).toEqual(['b', 'c']);
    expect(y.longest_streak).toEqual({ start: '2025-05-01', end: '2025-05-03', days: 3 });
  });

  it('names the fastest and longest reads', () => {
    // b: 81,000 words in 270 minutes
    expect(y.fastest).toMatchObject({ book_id: 'b', wpm: 300 });
    expect(y.longest).toMatchObject({ book_id: 'c', hours: 6 });
  });

  it('counts authors first read this year', () => {
    expect(y.new_authors).toEqual([{ author: 'Newcomer', finished: 2 }]);
    expect(years[2024].new_authors.map((a) => a.author)).toEqual(['Old Friend']);
    expect(y.genres[0]).toEqual({ genre: 'Mystery', finished: 2 });
  });

  it('lists records broken that year and compares the words', () => {
    expect(y.records_broken.map((r) => r.id)).toEqual(
      expect.arrayContaining(['biggest_day', 'longest_streak']),
    );
    expect(years[2024].records_broken).toEqual([]);
    // 114,000 words: just over one Hobbit
    expect(y.comparison).toMatchObject({ id: 'hobbit' });
    expect(y.comparison!.times).toBeCloseTo(114_000 / 95_356);
  });
});
