import {
  ABANDON,
  BOOKS,
  CURRENT,
  type DemoBook,
  fileName,
  PAUSE,
  REREAD,
  SPEED,
  STRAY,
} from './demo-books';
import { Random } from './random';

/** One day of reading: days counted from the start of the history. */
export interface DemoDay {
  day: number;
  minutes: number;
  words: number;
  progress: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Shuffles the books, keeping each series in order; one re-read, and the book on the go last. */
function order(rng: Random): DemoBook[] {
  const singles = BOOKS.filter((b) => !b[4] && b[0] !== CURRENT && b[0] !== REREAD);
  const series = new Map<string, DemoBook[]>();
  for (const b of BOOKS) {
    if (b[4]) series.set(b[4], [...(series.get(b[4]) ?? []), b]);
  }
  const units = [...singles.map((b) => [b]), ...series.values()];
  rng.shuffle(units);
  const out = units.flat();
  const reread = BOOKS.find((b) => b[0] === REREAD)!;
  out.splice(Math.floor(out.length / 6), 0, reread); // first read early on...
  out.push(reread); // ...and again years later
  out.push(BOOKS.find((b) => b[0] === CURRENT)!);
  return out;
}

/** Day-by-day reading of the books in order: {file: days}, and how many days that took. */
export function simulate(rng: Random): { log: Map<string, DemoDay[]>; days: number } {
  const log = new Map<string, DemoDay[]>();
  let day = 0;
  const queue = order(rng);
  queue.forEach(([title, author, genre, , , , words], i) => {
    const file = fileName(title, author);
    const stop = title === CURRENT ? 38.0 : (ABANDON[title] ?? 100.0);
    const wpm = SPEED[genre] * rng.uniform(0.85, 1.18);
    let done = 0;
    const entries = log.get(file) ?? [];
    log.set(file, entries);
    if (title in STRAY && day > STRAY[title]) {
      entries.push({
        day: day - STRAY[title],
        minutes: 4.0,
        words: Math.floor(4 * wpm),
        progress: 0.3,
      });
    }
    let paused = !(title in PAUSE);
    for (;;) {
      const date = day;
      day += 1;
      if (rng.random() < 0.004) day += rng.randint(5, 14); // the odd holiday away from books
      const weekend = (date + 3) % 7 >= 5; // day 0 is a Thursday
      if (rng.random() > (weekend ? 0.86 : 0.72)) continue;
      const minutes = Math.max(6.0, rng.lognormal(weekend ? 3.65 : 3.3, 0.45));
      const w = Math.floor(minutes * wpm * rng.uniform(0.85, 1.15));
      done = Math.min(words, done + w);
      let progress = round1((done / words) * 100);
      if (!paused && progress >= PAUSE[title]) {
        paused = true;
        day += rng.randint(65, 80);
      }
      if (progress >= stop) {
        progress = stop >= 100 ? 100.0 : stop;
        entries.push({ day: date, minutes: round1(minutes), words: w, progress });
        break;
      }
      entries.push({ day: date, minutes: round1(minutes), words: w, progress });
    }
    if (i < queue.length - 1 && rng.random() < 0.3) day += rng.randint(1, 6); // a few days between books
  });
  return { log, days: day };
}
