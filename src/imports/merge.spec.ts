import type { BookHistory } from '../backup-import/reading-history.types';
import type { ImportedBook, ImportFile } from './imports.types';
import { authorKey, mergeImports, titleKey } from './merge';

function moonBook(over: Partial<BookHistory>): BookHistory {
  return {
    id: 'emma',
    title: 'Emma',
    author: 'Jane Austen',
    series: null,
    series_no: null,
    genre: 'Classics',
    subgenre: 'Romance',
    isbn13: null,
    isbn10: null,
    work_id: null,
    status: 'finished',
    progress: 100,
    total_minutes: 600,
    total_words: 160000,
    times_read: 1,
    first_read: '2024-01-01',
    last_read: '2024-01-20',
    reads: [
      {
        read_no: 1,
        start: '2024-01-01',
        end: '2024-01-20',
        days_read: 12,
        minutes: 600,
        progress: 100,
        finished: true,
      },
    ],
    daily: [],
    synced: null,
    source_files: ['emma.epub'],
    ...over,
  };
}

function imported(over: Partial<ImportedBook>): ImportedBook {
  return {
    id: '1',
    title: 'Emma',
    author: 'Jane Austen',
    isbn13: null,
    isbn10: null,
    rating: 4,
    shelves: [],
    shelf: 'read',
    read_count: 1,
    date_added: null,
    pages: null,
    reads: [],
    ...over,
  };
}

const file = (books: ImportedBook[]): ImportFile => ({
  schema_version: 1,
  source: 'goodreads',
  file: 'goodreads_library_export.csv',
  imported: '2025-01-01T10:00:00',
  books,
});

const empty = { books: {}, exclude: [] };

describe('match keys', () => {
  it('ignore series suffixes, subtitles, articles and name order', () => {
    expect(titleKey('The Colour of Magic (Discworld, #1)')).toBe(titleKey('Colour of Magic'));
    expect(titleKey('Frankenstein: or, The Modern Prometheus')).toBe('frankenstein');
    expect(authorKey('J.R.R. Tolkien')).toBe(authorKey('Tolkien, J. R. R.'));
    expect(authorKey('Martin Luther King Jr.')).toBe('king');
  });
});

describe('mergeImports', () => {
  it('matches by title and author, adding the rating and shelves but not the same read', () => {
    const books = [moonBook({})];
    const r = mergeImports(
      books,
      [
        file([
          imported({
            title: 'Emma (Penguin Classics)',
            author: 'Austen, Jane',
            shelves: ['favourites'],
            reads: [{ start: null, end: '2024-01-25', finished: true }],
          }),
        ]),
      ],
      empty,
    );
    expect(r).toMatchObject({ matched: 1, added: 0, skipped: 0 });
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ rating: 4, shelves: ['favourites'], times_read: 1 });
    expect(books[0].reads).toHaveLength(1);
    expect(books[0].imports).toEqual({ goodreads: '1' });
  });

  it('matches by ISBN first, and adds an earlier read on paper', () => {
    const books = [moonBook({ title: 'Emma: A Novel', isbn13: '9780141439587' })];
    mergeImports(
      books,
      [
        file([
          imported({
            title: 'Something else entirely',
            isbn13: '9780141439587',
            reads: [{ start: null, end: '2015-06-01', finished: true }],
          }),
        ]),
      ],
      empty,
    );
    const b = books[0];
    expect(b.reads.map((r) => [r.read_no, r.start, r.source ?? 'moon'])).toEqual([
      [1, '2015-06-01', 'goodreads'],
      [2, '2024-01-01', 'moon'],
    ]);
    expect(b).toMatchObject({ times_read: 2, first_read: '2015-06-01', last_read: '2024-01-20' });
  });

  it('adds books only Goodreads knows, as reads without days', () => {
    const books = [moonBook({})];
    const r = mergeImports(
      books,
      [
        file([
          imported({
            id: '34',
            title: 'The Colour of Magic (Discworld, #1)',
            author: 'Terry Pratchett',
            shelves: ['classics'],
            read_count: 2,
            reads: [{ start: null, end: '2019-05-02', finished: true }],
          }),
          imported({ id: '35', title: 'Mort', author: 'Terry Pratchett', shelf: 'to-read' }),
          imported({ id: '36', title: 'Emma', author: 'Jane Austen', rating: 2 }),
        ]),
      ],
      empty,
    );
    expect(r).toMatchObject({ matched: 1, added: 1, skipped: 1 });
    const added = books.find((b) => b.source === 'goodreads')!;
    expect(added).toMatchObject({
      id: 'the-colour-of-magic',
      title: 'The Colour of Magic',
      series: 'Discworld',
      series_no: 1,
      // "classics" is a genre the library already uses
      genre: 'Classics',
      status: 'finished',
      times_read: 2,
      first_read: '2019-05-02',
      daily: [],
      source_files: ['goodreads:34'],
    });
    expect(added.reads).toEqual([
      {
        read_no: 1,
        start: '2019-05-02',
        end: '2019-05-02',
        days_read: 0,
        minutes: null,
        progress: 100,
        finished: true,
        source: 'goodreads',
      },
    ]);
    expect(books[0].rating).toBe(2);
  });

  it('uses the catalogue entry for an imported book, or leaves it out when excluded', () => {
    const books: BookHistory[] = [];
    mergeImports(
      books,
      [file([imported({ id: '7', title: 'Mort' }), imported({ id: '8', title: 'Sourcery' })])],
      {
        books: { 'goodreads:7': { title: 'Mort', author: 'Terry Pratchett', genre: 'Fantasy' } },
        exclude: ['goodreads:8'],
      },
    );
    expect(books.map((b) => [b.title, b.author, b.genre])).toEqual([
      ['Mort', 'Terry Pratchett', 'Fantasy'],
    ]);
  });

  it('fills in days Moon+ lacks from a device, and finishes the read there', () => {
    const books = [
      moonBook({
        status: 'in_progress',
        progress: 60,
        reads: [
          {
            read_no: 1,
            start: '2024-01-01',
            end: '2024-01-20',
            days_read: 2,
            minutes: 60,
            progress: 60,
            finished: false,
          },
        ],
        daily: [
          { date: '2024-01-01', minutes: 30, words: null, progress: 30 },
          { date: '2024-01-20', minutes: 30, words: null, progress: 60 },
        ],
        total_minutes: 60,
      }),
    ];
    const r = mergeImports(
      books,
      [
        {
          ...file([
            imported({
              id: 'kobo-1',
              rating: null,
              shelf: 'read',
              progress: 100,
              reads: [{ start: '2024-01-20', end: '2024-01-25', finished: true, minutes: 50 }],
              daily: [
                { date: '2024-01-20', minutes: 99, words: null, progress: 70 },
                { date: '2024-01-25', minutes: 50, words: null, progress: 100 },
              ],
              highlights: [
                {
                  time: '2024-01-25T20:00:00',
                  progress: null,
                  chapter: null,
                  location: null,
                  text: 'A line',
                  note: null,
                  kind: 'highlight',
                },
              ],
            }),
          ]),
          source: 'kobo',
        },
      ],
      empty,
    );
    const b = books[0];
    // Moon+ keeps its own 20 January; the Kobo adds the 25th
    expect(b.daily.map((d) => [d.date, d.minutes])).toEqual([
      ['2024-01-01', 30],
      ['2024-01-20', 30],
      ['2024-01-25', 50],
    ]);
    expect(b.reads).toEqual([
      expect.objectContaining({ start: '2024-01-01', end: '2024-01-25', finished: true }),
    ]);
    expect(b).toMatchObject({ status: 'finished', progress: 100, total_minutes: 110 });
    expect(b.last_read).toBe('2024-01-25');
    expect(r.highlights).toEqual([
      expect.objectContaining({ book_id: 'emma', source: 'kobo', text: 'A line' }),
    ]);
  });

  it('adds a book known only from its highlights', () => {
    const books: BookHistory[] = [];
    mergeImports(
      books,
      [
        {
          ...file([
            imported({
              id: 'Mort (Terry Pratchett)',
              title: 'Mort',
              author: 'Terry Pratchett',
              rating: null,
              shelf: '',
              highlights: [
                {
                  time: '2021-03-14T21:03:11',
                  progress: null,
                  chapter: null,
                  location: 7,
                  text: 'Death',
                  note: null,
                  kind: 'highlight',
                },
              ],
            }),
          ]),
          source: 'kindle_clippings',
        },
      ],
      empty,
    );
    expect(books[0]).toMatchObject({
      title: 'Mort',
      status: 'unknown',
      source: 'kindle_clippings',
      first_read: '2021-03-14',
      last_read: '2021-03-14',
      reads: [],
    });
  });
});
