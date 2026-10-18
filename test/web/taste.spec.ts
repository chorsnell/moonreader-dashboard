import { loadCalcs } from '../support/feature-calcs';

type Match = {
  score: number;
  parts: { genre: number; author: number; books: number; ratings: number | null };
  rated: number;
  star_gap: number | null;
  authors: { both: { author: string }[]; mine: { author: string }[]; theirs: { author: string }[] };
  books: {
    book_id: string;
    mine: { days: number; wpm: number | null } | null;
    theirs: { days: number; wpm: number | null } | null;
  }[];
};

const run = loadCalcs('calcs.js', 'features/friend-profiles.js', 'features/friends-taste.js');
const book = (
  id: string,
  title: string,
  author: string,
  genre: string,
  isbn13: string | null = null,
) => ({
  id,
  title,
  author,
  genre,
  isbn13,
  status: 'finished',
});
const read = (book_id: string, genre: string, start: string, end: string) => ({
  read_id: `${book_id}#1`,
  book_id,
  genre,
  start,
  end,
  finished: true,
  progress: 100,
});
const day = (book_id: string, date: string, minutes: number, words: number) => ({
  book_id,
  date,
  minutes,
  words,
});

const mine = {
  books: [
    { ...book('emma', 'Emma', 'Jane Austen', 'Classics', '9780141439587'), rating: 5 },
    book('dracula', 'Dracula', 'Bram Stoker', 'Horror'),
    book('walden', 'Walden', 'Henry David Thoreau', 'Non-fiction'),
  ],
  reads: [
    read('emma', 'Classics', '2026-01-01', '2026-01-10'),
    read('dracula', 'Horror', '2026-02-01', '2026-02-03'),
    read('walden', 'Non-fiction', '2026-03-01', '2026-03-20'),
  ],
  daily: [day('dracula', '2026-02-01', 60, 15000), day('dracula', '2026-02-03', 60, 15000)],
};

describe('taste match', () => {
  it('matches books by ISBN or by title and author, and compares the reads', () => {
    const [m] = run<Match>('taste_match', {
      ...mine,
      friend_books: [
        // another edition's title, the same ISBN
        book(
          'emma-penguin',
          'Emma (Penguin Classics)',
          'J. Austen',
          'Classics',
          '978-0-14-143958-7',
        ),
        // no ISBN: the same title and author once punctuation and case are ignored
        book('dracula', 'DRACULA', 'Bram  Stoker', 'Horror'),
        book('carmilla', 'Carmilla', 'Sheridan Le Fanu', 'Horror'),
      ],
      friend_reads: [
        read('emma-penguin', 'Classics', '2026-01-01', '2026-01-04'),
        read('dracula', 'Horror', '2026-02-01', '2026-02-01'),
        read('carmilla', 'Horror', '2026-04-01', '2026-04-02'),
      ],
      friend_daily: [day('dracula', '2026-02-01', 50, 20000)],
    });
    expect(m.books.map((b) => b.book_id).sort()).toEqual(['dracula', 'emma']);
    const d = m.books.find((b) => b.book_id === 'dracula')!;
    expect(d.mine).toMatchObject({ days: 3, wpm: 250 });
    expect(d.theirs).toMatchObject({ days: 1, wpm: 400 });
    expect(m.books.find((b) => b.book_id === 'emma')).toMatchObject({
      my_rating: 5,
      their_rating: null,
    });
    expect(m.authors.both.map((a) => a.author)).toEqual(['Bram Stoker']);
    expect(m.authors.theirs.map((a) => a.author).sort()).toEqual(['J. Austen', 'Sheridan Le Fanu']);
    expect(m.score).toBeGreaterThan(0);
    expect(m.score).toBeLessThanOrEqual(100);
  });

  it('scores the same reading 100 and nothing in common 0', () => {
    const same = run<Match>('taste_match', {
      ...mine,
      friend_books: mine.books,
      friend_reads: mine.reads,
      friend_daily: mine.daily,
    })[0];
    expect(same.score).toBe(100);
    const none = run<Match>('taste_match', {
      ...mine,
      friend_books: [book('x', 'X', 'Nobody', 'Romance')],
      friend_reads: [read('x', 'Romance', '2026-01-01', '2026-01-02')],
      friend_daily: [],
    })[0];
    expect(none.score).toBe(0);
    expect(none.books).toEqual([]);
  });

  describe('rating agreement', () => {
    const lib = (ratings: (number | null)[]) => {
      const ids = ['a', 'b', 'c', 'd'];
      return {
        books: ids.map((id, i) => ({
          ...book(id, id.toUpperCase(), 'Author ' + id, 'Classics'),
          rating: ratings[i],
        })),
        reads: ids.map((id) => read(id, 'Classics', '2026-01-01', '2026-01-02')),
        daily: [],
      };
    };
    const match = (mine: (number | null)[], theirs: (number | null)[]) => {
      const a = lib(mine),
        b = lib(theirs);
      return run<Match>('taste_match', {
        ...a,
        friend_books: b.books,
        friend_reads: b.reads,
        friend_daily: b.daily,
      })[0];
    };

    it('scores how alike your stars are once you both rated 3 books', () => {
      // genres, authors and books all match; only the ratings differ
      const same = match([5, 4, 3, 2], [5, 4, 3, 2]);
      expect(same.parts.ratings).toBe(100);
      expect(same.rated).toBe(4);
      expect(same.score).toBe(100);
      // one star apart on average: 1 - 1/4
      const near = match([5, 4, 3, null], [4, 5, 2, 1]);
      expect(near.rated).toBe(3);
      expect(near.star_gap).toBe(1);
      expect(near.parts.ratings).toBe(75);
      expect(near.score).toBe(Math.round(100 * (0.8 + 0.2 * 0.75)));
      // as far apart as stars go
      const far = match([5, 5, 5, 1], [1, 1, 1, 5]);
      expect(far.parts.ratings).toBe(0);
      expect(far.score).toBe(80);
    });

    it('keeps the old weights with fewer than 3 books rated by both', () => {
      const two = match([5, 1, null, null], [1, 5, 3, 3]);
      expect(two.rated).toBe(2);
      expect(two.parts.ratings).toBeNull();
      expect(two.score).toBe(100);
      const none = match([null, null, null, null], [null, null, null, null]);
      expect(none.rated).toBe(0);
      expect(none.parts.ratings).toBeNull();
    });
  });
});
