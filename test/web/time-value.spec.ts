import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/money.js', 'features/time-value.js');

const books = [
  {
    id: 'a',
    title: 'A',
    author: 'X',
    genre: 'G',
    series: 'S',
    hours: 10,
    words: 1,
    first_read: '2024-01-01',
  },
  {
    id: 'b',
    title: 'B',
    author: 'X',
    genre: 'H',
    series: null,
    hours: 2.5,
    words: 1,
    first_read: '2025-01-01',
  },
  {
    id: 'c',
    title: 'C',
    author: 'Y',
    genre: 'G',
    series: null,
    hours: 0,
    words: 0,
    first_read: null,
  },
];
const daily = [
  { date: '2024-05-01', book_id: 'a', minutes: 90 },
  { date: '2025-05-01', book_id: 'a', minutes: 30 },
  { date: '2025-05-02', book_id: 'b', minutes: 60 },
];
const reads: unknown[] = [];

describe('time value calcs', () => {
  it('works without prices', () => {
    const rows = run('time_books', { books, reads, daily, prices: [] });
    expect(rows.map((r) => [r.book_id, r.hours, r.price])).toEqual([
      ['a', 10, null],
      ['b', 2.5, null],
    ]);
  });

  it('adds the price when there is one', () => {
    const prices = {
      currency: 'GBP',
      budgets: {},
      benchmarks: [],
      subscriptions: [],
      books: [{ book_id: 'a', title: 'A', author: 'X', price: 4, acquisition: 'bought' }],
    };
    const rows = run('time_books', { books, reads, daily, prices });
    expect(rows.find((r) => r.book_id === 'a')?.price).toBe(4);
  });

  it('adds up hours per year and per author, genre and series', () => {
    expect(run('time_years', { daily })).toEqual([
      { year: 2024, hours: 1.5 },
      { year: 2025, hours: 1.5 },
    ]);
    const groups = run('time_groups', { books });
    expect(groups.filter((g) => g.kind === 'author')).toEqual([
      { kind: 'author', name: 'X', author: 'X', hours: 12.5, books: 2 },
    ]);
    expect(groups.filter((g) => g.kind === 'series').map((g) => g.name)).toEqual(['S']);
  });
});
