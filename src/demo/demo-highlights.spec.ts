import { BOOKS } from './demo-books';
import { QUOTES, simulateHighlights } from './demo-highlights';
import { Random } from './random';
import { simulate } from './simulate';

describe('demo highlights', () => {
  it('quotes only books in the demo, by their own authors', () => {
    const books = new Set(BOOKS.map(([title, author]) => `${title}|${author}`));
    for (const [title, [author]] of Object.entries(QUOTES)) {
      expect(books).toContain(`${title}|${author}`);
    }
  });

  it('highlights a passage on a day the book was read', () => {
    const { log } = simulate(new Random(7));
    const notes = simulateHighlights(log, 7);
    expect(notes.size).toBeGreaterThan(20);
    for (const [file, list] of notes) {
      const days = log.get(file)!;
      for (const n of list) expect(days.some((d) => d.day === n.day)).toBe(true);
    }
  });
});
