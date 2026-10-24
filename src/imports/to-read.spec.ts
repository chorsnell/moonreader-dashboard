import type { BookHistory, UnopenedBook } from '../backup-import/reading-history.types';
import type { ToReadImport } from './merge';
import { buildToRead } from './to-read';
import { emptyWant, type WantBook } from '../want-to-read/want-to-read';

const book = (title: string, author: string, isbn13: string | null = null) =>
  ({ id: title.toLowerCase(), title, author, isbn13 }) as BookHistory;
const unopened = (title: string, author: string, added: string | null): UnopenedBook => ({
  title,
  author,
  added,
  file: `${title}.epub`.toLowerCase(),
  series: null,
  series_no: null,
  genre: 'Classics',
  subgenre: 'Victorian',
  isbn13: null,
  isbn10: null,
  work_id: null,
});
const mine = (o: Partial<WantBook>): WantBook => ({
  id: 'mine:x',
  title: 'X',
  author: '',
  series: null,
  series_no: null,
  isbn13: null,
  pages: null,
  published_year: null,
  work_id: null,
  genre: 'Untagged',
  subgenre: 'Untagged',
  note: '',
  added: '2026-01-01',
  from: 'manual',
  ...o,
});
const shelved = (o: Partial<ToReadImport>): ToReadImport => ({
  source: 'goodreads',
  id: '1',
  title: 'Kim',
  author: 'Rudyard Kipling',
  series: null,
  series_no: null,
  genre: 'Untagged',
  subgenre: 'Untagged',
  isbn13: null,
  pages: null,
  added: null,
  shelves: [],
  ...o,
});

describe('the to-read pile', () => {
  it('keeps unopened Moon+ books and to-read shelves, once each, oldest first', () => {
    const rows = buildToRead(
      [book('Emma', 'Jane Austen', '9780141439587')],
      [unopened('Kim', 'Rudyard Kipling', '2025-06-01'), unopened('Emma', 'Jane Austen', null)],
      [
        shelved({ id: '7', author: 'Kipling, Rudyard', added: '2024-01-02', shelves: ['india'] }),
        shelved({ id: '8', title: 'Bleak House', author: 'Charles Dickens', pages: 1017 }),
        // already read (same ISBN)
        shelved({ id: '9', title: 'Emma (Penguin)', author: 'J. Austen', isbn13: '9780141439587' }),
        shelved({
          source: 'storygraph',
          id: 'X1',
          title: 'Vanity Fair',
          author: 'Thackeray',
          added: '2025-01-01',
        }),
      ],
    );
    expect(rows.map((r) => [r.book_id, r.title, r.added, r.sources])).toEqual([
      ['kim', 'Kim', '2024-01-02', ['moonplus', 'goodreads']],
      ['storygraph:x1', 'Vanity Fair', '2025-01-01', ['storygraph']],
      ['goodreads:8', 'Bleak House', null, ['goodreads']],
    ]);
    // the Moon+ file named the book; the shelf brought its tags
    expect(rows[0]).toMatchObject({ genre: 'Classics', shelves: ['india'] });
    expect(rows[2].pages).toBe(1017);
  });

  it("gives an unopened file an id the library doesn't use", () => {
    const rows = buildToRead(
      [book('Kim', 'Someone Else')],
      [unopened('Kim', 'Rudyard Kipling', null)],
      [],
    );
    expect(rows.map((r) => r.book_id)).toEqual(['kim-2']);
  });

  it('adds your own list, merged with the same book from a shelf', () => {
    const rows = buildToRead(
      [book('Emma', 'Jane Austen', '9780141439587')],
      [],
      [shelved({ id: '7', title: 'Kim', added: '2024-01-02', isbn13: '9780141442372' })],
      {
        ...emptyWant(),
        books: [
          // the same book kept from the shelf, found by ISBN
          mine({
            id: 'mine:kim',
            title: 'Kim (Penguin Classics)',
            author: 'R. Kipling',
            isbn13: '9780141442372',
            note: 'the Penguin one',
            from: 'goodreads',
            work_id: 'OL1W',
          }),
          // by title and author
          mine({ id: 'mine:lorna', title: 'Lorna Doone', author: 'R. D. Blackmore' }),
          // already read
          mine({ id: 'mine:emma', title: 'Emma', author: 'Jane Austen' }),
        ],
      },
    );
    expect(rows.map((r) => [r.book_id, r.sources, r.want_id, r.note])).toEqual([
      ['goodreads:7', ['goodreads', 'mine'], 'mine:kim', 'the Penguin one'],
      ['mine:lorna', ['mine'], 'mine:lorna', ''],
    ]);
    expect(rows[0]).toMatchObject({ work_id: 'OL1W', added: '2024-01-02' });
    expect(rows[1]).toMatchObject({ genre: 'Untagged', added: '2026-01-01' });
  });

  it('leaves off the pile what you hid, but not a book also on your list', () => {
    const rows = buildToRead(
      [],
      [unopened('Kim', 'Rudyard Kipling', '2025-06-01')],
      [
        // merged into Moon+'s "kim": hiding that row hides the book
        shelved({ id: '7' }),
        shelved({ id: '8', title: 'Bleak House', author: 'Charles Dickens' }),
        shelved({ id: '9', title: 'Vanity Fair', author: 'Thackeray' }),
      ],
      {
        ...emptyWant(),
        books: [mine({ id: 'mine:vanity-fair', title: 'Vanity Fair', author: 'W. M. Thackeray' })],
        hidden: ['kim', 'goodreads:8', 'goodreads:9'],
      },
    );
    expect(rows.map((r) => [r.book_id, r.sources])).toEqual([
      ['goodreads:9', ['goodreads', 'mine']],
    ]);
  });
});
