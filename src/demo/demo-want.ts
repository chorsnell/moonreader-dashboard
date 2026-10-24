/**
 * The demo's own want-to-read list (BOO-102), as if the owner had added books on the To read
 * tab: a few found on Open Library, one typed in, one kept from the Goodreads to-read shelf
 * (so it shows both sources), and one shelf book hidden from the pile. The demo has no admin,
 * so only the "On your list" rows show. No notes: the static demo serves data/ unfiltered.
 */
import { dateFromEpochDays } from '../common/time';
import { emptyWant, type WantBook, type WantFile } from '../want-to-read/want-to-read';

type Entry = [
  title: string,
  author: string,
  genre: string,
  subgenre: string,
  series: string | null,
  no: number | null,
  pages: number | null,
  year: number | null,
  daysAgo: number,
  from: WantBook['from'],
];

const LIST: Entry[] = [
  [
    'Lorna Doone',
    'R. D. Blackmore',
    'Adventure',
    'Historical',
    null,
    null,
    640,
    1869,
    30,
    'search',
  ],
  [
    'North and South',
    'Elizabeth Gaskell',
    'Classics',
    'Victorian',
    null,
    null,
    452,
    1854,
    75,
    'search',
  ],
  ['Ivanhoe', 'Walter Scott', 'Adventure', 'Historical', null, null, 528, 1819, 240, 'search'],
  // carries on Kidnapped, which the demo has read
  [
    'Catriona',
    'Robert Louis Stevenson',
    'Untagged',
    'Untagged',
    'David Balfour',
    2,
    null,
    1893,
    8,
    'manual',
  ],
  // kept from the Goodreads to-read shelf
  [
    'Mansfield Park',
    'Jane Austen',
    'Untagged',
    'Untagged',
    null,
    null,
    null,
    null,
    90,
    'goodreads',
  ],
];

/** Shelf rows the owner hid, by book_id. The demo's Goodreads export has no Book Ids. */
const HIDDEN = ['goodreads:the voyage out'];

export function demoWant(lastDay: number): WantFile {
  const file = emptyWant();
  for (const [title, author, genre, subgenre, series, no, pages, year, ago, from] of LIST) {
    file.books.push({
      id: `mine:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title,
      author,
      series,
      series_no: no,
      isbn13: null,
      pages,
      published_year: year,
      work_id: null,
      genre,
      subgenre,
      note: '',
      added: dateFromEpochDays(lastDay - ago),
      from,
    });
  }
  file.hidden = HIDDEN;
  return file;
}
