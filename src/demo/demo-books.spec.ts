import { parseIsbn } from '../metadata/isbn';
import { BOOKS, ISBN } from './demo-books';

describe('demo books', () => {
  it('only gives valid ISBNs to books in the demo', () => {
    const titles = new Set(BOOKS.map(([title]) => title));
    for (const [title, isbn] of Object.entries(ISBN)) {
      expect(titles.has(title) ? title : `not a demo book: ${title}`).toBe(title);
      expect(parseIsbn(isbn) ? isbn : `invalid: ${isbn}`).toBe(isbn);
    }
  });
});
