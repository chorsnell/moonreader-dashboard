import { toCsv } from '../imports/csv';
import { BOOKS, fileName, ISBN } from './demo-books';
import { Random } from './random';
import type { DemoDay } from './simulate';

/** Books read on paper: in the Goodreads export but not in the Moon+ backup. [title, author, shelves, rating, where in the history (0..1)] */
const PAPER: [string, string, string, number, number][] = [
  [
    'The Valley of Fear (Sherlock Holmes, #7)',
    'Arthur Conan Doyle',
    'mystery, paperbacks',
    4,
    0.18,
  ],
  ['Northanger Abbey', 'Jane Austen', 'classics, paperbacks', 4, 0.33],
  ['The Turn of the Screw', 'Henry James', 'horror', 5, 0.47],
  ['The Wind in the Willows', 'Kenneth Grahame', 'fantasy, gifts', 3, 0.61],
  ['Heart of Darkness', 'Joseph Conrad', 'classics, paperbacks', 2, 0.74],
  ['The Scarlet Pimpernel', 'Baroness Orczy', 'adventure', 4, 0.9],
];

/** Genres the made-up reader tends to rate higher. */
const FAVOURITE = new Set(['Mystery', 'Classics']);

const DAY_MS = 86_400_000;

/**
 * A made-up Goodreads library export for the demo: ratings for most finished books (the
 * ones devoured rated higher), a few books read on paper, one on the go and one to read.
 */
export function demoGoodreadsCsv(
  log: Map<string, DemoDay[]>,
  firstDay: number,
  lastDay: number,
  seed: number,
): string {
  const rng = new Random(seed + 53);
  const date = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10).replace(/-/g, '/');
  const isbn = (title: string) => {
    const raw = (ISBN[title] ?? '').replace(/-/g, '');
    return raw.length === 13 ? ['', `="${raw}"`] : [`="${raw}"`, '=""'];
  };
  const rows: unknown[][] = [];
  let id = 1000;
  for (const [title, author, genre, , series, seriesNo] of BOOKS) {
    const days = log.get(fileName(title, author));
    if (!days?.length || days.at(-1)!.progress < 100) continue;
    if (rng.random() < 0.15) continue; // not every book gets rated
    // the main run of the read: from the last long break to the end
    const end = days.at(-1)!.day;
    let start = days[0].day;
    for (let i = 1; i < days.length; i++)
      if (days[i].day - days[i - 1].day > 60) start = days[i].day;
    const span = end - start + 1;
    const base = 2.9 + (span <= 14 ? 1.1 : span <= 30 ? 0.4 : 0) + (FAVOURITE.has(genre) ? 0.5 : 0);
    const rating = Math.max(1, Math.min(5, Math.round(rng.normal(base, 0.7))));
    // Goodreads puts the series in the title
    const shown = series ? `${title} (${series}, #${seriesNo})` : title;
    rows.push([
      id++,
      shown,
      author,
      ...isbn(title),
      rating,
      date(firstDay + end),
      date(firstDay + Math.max(0, start - rng.randint(5, 200))),
      genre === 'Classics' && rng.random() < 0.4 ? 'classics, favourites' : '',
      'read',
      1,
    ]);
  }
  const days = lastDay - firstDay;
  for (const [title, author, shelves, rating, at] of PAPER) {
    const end = firstDay + Math.round(days * at);
    rows.push([
      id++,
      title,
      author,
      '=""',
      '=""',
      rating,
      date(end),
      date(end - 40),
      shelves,
      'read',
      1,
    ]);
  }
  rows.push([
    id++,
    'Don Quixote',
    'Miguel de Cervantes',
    '=""',
    '=""',
    0,
    '',
    date(lastDay - 20),
    'classics, paperbacks',
    'currently-reading',
    0,
  ]);
  rows.push([
    id++,
    'Mansfield Park',
    'Jane Austen',
    '=""',
    '=""',
    0,
    '',
    date(lastDay - 90),
    'to-read',
    'to-read',
    0,
  ]);
  return toCsv(
    [
      'Book Id',
      'Title',
      'Author',
      'ISBN',
      'ISBN13',
      'My Rating',
      'Date Read',
      'Date Added',
      'Bookshelves',
      'Exclusive Shelf',
      'Read Count',
    ],
    rows,
  );
}
