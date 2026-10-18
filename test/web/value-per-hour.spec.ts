import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/money.js', 'features/value-per-hour.js');

type Row = { kind: string; name: string; per_hour: number | null; other_currency: number };

const tvYear = (service: string, year: number, cost: number, hours: number, currency = 'GBP') => ({
  service,
  year,
  currency,
  months: 12,
  cost,
  hours,
  idle: 0,
  per_hour: hours ? Math.round((cost / hours) * 100) / 100 : null,
});
const prices = {
  currency: 'GBP',
  budgets: {},
  benchmarks: [
    { name: 'Cinema', per_hour: 6 },
    { name: 'Streaming', per_hour: 0.4 },
  ],
  subscriptions: [],
  books: [],
};
const moneyBook = (per_hour: number | null, price = 5) => ({ price, per_hour });
const summary = [{ per_hour_all: 0.8, lifetime: 80, hours: 100 }];

describe('streaming against books', () => {
  it('puts each subscription, your books and the benchmarks in one list, cheapest first', () => {
    const rows = run<Row>('screen_vs_books', {
      tv_cost: [tvYear('Netflix', 2024, 120, 40), tvYear('Netflix', 2025, 120, 20)],
      money_books: [moneyBook(0.5), moneyBook(1), moneyBook(2), moneyBook(null), moneyBook(3, 0)],
      money_summary: summary,
      prices,
    });
    expect(rows.map((r) => [r.kind, r.name, r.per_hour])).toEqual([
      ['benchmark', 'Streaming', 0.4],
      ['books_all', 'All your reading', 0.8],
      ['books', 'A paid book (median)', 1],
      // 240 over 60 hours, not the average of the two years' rates
      ['streaming', 'Netflix', 4],
      ['benchmark', 'Cinema', 6],
    ]);
    expect(rows.find((r) => r.kind === 'streaming')).toMatchObject({
      latest_year: 2025,
      latest_per_hour: 6,
      from: 2024,
      to: 2025,
    });
  });

  it('leaves out subscriptions in another currency, and is empty without both sides', () => {
    const rows = run<Row>('screen_vs_books', {
      tv_cost: [tvYear('Netflix', 2025, 120, 40), tvYear('Hulu', 2025, 100, 10, 'USD')],
      money_books: [moneyBook(1)],
      money_summary: summary,
      prices,
    });
    expect(rows.some((r) => r.name === 'Hulu')).toBe(false);
    expect(rows[0].other_currency).toBe(1);
    // money hidden: prices.json loads as []
    expect(
      run('screen_vs_books', {
        tv_cost: [tvYear('Netflix', 2025, 120, 40)],
        money_books: [],
        money_summary: [],
        prices: [],
      }),
    ).toEqual([]);
    // no subscriptions
    expect(
      run('screen_vs_books', {
        tv_cost: [],
        money_books: [moneyBook(1)],
        money_summary: summary,
        prices,
      }),
    ).toEqual([]);
    // subscriptions but no book prices
    expect(
      run('screen_vs_books', {
        tv_cost: [tvYear('Netflix', 2025, 120, 40)],
        money_books: [],
        money_summary: [],
        prices,
      }),
    ).toEqual([]);
  });
});
