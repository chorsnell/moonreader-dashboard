import type { BookHistory } from '../backup-import/reading-history.types';
import type { Highlight } from '../backup-import/highlights';
import type { ImportedBook, ImportFile } from '../imports/imports.types';
import {
  buildKoreaderBooks,
  cleanSidecarBook,
  koreaderAuthors,
  koreaderTime,
  matchFiles,
  normaliseText,
  sidecarHighlights,
  type SidecarBook,
} from './koreader-books';

const imported = (over: Partial<ImportedBook> = {}): ImportedBook => ({
  id: 'md5a',
  title: 'Alpha',
  author: 'Ann Author',
  isbn13: null,
  isbn10: null,
  rating: null,
  shelves: [],
  shelf: 'currently-reading',
  read_count: 0,
  date_added: null,
  pages: 100,
  reads: [{ start: '2026-03-01', end: '2026-03-02', finished: false, progress: 40 }],
  daily: [{ date: '2026-03-01', minutes: 30, words: null, progress: 40 }],
  progress: 40,
  ...over,
});

const history = (over: Partial<BookHistory> = {}): BookHistory => ({
  id: 'alpha',
  title: 'Alpha',
  author: 'Ann Author',
  series: null,
  series_no: null,
  genre: 'Science Fiction',
  subgenre: 'Space Opera',
  isbn13: null,
  isbn10: null,
  work_id: null,
  status: 'in_progress',
  progress: 55,
  total_minutes: 90,
  total_words: 0,
  times_read: 0,
  first_read: '2024-01-01',
  last_read: '2024-01-03',
  reads: [],
  daily: [
    { date: '2024-01-01', minutes: 30, words: 1000, progress: 20 },
    { date: '2024-01-02', minutes: 0, words: 0, progress: 20 },
    { date: '2024-01-03', minutes: 60, words: 2000, progress: 55 },
  ],
  synced: null,
  source_files: ['alpha - ann author.epub'],
  ...over,
});

const hl = (over: Partial<Highlight>): Highlight => ({
  id: 1,
  book_id: 'alpha',
  date: '2024-01-01',
  time: '2024-01-01T21:00:00',
  progress: 10,
  chapter: 2,
  text: 'A passage.',
  note: null,
  colour: null,
  kind: 'highlight',
  ...over,
});

describe('KOReader sync: helpers', () => {
  it('joins KOReader authors and reads its times', () => {
    expect(koreaderAuthors('Ann Author\nBob Second')).toBe('Ann Author & Bob Second');
    expect(koreaderAuthors('N/A')).toBe('');
    expect(koreaderTime('2026-10-20 22:01:00')).toBe('2026-10-20T22:01:00');
    expect(koreaderTime('2026-10-20 22:01')).toBe('2026-10-20T22:01:00');
    expect(koreaderTime('yesterday')).toBeNull();
  });

  it('folds quotes, dashes, spacing and case', () => {
    expect(normaliseText('  “It’s” — here…\n now ')).toBe(normaliseText('"it\'s" - here... now'));
  });

  it('cleans a sidecar book, refusing synthetic and broken ones', () => {
    expect(cleanSidecarBook({ md5: 'moonplus:alpha' })).toBeNull();
    expect(cleanSidecarBook({ title: 'no md5' })).toBeNull();
    expect(cleanSidecarBook('nonsense')).toBeNull();
    expect(
      cleanSidecarBook({ md5: 'x', percent: 3, status: 'weird', annotations: [null, {}] }),
    ).toMatchObject({
      md5: 'x',
      percent: 1,
      status: null,
      annotations: [{ text: null, drawer: null }],
    });
  });

  it('turns annotations into highlights, notes and noted bookmarks', () => {
    const book: SidecarBook = {
      md5: 'x',
      pages: 200,
      annotations: [
        { text: 'Later passage', drawer: 'lighten', pageno: 150, datetime: '2026-01-02 10:00:00' },
        { text: 'Noted', note: 'mine', drawer: 'underscore', pageno: 20 },
        { text: 'Page 30 of chapter 2', drawer: null, pageno: 30 },
        { text: 'Page 40', note: 'remember this', drawer: null, pageno: 40 },
      ],
    };
    expect(sidecarHighlights(book)).toEqual([
      expect.objectContaining({ text: 'Noted', note: 'mine', kind: 'note', progress: 10 }),
      expect.objectContaining({ note: 'remember this', kind: 'bookmark', progress: 20 }),
      expect.objectContaining({
        text: 'Later passage',
        kind: 'highlight',
        progress: 75,
        time: '2026-01-02T10:00:00',
      }),
    ]);
  });
});

describe('KOReader sync: the import', () => {
  it('drops Moon+ copies and adds what the sidecars know', () => {
    const books = buildKoreaderBooks(
      [
        imported(),
        imported({ id: 'moonplus:beta', title: 'Beta' }),
        imported({ id: 'md5c', title: 'Gamma' }),
      ],
      {
        md5a: { md5: 'md5a', status: 'complete', annotations: [{ text: 'Hi', drawer: 'lighten' }] },
        md5c: { md5: 'md5c', percent: 0.62 },
      },
    );
    expect(books.map((b) => b.title)).toEqual(['Alpha', 'Gamma']);
    expect(books[0]).toMatchObject({
      shelf: 'read',
      progress: 100,
      read_count: 1,
      reads: [{ finished: true, progress: 100 }],
      highlights: [{ text: 'Hi' }],
    });
    expect(books[1]).toMatchObject({ progress: 62, shelf: 'currently-reading' });
  });

  it('adds books only the sidecars know, when they have something to show', () => {
    const books = buildKoreaderBooks([], {
      d1: { md5: 'd1', title: 'Delta', authors: 'Dee\nDum', series: 'Saga #2', percent: 0.3 },
      d2: { md5: 'd2', file: 'Epsilon.epub', status: 'abandoned', percent: 0.1 },
      d3: { md5: 'd3', title: 'Opened once', percent: 0 },
    });
    expect(books).toEqual([
      expect.objectContaining({
        id: 'd1',
        title: 'Delta',
        author: 'Dee & Dum',
        series: 'Saga',
        series_no: 2,
        progress: 30,
      }),
      expect.objectContaining({
        id: 'd2',
        title: 'Epsilon',
        shelf: 'did-not-finish',
        progress: 10,
      }),
    ]);
  });

  it("names a matched book the dashboard's way", () => {
    const [b] = buildKoreaderBooks(
      [imported({ title: 'ALPHA: a novel', author: 'A. Author' })],
      {},
      {
        md5a: { title: 'Alpha', author: 'Ann Author' },
      },
    );
    expect(b).toMatchObject({ title: 'Alpha', author: 'Ann Author' });
  });
});

describe('KOReader sync: matching device files', () => {
  const koreader: ImportFile = {
    schema_version: 1,
    source: 'koreader',
    file: 'x',
    imported: 'x',
    books: [
      imported({
        id: 'md5a',
        daily: [{ date: '2024-01-03', minutes: 60, words: null, progress: 55 }],
        highlights: [
          {
            time: null,
            progress: null,
            chapter: null,
            location: null,
            text: 'From KOReader.',
            note: null,
            kind: 'highlight',
          },
        ],
      }),
    ],
  };
  const books = [
    history({ imports: { koreader: 'md5a' } }),
    history({
      id: 'beta',
      title: 'Beta',
      author: 'Bea',
      source_files: ['beta.epub'],
      daily: [{ date: '2023-05-05', minutes: 12, words: 0, progress: 100 }],
    }),
    history({ id: 'gamma', title: 'Gamma', author: 'Gus', source_files: [], daily: [] }),
    history({ id: 'delta', title: 'Delta', author: 'Dee', source_files: ['delta.epub'] }),
  ];
  const highlights = [
    hl({ text: 'From Moon+.' }),
    hl({ id: 2, text: 'From KOReader.' }),
    hl({ id: 3, book_id: 'beta' }),
  ];

  it('matches by md5, file name, then title and author, leaving out KOReader’s own data', () => {
    const r = matchFiles({
      files: [
        { md5: 'md5a', file: 'whatever.epub' },
        { md5: 'm-b', file: '/mnt/onboard/Books/BETA.epub' },
        { md5: 'm-g', file: 'g.epub', title: 'Gamma', authors: 'Gus' },
        { md5: 'm-x', file: 'unknown.epub', title: 'Unknown' },
      ],
      others: true,
      books,
      highlights,
      koreader,
      links: {},
    });
    expect(r.books.map((b) => b.match?.id ?? null)).toEqual(['alpha', 'beta', 'gamma', null]);
    // the day KOReader recorded and the empty day are left out; so is KOReader's highlight
    expect(r.books[0].match).toMatchObject({
      status: 'in_progress',
      progress: 55,
      genre: 'Science Fiction',
      days: [{ date: '2024-01-01', minutes: 30, progress: 20 }],
      highlights: [{ text: 'From Moon+.', chapter: 2, kind: 'highlight' }],
    });
    expect(r.books[1].match?.highlights).toHaveLength(1);
    // delta wasn't on the device but has days; gamma has none
    expect(r.others?.map((b) => b.id)).toEqual(['delta']);
    expect(r.others?.[0].highlights).toEqual([]);
    expect(r.links).toEqual({
      md5a: { book_id: 'alpha', title: 'Alpha', author: 'Ann Author' },
      'm-b': { book_id: 'beta', title: 'Beta', author: 'Bea' },
      'm-g': { book_id: 'gamma', title: 'Gamma', author: 'Gus' },
    });
  });

  it('remembers earlier matches and leaves others out unless asked', () => {
    const r = matchFiles({
      files: [{ md5: 'renamed', file: 'something else.epub', title: 'Different metadata' }],
      others: false,
      books,
      highlights: [],
      koreader: null,
      links: { renamed: { book_id: 'delta' } },
    });
    expect(r.books[0].match?.id).toBe('delta');
    expect(r.others).toBeUndefined();
  });
});
