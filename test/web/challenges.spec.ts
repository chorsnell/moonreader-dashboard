import {
  ChallengeError,
  DEFAULT_CHALLENGES,
  readChallenges,
  toChallenges,
} from '../../src/challenges/challenges';
import { loadCalcs } from '../support/feature-calcs';

type Row = {
  id: string;
  value: number;
  target: number;
  done: boolean;
  items: unknown[];
  missing: unknown[];
  detail: Record<string, unknown> | null;
};

const run = loadCalcs('calcs.js', 'features/challenges.js');

const book = (id: string, o: Record<string, unknown>) => ({
  id,
  title: id,
  genre: 'Classics',
  ...o,
});
const fin = (book_id: string, end: string) => ({ book_id, end, start: end, finished: true });

const books = [
  book('a', {
    author_country: 'GB',
    author_country_name: 'United Kingdom',
    author_gender: 'female',
    published_year: 1813,
    series: 'S',
    genre: 'Classics',
  }),
  book('b', {
    author_country: 'FR',
    author_country_name: 'France',
    author_gender: 'male',
    published_year: 1844,
    series: 'S',
    genre: 'Adventure',
  }),
  book('c', {
    author_country: 'GB',
    author_country_name: 'United Kingdom',
    author_gender: 'female',
    published_year: 1818,
    genre: 'Horror',
  }),
  book('d', { author_country: 'US', author_gender: null, published_year: 1851, series: 'T' }),
  book('e', { author_country: 'RU', author_gender: 'male', published_year: 1866, series: 'T' }),
  // a private book a visitor gets anonymised: says nothing
  book('private-1', { genre: 'Private', author_country: null }),
];
const reads = [
  fin('a', '2025-03-01'),
  fin('b', '2026-02-01'), // finishes series S this year
  fin('c', '2026-04-01'),
  fin('d', '2026-05-01'), // series T not finished: e never read
  fin('private-1', '2026-06-01'),
];
const daily = [
  '2026-06-01',
  '2026-06-02',
  '2026-06-03',
  '2026-06-05',
  '2026-06-29',
  '2026-06-30',
].map((date) => ({ date, book_id: 'c', minutes: 20, words: 5000 }));
const as_of = [{ date: '2026-06-30' }];

const challenges = [
  { id: 'countries', kind: 'countries', title: 'Countries', target: 3, period: 'year' },
  { id: 'all-countries', kind: 'countries', title: 'Countries ever', target: 3, period: 'all' },
  {
    id: 'decades',
    kind: 'decades',
    title: 'Decades',
    target: 6,
    period: 'all',
    from: 1800,
    to: 1850,
  },
  { id: 'series', kind: 'series', title: 'Series', target: 1, period: 'year' },
  { id: 'women', kind: 'women', title: 'Women', target: 50, period: 'year' },
  { id: 'streak', kind: 'streak', title: 'Streak', target: 3, period: 'year' },
  { id: 'genres', kind: 'genres', title: 'Genres', target: 5, period: 'all' },
];
const rows = Object.fromEntries(
  run<Row>('challenge_progress', { challenges, books, reads, daily, as_of }).map((r) => [r.id, r]),
);

describe('challenge progress', () => {
  it('counts author countries in the period', () => {
    expect(rows.countries).toMatchObject({ value: 3, done: true });
    expect(rows.countries.items).toEqual(['France', 'US', 'United Kingdom']);
    expect(rows['all-countries'].value).toBe(3);
  });

  it('finds each decade and what is still missing', () => {
    expect(rows.decades.items).toEqual([1810, 1840, 1850]);
    expect(rows.decades.missing).toEqual([1800, 1820, 1830]);
    expect(rows.decades).toMatchObject({ value: 3, target: 6, done: false });
  });

  it('counts a series once every book in it is finished, in the year that happened', () => {
    expect(rows.series.items).toEqual(['S']);
    expect(rows.series.done).toBe(true);
  });

  it('takes the share of women among books with a known author gender', () => {
    // this year: b (male), c (female), d (unknown); the private book counts for nothing
    expect(rows.women.value).toBe(50);
    expect(rows.women.detail).toEqual({ women: 1, books: 2 });
  });

  it('finds the longest run of reading days, and the run going now', () => {
    expect(rows.streak.value).toBe(3);
    expect(rows.streak.detail).toMatchObject({ now: 2, best_end: '2026-06-03' });
  });

  it('counts genres, leaving out private books', () => {
    expect(rows.genres.items).toEqual(['Adventure', 'Classics', 'Horror']);
  });
});

describe('challenge settings', () => {
  it('uses the defaults until the admin saves some', () => {
    expect(readChallenges(undefined)).toEqual({ challenges: DEFAULT_CHALLENGES, custom: false });
    expect(readChallenges('junk').custom).toBe(false);
    expect(readChallenges([]).challenges).toEqual([]);
  });

  it('tidies what the admin sends', () => {
    const out = toChallenges([
      { kind: 'genres', title: '  Eight genres ', target: '8' },
      { kind: 'genres', title: 'Again', target: 3, period: 'all', id: 'genres' },
      { kind: 'decades', title: 'Old', from: 1805, to: 1899 },
    ]);
    expect(out).toEqual([
      { id: 'genres', kind: 'genres', title: 'Eight genres', target: 8, period: 'year' },
      { id: 'genres-2', kind: 'genres', title: 'Again', target: 3, period: 'all' },
      {
        id: 'decades',
        kind: 'decades',
        title: 'Old',
        target: 10,
        period: 'year',
        from: 1800,
        to: 1890,
      },
    ]);
  });

  it.each([
    [{}, /Send a list/],
    [[{ kind: 'nope', title: 'x', target: 1 }], /pick what it counts/],
    [[{ kind: 'women', title: '', target: 50 }], /give it a name/],
    [[{ kind: 'women', title: 'x', target: 150 }], /between 1 and 100/],
    [[{ kind: 'decades', title: 'x', from: 1900, to: 1800 }], /earlier year/],
    [Array(21).fill({ kind: 'genres', title: 'x', target: 1 }), /more than 20/],
  ])('refuses %j', (raw, message) => {
    expect(() => toChallenges(raw)).toThrow(ChallengeError);
    expect(() => toChallenges(raw)).toThrow(message);
  });
});
