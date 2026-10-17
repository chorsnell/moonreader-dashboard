import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('vendor/d3.min.js', 'features/origins.js');

const book = (id: string, author: string, extra: Record<string, unknown>) => ({
  id,
  title: id,
  author,
  genre: 'G',
  hours: 2,
  ...extra,
});
const books = [
  book('a', 'Ann', {
    published_year: 1813,
    author_country: 'GB',
    author_country_name: 'United Kingdom',
    author_gender: 'female',
  }),
  book('b', 'Bob', {
    published_year: 2020,
    author_country: 'GB',
    author_country_name: 'United Kingdom',
    author_gender: 'male',
  }),
  book('c', 'Cy', { published_year: null, author_country: null, author_gender: null }),
];
const read = (book_id: string, read_no: number, end: string) => ({
  read_id: `${book_id}#${read_no}`,
  book_id,
  title: book_id,
  author: '',
  genre: 'G',
  read_no,
  start: end,
  end,
  finished: true,
});
const reads = [
  read('a', 1, '2023-05-01'),
  read('a', 2, '2025-02-01'),
  read('b', 1, '2023-07-01'),
  read('c', 1, '2025-03-01'),
];

describe('origins', () => {
  it('works out how old each book was when read', () => {
    const rows = run<{ read_id: string; age: number }>('book_age', { books, reads });
    expect(rows.map((r) => [r.read_id, r.age])).toEqual([
      ['a#1', 210],
      ['a#2', 212],
      ['b#1', 3],
    ]);
  });

  it('counts books and hours by author country', () => {
    expect(run('author_countries', { books })).toEqual([
      { code: 'GB', name: 'United Kingdom', books: 2, authors: 2, hours: 4 },
      { code: '', name: 'Unknown', books: 1, authors: 1, hours: 2 },
    ]);
  });

  it('counts books by author gender per year', () => {
    expect(run('author_gender_years', { books, reads })).toEqual([
      { year: 2023, total: 2, female: 1, male: 1, 'non-binary': 0, other: 0, unknown: 0 },
      { year: 2025, total: 2, female: 1, male: 0, 'non-binary': 0, other: 0, unknown: 1 },
    ]);
  });
});
