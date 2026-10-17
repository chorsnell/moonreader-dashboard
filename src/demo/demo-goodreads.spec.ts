import { parseReadingExport } from '../imports/goodreads';
import { demoGoodreadsCsv } from './demo-goodreads';
import { Random } from './random';
import { simulate } from './simulate';

describe('demoGoodreadsCsv', () => {
  it('makes a Goodreads export with ratings and a few books read on paper', () => {
    const { log, days } = simulate(new Random(7));
    const { source, books } = parseReadingExport(demoGoodreadsCsv(log, 20000, 20000 + days, 7));
    expect(source).toBe('goodreads');
    expect(books.filter((b) => b.rating).length).toBeGreaterThan(30);
    expect(books.some((b) => b.title === 'Northanger Abbey' && b.reads.length === 1)).toBe(true);
    expect(books.filter((b) => b.shelf === 'to-read')).toHaveLength(1);
    expect(books.every((b) => !b.rating || (b.rating >= 1 && b.rating <= 5))).toBe(true);
  });
});
