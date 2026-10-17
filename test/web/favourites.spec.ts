import { loadCalcs } from '../support/feature-calcs';

type Fav = { book_id: string; devoured: boolean; reread: boolean; your_author_books: number };

const run = loadCalcs('calcs.js', 'features/friend-profiles.js', 'features/friends-favourites.js');
const book = (id: string, title: string, author: string, genre: string, times_read = 1) => ({
  id,
  title,
  author,
  genre,
  times_read,
});
const print = (book_id: string, shape: string) => ({
  book_id,
  shape,
  finished: true,
  span_days: 3,
  mins_per_day: 60,
  spark: [60, 60, 60],
});

describe("a friend's favourites", () => {
  it("keeps devoured and re-read books you haven't got, most like your reading first", () => {
    const rows = run<Fav>('friend_favourites', {
      books: [book('dracula', 'Dracula', 'Bram Stoker', 'Horror')],
      reads: [{ book_id: 'dracula', genre: 'Horror' }],
      friend_books: [
        book('dracula', 'Dracula', 'Bram Stoker', 'Horror'), // you have it
        book('worm', 'The Lair of the White Worm', 'Bram Stoker', 'Horror'),
        book('emma', 'Emma', 'Jane Austen', 'Classics', 2), // re-read
        book('slow', 'Slow Book', 'Someone', 'Horror'), // a slow burn
      ],
      friend_fingerprints: [
        print('dracula', 'devoured'),
        print('worm', 'devoured'),
        print('slow', 'slow_burn'),
      ],
    });
    expect(rows.map((r) => r.book_id)).toEqual(['worm', 'emma']);
    expect(rows[0]).toMatchObject({ devoured: true, your_author_books: 1 });
    expect(rows[1]).toMatchObject({ devoured: false, reread: true });
  });
});
