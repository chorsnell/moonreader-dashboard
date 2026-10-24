import { loadCalcs } from '../support/feature-calcs';

type Top = { genre: string; title: string; rank: number; genre_hours: number };

const run = loadCalcs('calcs.js', 'features/genre-picks.js');

const pick = (genre: string, title: string, rank: number, subgenre: string | null = null) => ({
  genre,
  subgenre,
  work_id: null,
  title,
  author: 'Someone',
  published_year: 1900,
  editions: 10,
  rank,
  on_pile: false,
});
const picks = [
  ...['A1', 'A2', 'A3', 'A4'].map((t, i) => pick('Classics', t, i + 1)),
  pick('Classics', 'Sub', 1, 'Gothic'),
  ...['H2', 'H1'].map((t, i) => pick('Horror', t, 2 - i)),
  pick('Fantasy', 'F1', 1),
  pick('Mystery', 'M1', 1),
  pick('Romance', 'R1', 1),
];
const daily = [{ date: '2026-10-01', book_id: 'x', minutes: 30, words: 9000 }];
const read = (genre: string, hours: number, end: string) => ({ genre, hours, end, start: end });

describe('genre_picks_top', () => {
  it('takes the top 3 of each of the 3 genres read most in the last 2 years', () => {
    const reads = [
      read('Horror', 30, '2026-05-01'),
      read('Classics', 20, '2025-12-01'),
      read('Classics', 25, '2026-02-01'),
      read('Fantasy', 10, '2025-01-01'),
      read('Romance', 500, '2020-01-01'), // too long ago
      read('Untagged', 900, '2026-09-01'),
      read('Mystery', 5, '2026-09-01'),
    ];
    const rows = run<Top>('genre_picks_top', { genre_picks: picks, books: [], reads, daily });
    expect(rows.map((r) => [r.genre, r.title, r.genre_hours])).toEqual([
      ['Classics', 'A1', 45],
      ['Classics', 'A2', 45],
      ['Classics', 'A3', 45],
      ['Horror', 'H1', 30],
      ['Horror', 'H2', 30],
      ['Fantasy', 'F1', 10],
    ]);
  });

  it('falls back to all-time hours, and copes with no picks', () => {
    const books = [
      { id: 'a', genre: 'Romance', hours: 40 },
      { id: 'b', genre: 'Mystery', hours: 50 },
    ];
    const reads = [read('Romance', 40, '2019-01-01')];
    const rows = run<Top>('genre_picks_top', { genre_picks: picks, books, reads, daily });
    expect(rows.map((r) => r.title)).toEqual(['M1', 'R1']);
    expect(run('genre_picks_top', { genre_picks: [], books, reads, daily })).toEqual([]);
  });
});
