/**
 * Two made-up friends for the demo, with tastes of their own: Ada devours mysteries, horror
 * and science fiction; Ben takes his time over long classics and non-fiction. Each has read
 * some of the demo's books (one of them alongside you: a buddy read, and the book you're on
 * now) and some you haven't. Their reading is simulated the way a share file would carry it.
 */
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  type LeaderboardStat,
  type Row,
  type ShareBundle,
} from '../friends/share';
import { Random } from './random';

/** title, author, genre, subgenre, words */
type ExtraBook = [string, string, string, string, number];

interface Plan {
  slug: string;
  name: string;
  seed: number;
  /** Words per minute. */
  wpm: number;
  /** Chance of reading on a given day while a book is on the go. */
  daily: number;
  /** Typical minutes per sitting (log-normal around this). */
  minutes: number;
  /** Books from your library they read too (by title). */
  overlap: string[];
  /** Books you haven't read. */
  extra: ExtraBook[];
  /** Star ratings for some of the books they finish; the rest get 3 to 5 from the title. */
  ratings?: Record<string, number>;
  /** Titles they gave up on, and where. */
  abandon: Record<string, number>;
  leaderboards: LeaderboardStat[];
  /** Followed on their own dashboard (federation) at this address. */
  url?: string;
  /** Their dashboard hasn't answered for this many days: their data stops then. */
  offline_days?: number;
}

/** A made-up rating from 3 to 5 stars, the same every build. */
function stars(title: string): number {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 997;
  return 3 + (h % 3);
}

export const FRIEND_PLANS: Plan[] = [
  {
    slug: 'ada',
    name: 'Ada',
    seed: 11,
    wpm: 330,
    daily: 0.86,
    minutes: 62,
    overlap: [
      'The Time Machine',
      'The War of the Worlds',
      'The Invisible Man',
      'A Study in Scarlet',
      'The Sign of the Four',
      'The Hound of the Baskervilles',
      'The Mysterious Affair at Styles',
      'The Thirty-Nine Steps',
      'Dracula',
      'Frankenstein',
      'Carmilla',
      'Strange Case of Dr Jekyll and Mr Hyde',
      'The Moonstone',
      'Treasure Island',
      'Moby-Dick',
    ],
    extra: [
      ['The Murder on the Links', 'Agatha Christie', 'Mystery', 'Detective', 57000],
      ['The Man Who Was Thursday', 'G. K. Chesterton', 'Mystery', 'Thriller', 58000],
      ['The Innocence of Father Brown', 'G. K. Chesterton', 'Mystery', 'Detective', 78000],
      ['The Valley of Fear', 'Arthur Conan Doyle', 'Mystery', 'Detective', 58000],
      ['The Return of Sherlock Holmes', 'Arthur Conan Doyle', 'Mystery', 'Detective', 110000],
      ['The Riddle of the Sands', 'Erskine Childers', 'Mystery', 'Spy', 105000],
      ['The Legend of Sleepy Hollow', 'Washington Irving', 'Horror', 'Gothic', 12000],
      ['The Lair of the White Worm', 'Bram Stoker', 'Horror', 'Gothic', 50000],
      ['The King in Yellow', 'Robert W. Chambers', 'Horror', 'Weird', 60000],
      ['The Machine Stops', 'E. M. Forster', 'Science Fiction', 'Dystopia', 12000],
      ['The First Men in the Moon', 'H. G. Wells', 'Science Fiction', 'Scientific Romance', 68000],
      [
        'From the Earth to the Moon',
        'Jules Verne',
        'Science Fiction',
        'Voyages Extraordinaires',
        55000,
      ],
    ],
    abandon: { 'Moby-Dick': 18, 'The Riddle of the Sands': 46 },
    ratings: { 'The Murder on the Links': 5, 'The Man Who Was Thursday': 4 },
    leaderboards: ['books', 'hours', 'speed', 'streak', 'words'],
  },
  {
    slug: 'ben',
    name: 'Ben',
    seed: 23,
    wpm: 205,
    daily: 0.62,
    minutes: 28,
    overlap: [
      'Pride and Prejudice',
      'Emma',
      'Persuasion',
      'Jane Eyre',
      'Wuthering Heights',
      'Great Expectations',
      'Middlemarch',
      'Anna Karenina',
      'The Picture of Dorian Gray',
      'A Christmas Carol',
      'Walden',
      'Meditations',
      'Narrative of the Life of Frederick Douglass',
      'The Time Machine',
    ],
    extra: [
      ['Northanger Abbey', 'Jane Austen', 'Classics', 'Regency', 77000],
      ['Mansfield Park', 'Jane Austen', 'Classics', 'Regency', 160000],
      ['Silas Marner', 'George Eliot', 'Classics', 'Victorian', 71000],
      ['Far from the Madding Crowd', 'Thomas Hardy', 'Classics', 'Victorian', 138000],
      ['A Room with a View', 'E. M. Forster', 'Classics', 'Edwardian', 66000],
      ['The Brothers Karamazov', 'Fyodor Dostoevsky', 'Classics', 'Russian', 364000],
      ['War and Peace', 'Leo Tolstoy', 'Classics', 'Russian', 587000],
      ['The Prince', 'Niccolò Machiavelli', 'Non-fiction', 'Philosophy', 31000],
      ['The Art of War', 'Sun Tzu', 'Non-fiction', 'Philosophy', 13000],
      ['Up from Slavery', 'Booker T. Washington', 'Non-fiction', 'Memoir', 76000],
      ['The Souls of Black Folk', 'W. E. B. Du Bois', 'Non-fiction', 'History', 72000],
    ],
    abandon: { 'War and Peace': 31, 'Wuthering Heights': 22 },
    ratings: { 'Silas Marner': 5, 'Mansfield Park': 4, 'The Brothers Karamazov': 3 },
    leaderboards: ['books', 'hours', 'days'],
    url: 'https://reading.ben.example',
    offline_days: 3,
  },
];

const DAY_MS = 86_400_000;
const iso = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);
const dayNo = (s: string) => Math.round(Date.parse(s.slice(0, 10)) / DAY_MS);
const round1 = (n: number) => Math.round(n * 10) / 10;
const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

interface Day {
  day: number;
  minutes: number;
  words: number;
  progress: number;
}

/** Day by day through one book from `start`, until `stop` % or the day `until`. */
function readBook(
  rng: Random,
  plan: Plan,
  words: number,
  start: number,
  stop: number,
  until: number,
  pace = 1,
): Day[] {
  const days: Day[] = [];
  const wpm = plan.wpm * rng.uniform(0.85, 1.15) * pace;
  let done = 0;
  for (let day = start; day <= until; day++) {
    if (days.length && rng.random() > plan.daily) continue;
    const at = done / words;
    const pull = at >= 0.8 ? 1.5 : at >= 0.35 && at < 0.6 ? 0.85 : 1;
    let minutes = Math.max(5, rng.lognormal(Math.log(plan.minutes), 0.45) * pull);
    let w = Math.floor(minutes * wpm);
    if (done + w > words) {
      minutes = Math.max(3, (minutes * (words - done)) / w);
      w = words - done;
    }
    done += w;
    let progress = round1((done / words) * 100);
    const last = progress >= stop;
    if (last) progress = stop >= 100 ? 100 : stop;
    days.push({ day, minutes: round1(minutes), words: w, progress });
    if (last) break;
  }
  return days;
}

/** Your reading the friends need to line theirs up with. */
export interface OwnerData {
  books: Row[];
  reads: Row[];
}

interface Book {
  title: string;
  author: string;
  genre: string;
  subgenre: string;
  series: string | null;
  series_no: number | null;
  isbn13: string | null;
  words: number;
}

/**
 * A friend's share bundle. `buddy`: a book you finished lately that they read alongside
 * you; `current`: the book you're reading now, which they started with you (a club read).
 */
export function simulateFriend(
  plan: Plan,
  owner: OwnerData,
  firstDay: number,
  lastDay: number,
  opts: { buddy?: string; current?: string; currentPace?: number } = {},
): ShareBundle {
  const rng = new Random(plan.seed);
  const mine = new Map(owner.books.map((b) => [String(b.title), b]));
  const fromMine = (title: string): Book | null => {
    const b = mine.get(title);
    if (!b) return null;
    return {
      title,
      author: String(b.author),
      genre: String(b.genre),
      subgenre: String(b.subgenre),
      series: (b.series as string | null) ?? null,
      series_no: (b.series_no as number | null) ?? null,
      // the same edition about half the time; otherwise matched by title and author
      isbn13: rng.random() < 0.5 ? ((b.isbn13 as string | null) ?? null) : null,
      // books.json has the words read so far: the whole book is that over the progress
      words: Math.max(
        10000,
        Math.round((Number(b.words) || 60000) * (100 / (Number(b.progress) || 100))),
      ),
    };
  };
  const special = new Set([opts.buddy, opts.current].filter(Boolean));
  const queue: Book[] = [
    ...plan.overlap.filter((t) => !special.has(t)).map(fromMine),
    ...plan.extra.map(([title, author, genre, subgenre, words]) => ({
      title,
      author,
      genre,
      subgenre,
      series: null,
      series_no: null,
      isbn13: null,
      words,
    })),
  ].filter((b): b is Book => b !== null);
  rng.shuffle(queue);

  // read in turn, with the spare time spread out as breaks between books
  const sims = queue.map((b) => ({
    book: b,
    days: readBook(rng, plan, b.words, 0, plan.abandon[b.title] ?? 100, 1e6),
  }));
  const reserve = 70; // the last weeks are for the books read alongside you
  const need = sims.reduce((a, s) => a + (s.days.at(-1)?.day ?? 0) + 1, 0);
  const spare = Math.max(0, lastDay - reserve - firstDay - need);
  const log: { book: Book; days: Day[] }[] = [];
  let day = firstDay + rng.randint(0, 20);
  for (const s of sims) {
    const shifted = s.days.map((d) => ({ ...d, day: d.day + day }));
    if (!shifted.length || shifted.at(-1)!.day > lastDay - reserve) break;
    log.push({ book: s.book, days: shifted });
    day = shifted.at(-1)!.day + 1 + Math.round((spare / sims.length) * rng.uniform(0.2, 1.8));
  }

  // the buddy read: started a day or two from when you started it
  const ownerRead = (title: string) =>
    owner.reads.filter((r) => r.title === title).sort((a, b) => (a.start! < b.start! ? 1 : -1))[0];
  if (opts.buddy) {
    const b = fromMine(opts.buddy);
    const r = ownerRead(opts.buddy);
    if (b && r) {
      const start = dayNo(String(r.start)) + rng.randint(-1, 2);
      log.push({
        book: { ...b, isbn13: (mine.get(b.title)?.isbn13 as string) ?? null },
        days: readBook(rng, plan, b.words, start, 100, lastDay),
      });
    }
  }
  if (opts.current) {
    const b = fromMine(opts.current);
    const r = ownerRead(opts.current);
    if (b && r) {
      const start = dayNo(String(r.start)) + rng.randint(0, 3);
      log.push({
        book: b,
        days: readBook(rng, plan, b.words, start, 99, lastDay, opts.currentPace),
      });
    }
  }

  const books: Row[] = [];
  const reads: Row[] = [];
  const daily: Row[] = [];
  for (const { book: b, days } of log) {
    if (!days.length) continue;
    const id = slug(b.title);
    const last = days.at(-1)!;
    const minutes = days.reduce((a, d) => a + d.minutes, 0);
    const finished = last.progress >= 99.5;
    const start = iso(days[0].day);
    const end = iso(last.day);
    books.push({
      id,
      title: b.title,
      author: b.author,
      series: b.series,
      series_no: b.series_no,
      genre: b.genre,
      subgenre: b.subgenre,
      isbn13: b.isbn13,
      isbn10: null,
      work_id: null,
      status: finished ? 'finished' : 'in_progress',
      progress: last.progress,
      hours: round1(minutes / 60),
      words: days.reduce((a, d) => a + d.words, 0),
      times_read: 1,
      first_read: start,
      last_read: end,
      // star ratings, as a Goodreads import would bring (BOO-79 weighs them)
      ...(finished ? { rating: plan.ratings?.[b.title] ?? stars(b.title) } : {}),
    });
    reads.push({
      read_id: `${id}#1`,
      book_id: id,
      title: b.title,
      author: b.author,
      genre: b.genre,
      subgenre: b.subgenre,
      series: b.series,
      read_no: 1,
      times_read: 1,
      start,
      end,
      days_read: days.length,
      hours: round1(minutes / 60),
      progress: last.progress,
      finished,
    });
    for (const d of days) {
      daily.push({
        date: iso(d.day),
        book_id: id,
        title: b.title,
        author: b.author,
        genre: b.genre,
        minutes: d.minutes,
        words: d.words,
        progress: d.progress,
      });
    }
  }
  reads.sort((a, b) => (String(a.start) < String(b.start) ? -1 : 1));
  daily.sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    profile: {
      name: plan.name,
      generated: `${iso(lastDay)}T21:00:00`,
      leaderboards: plan.leaderboards,
    },
    privacy: { hidden: ['money', 'highlights'], dates: 'day' },
    books,
    reads,
    daily,
  };
}
