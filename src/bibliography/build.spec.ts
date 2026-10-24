import { seriesNameKey } from '../common/book-match';
import type { BibliographyFile, BibliographyWork } from './bibliography.types';
import { bibliographyAuthors, buildBibliography, type LibraryBook } from './build';

const work = (title: string, more: Partial<BibliographyWork> = {}): BibliographyWork => ({
  work_id: null,
  title,
  year: null,
  editions: 2,
  series: null,
  series_no: null,
  isbn13: null,
  sources: ['openlibrary'],
  ...more,
});

const books: LibraryBook[] = [
  { id: 'emma', title: 'Emma', author: 'Jane Austen', status: 'finished', hours: 12 },
  {
    id: 'pp',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    status: 'not_started',
    work_id: 'OL2W',
  },
  {
    id: 'scarlet',
    title: 'A Study in Scarlet',
    author: 'Arthur Conan Doyle',
    series: 'Sherlock Holmes',
    status: 'in_progress',
    hours: 2,
  },
  // one book, not finished, in no series: not an author to follow
  { id: 'moby', title: 'Moby-Dick', author: 'Herman Melville', status: 'in_progress', hours: 5 },
  // co-authors: the first one counts
  {
    id: 'talisman',
    title: 'The Talisman',
    author: 'King, Stephen & Straub, Peter',
    status: 'finished',
    hours: 20,
  },
];

const file: BibliographyFile = {
  authors: {
    'jane austen': {
      author_key: 'OL1A',
      wikidata: 'Q1',
      looked_up: '2026-10-01',
      works: [
        work('Emma', { work_id: 'OL1W', year: 1815 }), // read
        work('Pride & Prejudice', { work_id: 'OL2W', year: 1813 }), // in the library, by work id
        work('Persuasion', { work_id: 'OL3W', year: 1817, isbn13: '9780141439686' }),
        work('Northanger Abbey', { work_id: 'OL4W', year: 1817 }),
        work('Sense and Sensibility', { work_id: 'OL5W', year: 1811 }),
      ],
    },
    'arthur conan doyle': {
      author_key: 'OL2A',
      wikidata: null,
      looked_up: '2026-10-01',
      works: [
        work('A Study in Scarlet (Sherlock Holmes, #1)', { series: 'Sherlock Holmes', series_no: 1 }),
        work('The Sign of the Four', { series: 'The Sherlock Holmes series', series_no: 2 }),
        work('The Lost World', { year: 1912 }), // not a followed author, no series of yours
      ],
    },
    'herman melville': {
      author_key: 'OL3A',
      wikidata: null,
      looked_up: '2026-10-01',
      works: [work('Typee')],
    },
    'king, stephen': {
      author_key: 'OL4A',
      wikidata: null,
      looked_up: '2026-10-01',
      works: [work('The Stand', { work_id: 'OL9W', year: 1978 })],
    },
    // no longer in the library
    'gone author': { author_key: null, wikidata: null, looked_up: '2026-10-01', works: [work('X')] },
  },
};

describe('seriesNameKey', () => {
  it('ignores case, accents, a leading The and a trailing series word', () => {
    const same = ['The Wheel of Time', 'Wheel of Time series', 'wheel of time', 'Wheel Of Time Saga'];
    expect(new Set(same.map(seriesNameKey)).size).toBe(1);
    expect(seriesNameKey('Les Rougon-Macquart')).toBe(seriesNameKey('Les Rougon Macquart'));
    expect(seriesNameKey('Mistborn Trilogy')).toBe(seriesNameKey('Mistborn'));
    // a name that is only the word is left alone
    expect(seriesNameKey('The Chronicles')).toBe('chronicles');
    expect(seriesNameKey('Trilogy')).toBe('trilogy');
    expect(seriesNameKey('Discworld')).not.toBe(seriesNameKey('Dune'));
  });
});

describe('bibliographyAuthors', () => {
  it('picks authors with a finished book, two books or a series, most hours first', () => {
    expect(bibliographyAuthors(books).map((a) => [a.id, a.byAuthor])).toEqual([
      ['king, stephen', true],
      ['jane austen', true],
      ['arthur conan doyle', false],
    ]);
  });
});

describe('buildBibliography', () => {
  it('lists works you have not got, why, and whether they are on the pile', () => {
    const pile = [{ title: 'Persuasion', author: 'Austen, Jane', isbn13: '978-0-14-143968-6' }];
    const rows = buildBibliography(books, pile, file);
    expect(rows).toEqual([
      {
        work_id: null,
        title: 'The Sign of the Four',
        author: 'Arthur Conan Doyle',
        published_year: null,
        editions: 2,
        series: 'Sherlock Holmes',
        series_no: 2,
        isbn13: null,
        why: ['series'],
        on_pile: false,
      },
      {
        work_id: 'OL5W',
        title: 'Sense and Sensibility',
        author: 'Jane Austen',
        published_year: 1811,
        editions: 2,
        series: null,
        series_no: null,
        isbn13: null,
        why: ['author'],
        on_pile: false,
      },
      expect.objectContaining({ title: 'Northanger Abbey', published_year: 1817, on_pile: false }),
      expect.objectContaining({ title: 'Persuasion', isbn13: '9780141439686', on_pile: true }),
      expect.objectContaining({
        title: 'The Stand',
        author: 'King, Stephen & Straub, Peter',
        why: ['author'],
      }),
    ]);
  });

  it('marks both reasons, and spells the author as a book of theirs alone does', () => {
    const more: LibraryBook[] = [
      ...books,
      { id: 'sign', title: 'Hound', author: 'Arthur Conan Doyle', status: 'finished' },
      { id: 'carrie', title: 'Carrie', author: 'Stephen King', status: 'finished' },
      { id: 'it', title: 'It', author: 'King, Stephen', status: 'finished' },
    ];
    const rows = buildBibliography(more, [], file);
    expect(rows.find((r) => r.title === 'The Sign of the Four')?.why).toEqual(['author', 'series']);
    expect(rows.find((r) => r.title === 'The Lost World')?.why).toEqual(['author']);
    expect(rows.find((r) => r.title === 'The Stand')?.author).toBe('King, Stephen');
  });

  it('copes with nothing looked up yet', () => {
    expect(buildBibliography(books, [], null)).toEqual([]);
    expect(buildBibliography([], [], file)).toEqual([]);
  });
});
