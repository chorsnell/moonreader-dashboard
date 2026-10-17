import { parseIsbn } from '../metadata/isbn';
import { BOOKS, ISBN } from './demo-books';
import { AUTHORS, PUBLISHED } from './demo-metadata';

describe('demo books', () => {
  it('only gives valid ISBNs to books in the demo', () => {
    const titles = new Set(BOOKS.map(([title]) => title));
    for (const [title, isbn] of Object.entries(ISBN)) {
      expect(titles.has(title) ? title : `not a demo book: ${title}`).toBe(title);
      expect(parseIsbn(isbn) ? isbn : `invalid: ${isbn}`).toBe(isbn);
    }
  });

  it('has metadata for every book and author', () => {
    expect(BOOKS.map(([t]) => t).filter((t) => !PUBLISHED[t])).toEqual([]);
    expect(BOOKS.map(([, a]) => a).filter((a) => !AUTHORS[a])).toEqual([]);
    expect(Object.keys(PUBLISHED)).toHaveLength(BOOKS.length);
  });
});
