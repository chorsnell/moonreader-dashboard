/**
 * A made-up TV and film history for the demo, written as a Netflix ViewingActivity.csv so it
 * goes through the real import. The films are silent-era and mid-century classics; the shows
 * are invented (two are imagined adaptations of books in the demo library).
 */
import type { MediaCatalogue } from '../media/media.types';
import type { AbsCache, AbsSession } from '../media/sources/audiobookshelf';
import { Random } from './random';

type Style = 'binge' | 'steady' | 'weekly';

interface DemoShow {
  title: string;
  creator: string;
  genre: string;
  subgenre: string;
  year: number;
  runtime: number;
  /** Episodes per season. */
  seasons: number[];
  style: Style;
  /** Season number -> share of it watched before giving up. */
  drop?: Record<number, number>;
  /** Watch season 1 again near the end. */
  rewatch?: boolean;
  limited?: boolean;
  /** Its last season is the one on the go when the history ends. */
  current?: boolean;
}

interface DemoFilm {
  title: string;
  year: number;
  creator: string;
  genre: string;
  subgenre: string;
  runtime: number;
}

// prettier-ignore
export const DEMO_SHOWS: DemoShow[] = [
  { title: 'Copper Valley', creator: 'Maren Holt', genre: 'Drama', subgenre: 'Mystery', year: 2021, runtime: 52, seasons: [8, 8, 10, 10], style: 'binge' },
  { title: 'The Lantern Society', creator: 'Dev Okafor', genre: 'Comedy', subgenre: 'Sitcom', year: 2020, runtime: 28, seasons: [10, 10, 12], style: 'steady', rewatch: true },
  { title: 'Night Ferry', creator: 'Ines Laurent', genre: 'Crime', subgenre: 'Thriller', year: 2022, runtime: 58, seasons: [6, 6], style: 'binge', drop: { 2: 0.5 } },
  { title: 'Kitchen Brigade', creator: 'Sol Marchetti', genre: 'Reality', subgenre: 'Cooking', year: 2023, runtime: 45, seasons: [12], style: 'steady', drop: { 1: 0.4 } },
  { title: 'Glass Harbour', creator: 'Ruth Achebe', genre: 'Sci-Fi & Fantasy', subgenre: 'Drama', year: 2022, runtime: 48, seasons: [9, 9, 9], style: 'weekly', drop: { 3: 0.34 }, current: true },
  { title: 'Fieldwork', creator: 'Tomas Lind', genre: 'Documentary', subgenre: 'Nature', year: 2021, runtime: 50, seasons: [6], style: 'steady' },
  { title: 'The Understudies', creator: 'Priya Nandakumar', genre: 'Comedy', subgenre: 'Drama', year: 2019, runtime: 30, seasons: [8, 8, 8, 8], style: 'binge', drop: { 4: 0.6 } },
  { title: 'The Moonstone', creator: 'Hal Brennan', genre: 'Mystery', subgenre: 'Period Drama', year: 2023, runtime: 60, seasons: [5], style: 'binge', limited: true },
  { title: 'Middlemarch', creator: 'Clara Voss', genre: 'Drama', subgenre: 'Period Drama', year: 2024, runtime: 55, seasons: [7], style: 'weekly', limited: true },
  { title: 'Small Hours', creator: 'Aoife Mallon', genre: 'Drama', subgenre: 'Romance', year: 2020, runtime: 44, seasons: [10, 10], style: 'steady' },
  { title: 'Northbound', creator: 'Jonas Eide', genre: 'Documentary', subgenre: 'Travel', year: 2019, runtime: 47, seasons: [6, 6, 6], style: 'steady' },
  { title: 'Saltmarsh', creator: 'Bea Okonjo', genre: 'Crime', subgenre: 'Mystery', year: 2024, runtime: 56, seasons: [6, 6], style: 'binge' },
];

// prettier-ignore
export const DEMO_FILMS: DemoFilm[] = [
  { title: 'Metropolis', year: 1927, creator: 'Fritz Lang', genre: 'Science Fiction', subgenre: 'Drama', runtime: 148 },
  { title: 'Nosferatu', year: 1922, creator: 'F. W. Murnau', genre: 'Horror', subgenre: 'Fantasy', runtime: 94 },
  { title: 'The General', year: 1926, creator: 'Buster Keaton', genre: 'Comedy', subgenre: 'Action', runtime: 78 },
  { title: 'Sherlock Jr.', year: 1924, creator: 'Buster Keaton', genre: 'Comedy', subgenre: 'Mystery', runtime: 45 },
  { title: 'The Cabinet of Dr. Caligari', year: 1920, creator: 'Robert Wiene', genre: 'Horror', subgenre: 'Mystery', runtime: 76 },
  { title: 'The Kid', year: 1921, creator: 'Charlie Chaplin', genre: 'Comedy', subgenre: 'Drama', runtime: 68 },
  { title: 'His Girl Friday', year: 1940, creator: 'Howard Hawks', genre: 'Comedy', subgenre: 'Romance', runtime: 92 },
  { title: 'Detour', year: 1945, creator: 'Edgar G. Ulmer', genre: 'Crime', subgenre: 'Thriller', runtime: 68 },
  { title: 'D.O.A.', year: 1950, creator: 'Rudolph Maté', genre: 'Crime', subgenre: 'Thriller', runtime: 83 },
  { title: 'Carnival of Souls', year: 1962, creator: 'Herk Harvey', genre: 'Horror', subgenre: 'Mystery', runtime: 78 },
  { title: 'Charade', year: 1963, creator: 'Stanley Donen', genre: 'Thriller', subgenre: 'Romance', runtime: 113 },
  { title: 'Night of the Living Dead', year: 1968, creator: 'George A. Romero', genre: 'Horror', subgenre: 'Thriller', runtime: 96 },
  { title: 'The Lost World', year: 1925, creator: 'Harry O. Hoyt', genre: 'Adventure', subgenre: 'Science Fiction', runtime: 93 },
  { title: 'The Phantom of the Opera', year: 1925, creator: 'Rupert Julian', genre: 'Horror', subgenre: 'Romance', runtime: 93 },
  { title: 'Dr. Jekyll and Mr. Hyde', year: 1920, creator: 'John S. Robertson', genre: 'Horror', subgenre: 'Drama', runtime: 79 },
  { title: 'The Three Musketeers', year: 1921, creator: 'Fred Niblo', genre: 'Adventure', subgenre: 'Action', runtime: 120 },
  { title: 'Treasure Island', year: 1920, creator: 'Maurice Tourneur', genre: 'Adventure', subgenre: 'Family', runtime: 60 },
  { title: 'The Prisoner of Zenda', year: 1922, creator: 'Rex Ingram', genre: 'Adventure', subgenre: 'Romance', runtime: 113 },
  { title: 'Peter Pan', year: 1924, creator: 'Herbert Brenon', genre: 'Fantasy', subgenre: 'Family', runtime: 105 },
  { title: 'Safety Last!', year: 1923, creator: 'Fred C. Newmeyer', genre: 'Comedy', subgenre: 'Action', runtime: 70 },
  { title: 'The Gold Rush', year: 1925, creator: 'Charlie Chaplin', genre: 'Comedy', subgenre: 'Adventure', runtime: 95 },
  { title: 'The Hunchback of Notre Dame', year: 1923, creator: 'Wallace Worsley', genre: 'Drama', subgenre: 'Romance', runtime: 102 },
  { title: 'Scarlet Street', year: 1945, creator: 'Fritz Lang', genre: 'Crime', subgenre: 'Drama', runtime: 102 },
  { title: 'The Little Shop of Horrors', year: 1960, creator: 'Roger Corman', genre: 'Comedy', subgenre: 'Horror', runtime: 72 },
];

/** Adaptations whose titles differ from the book's (the rest match by title). */
const ADAPTS: Record<string, string> = {
  Nosferatu: 'Dracula',
  'Dr. Jekyll and Mr. Hyde': 'Strange Case of Dr Jekyll and Mr Hyde',
};

/** The media catalogue the demo writes: genres, creators, years and episode counts. */
export function demoMediaCatalogue(): MediaCatalogue {
  const out: MediaCatalogue = {};
  for (const s of DEMO_SHOWS) {
    out[s.title.toLowerCase()] = {
      creator: s.creator,
      genre: s.genre,
      subgenre: s.subgenre,
      year: s.year,
      runtime: s.runtime,
      episodes: Object.fromEntries(s.seasons.map((n, i) => [String(i + 1), n])),
    };
  }
  for (const f of DEMO_FILMS) {
    out[f.title.toLowerCase()] = {
      ...(ADAPTS[f.title] ? { book: ADAPTS[f.title] } : {}),
      creator: f.creator,
      genre: f.genre,
      subgenre: f.subgenre,
      year: f.year,
      runtime: f.runtime,
    };
  }
  return out;
}

// prettier-ignore
const EPISODE_WORDS = [
  'Arrival', 'The Letter', 'Low Tide', 'Old Debts', 'The Visitor', 'Fault Lines', 'Crossing',
  'Smoke', 'The Long Night', 'Homecoming', 'Static', 'Second Chances', 'Lanterns', 'The Archive',
  'Undertow', 'First Light', 'Signals', 'The Map Room', 'Thaw', 'Last Orders',
];

interface Project {
  kind: 'season' | 'film';
  show?: DemoShow;
  season?: number;
  film?: DemoFilm;
  next: number;
  stopAt: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hms = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const utc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const quote = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Evenings of watching from `firstDay` (days since 1970) for `days` days. Busy reading days
 * (`readingMinutes`, by day index) leave less room for TV, so the cross-media views have
 * something to find. Returns the CSV text.
 */
export function simulateNetflix(
  seed: number,
  firstDay: number,
  days: number,
  readingMinutes: Map<number, number>,
): string {
  const rng = new Random(seed * 31 + 5);
  const projects: Project[] = [];
  for (const show of DEMO_SHOWS) {
    show.seasons.forEach((eps, i) => {
      const season = i + 1;
      const drop = show.drop?.[season];
      projects.push({
        kind: 'season',
        show,
        season,
        next: 1,
        stopAt: drop ? Math.max(1, Math.round(eps * drop)) : eps,
      });
    });
  }
  // shows in season order, mixed with films, spread over the whole history
  const queue: Project[] = [];
  const byShow = new Map<string, Project[]>();
  for (const p of projects) byShow.set(p.show!.title, [...(byShow.get(p.show!.title) ?? []), p]);
  const lanes = [...byShow.values()];
  rng.shuffle(lanes);
  const films = DEMO_FILMS.map((film): Project => ({ kind: 'film', film, next: 1, stopAt: 1 }));
  rng.shuffle(films);
  while (lanes.some((l) => l.length) || films.length) {
    const lane = lanes.filter((l) => l.length);
    const seasonsLeft = lane.reduce((n, l) => n + l.length, 0);
    if (rng.random() < seasonsLeft / (seasonsLeft + films.length))
      queue.push(rng.pick(lane).shift()!);
    else if (films.length) queue.push(films.shift()!);
  }
  const now = queue.findIndex((p) => p.show?.current && p.season === p.show.seasons.length);
  if (now >= 0) queue.push(...queue.splice(now, 1));
  const favourite = projects.find((p) => p.show?.rewatch && p.season === 1);
  if (favourite) {
    // a re-watch of a favourite, near the end
    queue.splice(Math.floor(queue.length * 0.85), 0, { ...favourite, next: 1 });
  }

  const rows: string[] = [
    'Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country',
  ];
  const add = (
    profile: string,
    start: Date,
    played: number,
    title: string,
    supp = '',
    device = 'Smart TV',
    bookmark = played,
  ) =>
    rows.push(
      [
        profile,
        utc(start),
        hms(played),
        '',
        quote(title),
        supp,
        device,
        hms(bookmark),
        'Not latest view',
        'GB (United Kingdom)',
      ].join(','),
    );

  // each show or film waits for its turn, so the history spreads over the whole span
  const turn = (i: number) => Math.floor((i * (days - 21)) / (queue.length - 1));
  let qi = 0;
  let lastWeekly = -99;
  let active: Project[] = [];
  for (let day = 0; day < days && (qi < queue.length || active.length); day++) {
    const date = new Date((firstDay + day) * 86_400_000);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 || date.getUTCDay() === 5;
    // a big reading week leaves less time for TV
    const monday = day - ((date.getUTCDay() + 6) % 7);
    let weekReading = 0;
    for (let d = monday; d < monday + 7; d++) weekReading += readingMinutes.get(d) ?? 0;
    const chance =
      (weekend ? 0.62 : 0.4) * (weekReading > 150 ? 0.2 : weekReading > 60 ? 0.6 : 1.5);
    while (active.length < 2 && qi < queue.length && turn(qi) <= day)
      active.push({ ...queue[qi++] });
    if (rng.random() > chance) continue;
    let at = new Date(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      rng.randint(18, 21),
      rng.randint(0, 59),
    );
    const p = rng.random() < 0.7 ? active[0] : (active[1] ?? active[0]);
    if (!p) continue;
    if (p.kind === 'film') {
      const f = p.film!;
      const split = rng.random() < 0.15;
      const first = split ? f.runtime * rng.uniform(0.3, 0.6) : f.runtime * 0.97;
      add('You', at, first * 60, f.title, '', rng.pick(['Smart TV', 'Smart TV', 'Laptop']));
      if (split) {
        const later = new Date(at.getTime() + 86_400_000);
        add(
          'You',
          later,
          (f.runtime * 0.97 - first) * 60,
          f.title,
          '',
          'Smart TV',
          f.runtime * 0.97 * 60,
        );
      }
      active = active.filter((a) => a !== p);
      continue;
    }
    const show = p.show!;
    if (show.style === 'weekly' && day - lastWeekly < 6) continue;
    const count =
      show.style === 'binge'
        ? rng.randint(2, weekend ? 5 : 3)
        : show.style === 'steady'
          ? rng.randint(1, 2)
          : 1;
    if (show.style === 'weekly') lastWeekly = day;
    for (let k = 0; k < count && p.next <= p.stopAt; k++) {
      const no = p.next++;
      const label = show.limited ? 'Limited Series' : `Season ${p.season}`;
      const title = `${show.title}: ${label}: ${EPISODE_WORDS[(no * 7 + (p.season ?? 1) * 3 + show.title.length) % EPISODE_WORDS.length]}`;
      if (rng.random() < 0.08) add('You', at, 40, title, 'HOOK'); // a preview before the episode
      const dropped = no === p.stopAt && p.stopAt < show.seasons[(p.season ?? 1) - 1];
      const played =
        show.runtime * 60 * (dropped ? rng.uniform(0.2, 0.5) : rng.uniform(0.93, 0.99));
      add('You', at, played, title, '', rng.pick(['Smart TV', 'Smart TV', 'Smart TV', 'Phone']));
      at = new Date(at.getTime() + (played + rng.randint(30, 300)) * 1000);
    }
    if (p.next > p.stopAt) {
      active = active.filter((a) => a !== p);
    }
    // someone else on the account: not imported
    if (rng.random() < 0.1) add('Family', at, 25 * 60, 'Cartoon Hour: Season 1: Bubbles');
  }
  return rows.join('\n') + '\n';
}

// prettier-ignore
const DEMO_AUDIOBOOKS: [title: string, author: string, genre: string, hours: number, year: number][] = [
  ['The Adventures of Tom Sawyer', 'Mark Twain', 'Adventure', 7.5, 1876],
  ['The Jungle Book', 'Rudyard Kipling', 'Classics', 6, 1894],
  ['Heart of Darkness', 'Joseph Conrad', 'Classics', 4, 1899],
  ['The Wind in the Willows', 'Kenneth Grahame', 'Fantasy', 6.5, 1908],
];

/**
 * A few audiobooks heard on the commute, as Audiobookshelf listening sessions (what the
 * Audiobookshelf pull would have cached); the last one is still going.
 */
export function simulateAudiobookshelf(seed: number, firstDay: number, days: number): AbsCache {
  const rng = new Random(seed * 17 + 3);
  const sessions: AbsSession[] = [];
  DEMO_AUDIOBOOKS.forEach(([title, author, genre, hours, year], b) => {
    const last = b === DEMO_AUDIOBOOKS.length - 1;
    let day = last ? days - 30 : Math.floor(((b + 0.5) / DEMO_AUDIOBOOKS.length) * days);
    const duration = hours * 3600;
    const stop = last ? duration * 0.45 : duration;
    let at = 0;
    while (at < stop && day < days - 1) {
      const date = new Date((firstDay + day) * 86_400_000);
      const weekday = date.getUTCDay() >= 1 && date.getUTCDay() <= 5;
      if (weekday && rng.random() < 0.8) {
        const listened = Math.min(stop - at, rng.randint(22, 48) * 60);
        at += listened;
        const start = new Date(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          8,
          rng.randint(0, 25),
        );
        sessions.push({
          id: `ls_${b}_${day}`,
          libraryItemId: `li_demo_${b}`,
          mediaType: 'book',
          displayTitle: title,
          displayAuthor: author,
          mediaMetadata: { title, genres: [genre], series: [], publishedYear: String(year) },
          duration,
          timeListening: listened,
          currentTime: at,
          startedAt: start.getTime(),
          deviceInfo: { clientName: 'Audiobookshelf app' },
        });
      }
      day++;
    }
  });
  return { sessions, pulled: null };
}
