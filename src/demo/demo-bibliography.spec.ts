import { buildBibliography } from '../bibliography/build';
import { BOOKS, UNOPENED } from './demo-books';
import { demoBibliography } from './demo-bibliography';

describe('demo bibliography', () => {
  const file = demoBibliography('2026-10-24');

  it('only has the demo’s own authors', () => {
    const authors = new Set(BOOKS.map(([, author]) => author.toLowerCase()));
    expect(Object.keys(file.authors).filter((a) => !authors.has(a))).toEqual([]);
  });

  it('gives rows by author and by series, some on the pile, none already read', () => {
    const books = BOOKS.map(([title, author, , , series]) => ({
      title,
      author,
      series,
      status: 'finished',
      hours: 5,
    }));
    const pile = UNOPENED.map(([title, author]) => ({ title, author }));
    const rows = buildBibliography(books, pile, file);
    const read = new Set(BOOKS.map(([title]) => title));
    expect(rows.filter((r) => read.has(r.title))).toEqual([]);
    expect(rows.some((r) => r.why.includes('series'))).toBe(true);
    expect(rows.some((r) => !r.series)).toBe(true);
    expect(rows.filter((r) => r.on_pile).map((r) => r.title)).toEqual([
      'The Return of Sherlock Holmes',
      'Thuvia, Maid of Mars',
      'Dorothy and the Wizard in Oz',
    ]);
  });
});
