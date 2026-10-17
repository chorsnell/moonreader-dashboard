import { parseBundle } from '../friends/share';
import { BOOKS } from './demo-books';
import { FRIEND_PLANS, simulateFriend } from './demo-friends';

const DAY_MS = 86_400_000;
const first = Date.parse('2022-09-15') / DAY_MS;
const last = Date.parse('2026-10-10') / DAY_MS;
const owner = {
  books: BOOKS.map(([title, author, genre, subgenre, series, seriesNo, words]) => ({
    title,
    author,
    genre,
    subgenre,
    series,
    series_no: seriesNo,
    words,
    progress: 100,
    isbn13: null,
  })),
  reads: [
    { title: 'The War of the Worlds', start: '2026-09-01', end: '2026-09-05', finished: true },
    { title: 'The Count of Monte Cristo', start: '2026-09-18', end: '2026-10-10', finished: false },
  ],
};

describe('demo friends', () => {
  it.each(FRIEND_PLANS)(
    '$name has books in common, books of their own, and reads with you',
    (plan) => {
      const b = parseBundle(
        simulateFriend(plan, owner, first, last, {
          buddy: 'The War of the Worlds',
          current: 'The Count of Monte Cristo',
        }),
      );
      const mine = new Set(BOOKS.map((x) => x[0]));
      expect(b.books.filter((x) => mine.has(String(x.title))).length).toBeGreaterThan(5);
      expect(b.books.filter((x) => !mine.has(String(x.title))).length).toBeGreaterThan(3);
      const current = b.reads.find((r) => r.title === 'The Count of Monte Cristo');
      expect(current?.finished).toBe(false);
      expect(String(current?.start) >= '2026-09-18').toBe(true);
      expect(b.daily.every((d) => String(d.date) <= '2026-10-10')).toBe(true);
    },
  );
});
