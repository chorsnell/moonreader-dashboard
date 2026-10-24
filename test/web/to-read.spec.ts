import { loadCalcs } from '../support/feature-calcs';

type Pile = {
  book_id: string;
  title: string;
  added: string | null;
  sources: string[];
  words: number | null;
  estimated: boolean;
  in_library: boolean;
  price: number | null;
};
type Stats = {
  books: number;
  words: number;
  median_age_days: number;
  oldest: { title: string; age_days: number };
  wpm: number;
  mins_per_day: number;
  hours: number;
  days: number;
  added_12m: number;
  finished_12m: number;
  net_12m: number;
  years_to_clear: number;
  months: { month: string; added: number; finished: number }[];
  buckets: { label: string; books: number }[];
  sources: { source: string; books: number }[];
};

const run = loadCalcs('calcs.js', 'features/friend-profiles.js', 'features/to-read.js');

// a year of reading: 30 minutes a day at 250 wpm, a 50,000-word book finished every 30 days
const daily: object[] = [];
const reads: object[] = [];
const books: object[] = [];
for (let t = Date.parse('2025-07-01'), i = 0; t <= Date.parse('2026-06-30'); t += 864e5, i++) {
  const date = new Date(t).toISOString().slice(0, 10);
  daily.push({ date, book_id: 'b', minutes: 30, words: 7500 });
  if (i % 30 === 29) {
    reads.push({ book_id: 'r' + i, read_no: 1, end: date, finished: true });
    books.push({
      id: 'r' + i,
      title: 'Read ' + i,
      author: 'A',
      status: 'finished',
      words: 50_000,
      times_read: 1,
      first_read: date,
    });
  }
}
books.push({
  id: 'opened',
  title: 'Opened Once',
  author: 'B',
  status: 'not_started',
  words: 0,
  times_read: 0,
  first_read: '2026-06-01',
});
const toRead = [
  {
    book_id: 'kim',
    title: 'Kim',
    author: 'Rudyard Kipling',
    added: '2024-01-02',
    sources: ['moonplus', 'goodreads'],
    pages: null,
  },
  {
    book_id: 'goodreads:8',
    title: 'Bleak House',
    author: 'Charles Dickens',
    added: '2026-05-10',
    sources: ['goodreads'],
    pages: 1000,
  },
];
const prices = {
  books: [
    {
      book_id: 'ulysses',
      title: 'Ulysses',
      author: 'James Joyce',
      price: 9.99,
      date: '2026-03-01',
    },
    // bought and on a shelf: one book
    {
      book_id: 'kim-copy',
      title: 'Kim',
      author: 'Rudyard Kipling',
      price: 1.5,
      date: '2025-02-01',
    },
    { book_id: 'r29', title: 'Read 29', author: 'A', price: 2, date: '2025-07-01' },
  ],
};
const data = { books, reads, daily, to_read: toRead, prices };

describe('the to-read pile', () => {
  it('gathers the pile from every source, once each, oldest first', () => {
    const pile = run<Pile>('to_read_pile', data);
    expect(pile.map((r) => [r.title, r.added, r.sources])).toEqual([
      ['Kim', '2024-01-02', ['moonplus', 'goodreads', 'bought']],
      ['Ulysses', '2026-03-01', ['bought']],
      ['Bleak House', '2026-05-10', ['goodreads']],
      ['Opened Once', '2026-06-01', ['moonplus']],
    ]);
    // lengths: from pages, else the typical finished book
    expect(pile.find((r) => r.title === 'Bleak House')).toMatchObject({
      words: 275_000,
      estimated: true,
    });
    expect(pile.find((r) => r.title === 'Kim')).toMatchObject({
      words: 50_000,
      price: 1.5,
      in_library: false,
    });
    expect(pile.find((r) => r.title === 'Opened Once')!.in_library).toBe(true);
  });

  it('still stands without prices or a to-read file (older libraries, money hidden)', () => {
    const pile = run<Pile>('to_read_pile', { ...data, to_read: [], prices: [] });
    expect(pile.map((r) => r.title)).toEqual(['Opened Once']);
  });

  it('works out its size, age, time to read and whether it grows', () => {
    const [s] = run<Stats>('to_read_stats', data);
    expect(s).toMatchObject({ books: 4, words: 425_000, wpm: 250, mins_per_day: 30 });
    // 425k words at 250 wpm = 28.3 hours; at 30 minutes a day, 57 days
    expect(s.hours).toBe(28);
    expect(s.days).toBe(57);
    expect(s.oldest).toMatchObject({ title: 'Kim', age_days: 910 });
    expect(s.median_age_days).toBe(121);
    // 12 books finished in the last 12 months; added: those 12 (started off the pile) + 3 on it
    expect(s).toMatchObject({ finished_12m: 12, added_12m: 15, net_12m: 3 });
    expect(s.years_to_clear).toBe(0.3);
    expect(s.months).toHaveLength(24);
    expect(s.buckets.find((b) => b.label === 'Over 2 years')!.books).toBe(1);
    expect(s.sources).toEqual([
      expect.objectContaining({ source: 'goodreads', books: 2 }),
      expect.objectContaining({ source: 'moonplus', books: 2 }),
      expect.objectContaining({ source: 'bought', books: 2 }),
    ]);
  });
});

describe('your own want-to-read list (BOO-102)', () => {
  const mine = [
    ...toRead,
    {
      book_id: 'mine:lorna-doone',
      title: 'Lorna Doone',
      author: 'R. D. Blackmore',
      added: '2026-06-01',
      sources: ['mine'],
      pages: 640,
      want_id: 'mine:lorna-doone',
      note: 'second-hand',
    },
  ];

  it('is on the pile, keeps its list id and note, and counts as its own source', () => {
    const pile = run<Pile & { want_id: string | null; note: string }>('to_read_pile', {
      ...data,
      to_read: mine,
    });
    expect(pile.find((r) => r.title === 'Lorna Doone')).toMatchObject({
      sources: ['mine'],
      want_id: 'mine:lorna-doone',
      note: 'second-hand',
      words: 176_000,
    });
    expect(pile.find((r) => r.title === 'Kim')).toMatchObject({ want_id: null, note: '' });
    const [s] = run<Stats>('to_read_stats', { ...data, to_read: mine });
    expect(s.sources[0]).toEqual({ source: 'mine', label: 'On your list', books: 1 });
  });
});
