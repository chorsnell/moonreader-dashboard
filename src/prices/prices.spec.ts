import {
  applyImport,
  emptyPrices,
  missingRates,
  parseCsv,
  parseDate,
  parseMoney,
  previewImport,
  PriceError,
  servedPrices,
  toCsv,
  toPriceEntry,
  toSettings,
  toSubscriptions,
} from './prices';

const books = [
  { id: 'dracula', title: 'Dracula', author: 'Bram Stoker', words: 160000 },
  { id: 'the-time-machine', title: 'The Time Machine', author: 'H. G. Wells', words: 32000 },
  { id: 'emma', title: 'Emma', author: 'Jane Austen', words: 160000, isbn: '978-0-14-143958-7' },
  { id: 'persuasion', title: 'Persuasion', author: 'Jane Austen', words: 80000 },
];

describe('parsing loose values', () => {
  it('reads prices with symbols, codes and decimal commas', () => {
    expect(parseMoney('£4.99')).toEqual({ amount: 4.99, currency: 'GBP' });
    expect(parseMoney('4,99 €')).toEqual({ amount: 4.99, currency: 'EUR' });
    expect(parseMoney('USD 1,299.00')).toEqual({ amount: 1299, currency: 'USD' });
    expect(parseMoney('$0')).toEqual({ amount: 0, currency: 'USD' });
    expect(parseMoney('')).toEqual({ amount: null, currency: null });
    expect(parseMoney('free').amount).toBeNull();
  });

  it('reads dates in British and ISO order', () => {
    expect(parseDate('2024-03-05')).toBe('2024-03-05');
    expect(parseDate('2024-03-05T10:00:00Z')).toBe('2024-03-05');
    expect(parseDate('05/03/2024')).toBe('2024-03-05');
    expect(parseDate('5 Mar 2024')).toBe('2024-03-05');
    expect(parseDate('March 5, 2024')).toBe('2024-03-05');
    expect(parseDate('31/02/2024')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });

  it('splits CSV with quotes and other separators', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
    expect(parseCsv('title;price\nEmma;1,99')).toEqual([
      ['title', 'price'],
      ['Emma', '1,99'],
    ]);
  });
});

describe('checking entries', () => {
  it('fills in how a book was got from its price', () => {
    expect(toPriceEntry({ title: 'Emma', price: 0 }).acquisition).toBe('free');
    expect(toPriceEntry({ title: 'Emma', price: '2.50' })).toMatchObject({
      price: 2.5,
      acquisition: 'bought',
    });
    expect(toPriceEntry({ title: 'Emma', acquisition: 'Kindle Unlimited' }).acquisition).toBe(
      'subscription',
    );
  });

  it('refuses what makes no sense', () => {
    expect(() => toPriceEntry({ price: 1 })).toThrow(PriceError);
    expect(() => toPriceEntry({ title: 'x', price: -1 })).toThrow(PriceError);
    expect(() => toPriceEntry({ title: 'x', currency: 'pounds' })).toThrow(PriceError);
    expect(() => toPriceEntry({ title: 'x', acquisition: 'stolen' })).toThrow(PriceError);
    expect(() => toPriceEntry({ title: 'x', date: 'yesterday' })).toThrow(PriceError);
  });

  it('checks settings and subscriptions', () => {
    const s = toSettings({
      home_currency: 'gbp',
      rates: { usd: 0.8, GBP: 1 },
      budgets: { 2026: 50 },
    });
    expect(s).toMatchObject({ home_currency: 'GBP', rates: { USD: 0.8 }, budgets: { 2026: 50 } });
    expect(s.benchmarks.length).toBeGreaterThan(0);
    expect(() => toSettings({ rates: { USD: 0 } })).toThrow(PriceError);
    expect(
      toSubscriptions([{ name: 'KU', monthly_fee: 9.49, start: '2025-01-15', end: '' }]),
    ).toEqual([{ name: 'KU', monthly_fee: 9.49, currency: 'GBP', start: '2025-01', end: null }]);
    expect(() =>
      toSubscriptions([{ name: 'KU', monthly_fee: 1, start: '2025-05', end: '2025-01' }]),
    ).toThrow(PriceError);
  });
});

describe('the served copy', () => {
  it('converts to the home currency and leaves the notes out', () => {
    const file = emptyPrices();
    file.settings.rates = { USD: 0.8 };
    file.books.emma = toPriceEntry({ title: 'Emma', price: 10, currency: 'USD', notes: 'secret' });
    file.books.dracula = toPriceEntry({ title: 'Dracula', price: 3, currency: 'EUR' });
    file.subscriptions = toSubscriptions([
      { name: 'KU', monthly_fee: 10, currency: 'USD', start: '2025-01' },
    ]);
    const served = servedPrices(file);
    expect(served.currency).toBe('GBP');
    expect(served.books.find((b) => b.book_id === 'emma')).toMatchObject({
      price: 8,
      paid: 10,
      paid_currency: 'USD',
    });
    expect(JSON.stringify(served)).not.toContain('secret');
    // no rate for EUR: left unconverted rather than guessed
    expect(served.books.find((b) => b.book_id === 'dracula')?.price).toBeNull();
    expect(missingRates(file)).toEqual(['EUR']);
    expect(served.subscriptions[0].monthly_fee).toBe(8);
  });
});

describe('CSV import', () => {
  it('matches by ISBN, title and author, or title alone', () => {
    const csv = [
      'Product Name,Author,ISBN,Order Date,Total',
      'Some other edition,,9780141439587,01/02/2024,£1.99',
      '"Dracula: A Novel","Stoker, Bram",,2024-02-03,£0.99',
      'time machine,,,,0',
      'Unknown Book,Nobody,,,£5',
      'Persuasion,Jane Austen,,,lots',
    ].join('\n');
    const r = previewImport(csv, books, emptyPrices());
    expect(r.rows.map((x) => [x.status, x.book_id, x.matched_by])).toEqual([
      ['matched', 'emma', 'isbn'],
      ['matched', 'dracula', 'title_author'],
      ['matched', 'the-time-machine', 'title'],
      ['unmatched', null, null],
      ['error', null, null],
    ]);
    expect(r.rows[0].entry).toMatchObject({ price: 1.99, currency: 'GBP', date: '2024-02-01' });
    expect(r.rows[2].entry?.acquisition).toBe('free');
    expect([r.matched, r.unmatched, r.errors]).toEqual([3, 1, 1]);
  });

  it('needs a title column', () => {
    expect(() => previewImport('price\n1', books, emptyPrices())).toThrow(PriceError);
  });

  it('splits a bundle by word count', () => {
    const csv =
      'title,author,price,bundle\nEmma,Austen,9,Austen set\nPersuasion,Austen,,Austen set';
    const r = previewImport(csv, books, emptyPrices());
    expect(r.rows.map((x) => x.entry?.price)).toEqual([6, 3]);
  });

  it('saves matched rows and, if asked, adds the rest as never opened', () => {
    const csv = 'title,author,price\nEmma,Jane Austen,2\nUnread Tome,Someone,7';
    const file = emptyPrices();
    const preview = previewImport(csv, books, file);
    const once = applyImport(file, preview, false);
    expect(Object.keys(once.file.books)).toEqual(['emma']);
    const both = applyImport(file, preview, true);
    expect(both).toMatchObject({ saved: 1, added: 1 });
    expect(both.file.books['unread-tome'].price).toBe(7);
    // importing again finds the unopened book's earlier entry
    const again = previewImport(csv, books, both.file);
    expect(again.rows[1]).toMatchObject({
      status: 'matched',
      matched_by: 'price_entry',
      replaces: true,
    });
  });

  it('exports what it imports', () => {
    const file = emptyPrices();
    file.books.emma = toPriceEntry({
      title: 'Emma',
      author: 'Jane Austen',
      price: 2,
      notes: 'a, b',
    });
    const back = previewImport(toCsv(file), books, emptyPrices());
    expect(back.rows[0]).toMatchObject({ status: 'matched', book_id: 'emma' });
    expect(back.rows[0].entry).toMatchObject({ price: 2, notes: 'a, b' });
  });
});
