import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/money.js');

const book = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  title: id,
  author: 'A',
  genre: 'G',
  subgenre: 'S',
  series: null,
  series_no: null,
  status: 'finished',
  progress: 100,
  hours: 10,
  words: 100_000,
  times_read: 1,
  ...o,
});
const price = (book_id: string, o: Record<string, unknown> = {}) => ({
  book_id,
  title: book_id,
  author: 'A',
  price: 5,
  list_price: null,
  acquisition: 'bought',
  date: '2025-03-10',
  subscription: null,
  ...o,
});
const books = [
  book('a'),
  book('b', { hours: 2, times_read: 2, series: 'S1', series_no: 1 }),
  book('c', { series: 'S1', series_no: 3, status: 'in_progress' }),
];
const reads = [{ book_id: 'b', read_no: 1, hours: 1 }];
const daily = [{ date: '2025-06-30', book_id: 'a', minutes: 10, words: 100 }];
const prices = {
  currency: 'GBP',
  budgets: { 2025: 50 },
  benchmarks: [],
  subscriptions: [{ name: 'KU', monthly_fee: 10, start: '2025-04', end: '2025-05' }],
  books: [
    price('a'),
    price('b', { price: 4, date: '2025-04-02' }),
    price('c', { price: 0, acquisition: 'subscription', list_price: 3 }),
    price('unread', { price: 2 }),
    price('nope', { price: null }),
  ],
};
const input = { books, reads, daily, prices };

describe('money calcs', () => {
  it('has nothing without prices', () => {
    expect(run('money_books', { ...input, prices: [] })).toEqual([]);
    expect(run('money_summary', { ...input, prices: [] })).toEqual([]);
  });

  it('joins prices to books, with cost per hour and per 10k words', () => {
    const rows = run('money_books', input);
    expect(rows.map((r) => r.book_id)).toEqual(['a', 'b', 'c', 'unread']); // unconverted left out
    expect(rows[0]).toMatchObject({ per_hour: 0.5, per_10k: 0.5, opened: true });
    // a re-read halves the cost per hour of the first read
    expect(rows[1]).toMatchObject({ per_hour: 2, first_per_hour: 4 });
    expect(rows[2].per_hour).toBeNull(); // free to you
    expect(rows[3]).toMatchObject({ opened: false, status: 'not_opened' });
  });

  it('adds up spending per month, with subscription fees', () => {
    const months = run('money_months', input);
    expect(months.map((m) => [m.month, m.books, m.subscriptions, m.cumulative])).toEqual([
      ['2025-03', 7, 0, 7],
      ['2025-04', 4, 10, 21],
      ['2025-05', 0, 10, 31],
      ['2025-06', 0, 0, 31],
    ]);
    const [year] = run('money_years', input);
    expect(year).toMatchObject({ year: 2025, total: 31, books: 11, subscriptions: 20, budget: 50 });
  });

  it('splits by how books were got', () => {
    const acq = run('money_acquisition', input);
    expect(acq.find((r) => r.acquisition === 'subscription')).toMatchObject({
      books: 1,
      spent: 20,
      list_value: 3,
    });
    expect(acq.find((r) => r.acquisition === 'bought')).toMatchObject({ books: 3, spent: 11 });
  });

  it('ranks groups and estimates the cost to finish a series', () => {
    const groups = run('money_groups', input);
    expect(groups.find((g) => g.kind === 'author')).toMatchObject({ spent: 11, books: 4 });
    const [s] = run('money_series', input);
    expect(s).toMatchObject({ series: 'S1', spent: 4, missing: 1, to_buy: 2, unfinished_spent: 0 });
  });

  it('sums it all up', () => {
    const [s] = run('money_summary', input);
    expect(s).toMatchObject({ lifetime: 31, year: 2025, this_year: 31, unopened: 1 });
  });
});
