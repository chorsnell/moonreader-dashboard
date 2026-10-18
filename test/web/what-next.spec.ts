import { loadCalcs } from '../support/feature-calcs';

type Pick = {
  title: string;
  score: number;
  parts: Record<string, number>;
  reasons: { kind: string; points: number; text: string }[];
};

const run = loadCalcs(
  'calcs.js',
  'features/friend-profiles.js',
  'features/to-read.js',
  'features/what-next.js',
);

const AS_OF = '2026-10-15';
const books: Record<string, unknown>[] = [];
const reads: Record<string, unknown>[] = [];
// a finished first read of `days` days ending `ago` days before AS_OF
function read(id: string, o: Record<string, unknown>, ago: number, days: number, words = 60000) {
  const end = new Date(Date.parse(AS_OF) - ago * 864e5).toISOString().slice(0, 10);
  const start = new Date(Date.parse(end) - (days - 1) * 864e5).toISOString().slice(0, 10);
  books.push({
    id,
    title: id,
    author: 'Someone',
    genre: 'Classics',
    status: 'finished',
    words,
    times_read: 1,
    first_read: start,
    last_read: end,
    ...o,
  });
  reads.push({
    read_id: id + '#1',
    book_id: id,
    read_no: 1,
    start,
    end,
    finished: true,
    genre: o.genre ?? 'Classics',
  });
}
// three years of mysteries (quick) and classics (slow), mysteries mostly in October
for (let y = 0; y < 3; y++) {
  read(`mystery-${y}a`, { genre: 'Mystery', author: 'Agatha Christie' }, 365 * y + 5, 4);
  read(`mystery-${y}b`, { genre: 'Mystery' }, 365 * y + 20, 5);
  read(`classic-${y}`, { genre: 'Classics' }, 365 * y + 150, 40);
}
read(
  'Styles',
  { genre: 'Mystery', author: 'Agatha Christie', series: 'Hercule Poirot', series_no: 1 },
  60,
  4,
);
// just finished a very long one
read('Middlemarch', { genre: 'Classics', author: 'George Eliot' }, 3, 70, 316000);

const pile = [
  {
    book_id: 'goodreads:1',
    title: 'The Murder on the Links',
    author: 'Agatha Christie',
    series: 'Hercule Poirot',
    series_no: 2,
    genre: 'Mystery',
    added: '2026-01-01',
    sources: ['goodreads'],
  },
  {
    book_id: 'goodreads:2',
    title: 'Silas Marner',
    author: 'George Eliot',
    genre: 'Classics',
    added: '2023-01-01',
    sources: ['goodreads'],
    pages: 100,
  },
  {
    book_id: 'goodreads:3',
    title: 'Carmilla',
    author: 'Sheridan Le Fanu',
    genre: 'Horror',
    added: '2026-09-01',
    sources: ['goodreads'],
    pages: 110,
  },
  {
    book_id: 'goodreads:4',
    title: 'Bleak House',
    author: 'Charles Dickens',
    genre: 'Classics',
    added: '2026-09-01',
    sources: ['goodreads'],
    pages: 1000,
  },
];
const data = {
  books,
  reads,
  daily: [{ date: AS_OF, book_id: 'x', minutes: 1, words: 0 }],
  to_read: pile,
  prices: [],
};
const byTitle = (rows: Pick[]) => Object.fromEntries(rows.map((r) => [r.title, r]));

describe('what to read next', () => {
  const rows = run<Pick>('next_reads', data);
  const r = byTitle(rows);

  it('ranks the next book in a series you are reading first, and says why', () => {
    expect(rows[0].title).toBe('The Murder on the Links');
    expect(r['The Murder on the Links'].reasons.map((x) => x.kind)).toEqual(
      expect.arrayContaining(['series', 'genre', 'season']),
    );
    expect(r['The Murder on the Links'].reasons.find((x) => x.kind === 'series')!.text).toBe(
      'next in Hercule Poirot (#2) after Styles',
    );
  });

  it('suggests something short and different after a long read', () => {
    expect(r['Carmilla'].parts.cleanser).toBeGreaterThan(0);
    expect(r['Carmilla'].reasons[0].text).toMatch(/short and different after Middlemarch/);
    // short, but the same genre as the long read: no cleanser
    expect(r['Silas Marner'].parts.cleanser).toBe(0);
    expect(r['Bleak House'].parts.cleanser).toBe(0);
  });

  it('counts how long a book has waited and the season', () => {
    expect(r['Silas Marner'].parts.waiting).toBe(1);
    expect(r['The Murder on the Links'].parts.season).toBeGreaterThan(0);
    expect(r['Carmilla'].parts.season).toBe(0);
  });

  it('keeps every score between 0 and 100, the parts adding up to it', () => {
    const W = { series: 30, genre: 20, friends: 20, cleanser: 15, season: 10, waiting: 5 };
    for (const p of rows) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(100);
      const sum = Object.entries(W).reduce((s, [k, w]) => s + w * p.parts[k], 0);
      expect(Math.abs(sum - p.score)).toBeLessThanOrEqual(1);
    }
  });

  it('weighs friends’ opinions by taste match', () => {
    const votes = [
      {
        title: 'Bleak House',
        author: 'Charles Dickens',
        name: 'Ben',
        taste: 80,
        rating: 5,
        finished: true,
      },
      { title: 'Carmilla', author: 'Sheridan Le Fanu', name: 'Ada', taste: 20, gave_up: true },
    ];
    const withFriends = byTitle(run<Pick>('next_reads', { ...data, next_friend_votes: votes }));
    expect(withFriends['Bleak House'].parts.friends).toBe(0.9);
    expect(withFriends['Bleak House'].reasons[0].text).toBe('Ben rated it 5★ (80% taste match)');
    expect(withFriends['Bleak House'].score).toBeGreaterThan(r['Bleak House'].score);
    expect(withFriends['Carmilla'].parts.friends).toBeLessThan(0);
  });

  it('is empty with nothing on the pile', () => {
    expect(run('next_reads', { ...data, to_read: [], books: [] })).toEqual([]);
  });
});
