import {
  ABANDON,
  BOOKS,
  CURRENT,
  type DemoBook,
  fileName,
  PAUSE,
  REREADS,
  SPEED,
  STALLING,
  STRAY,
  STYLE,
  STYLE_ODDS,
  type Style,
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

/** Shuffles the books, keeping each series in order; a few re-reads, and the book on the go last. */
function order(rng: Random): DemoBook[] {
  const singles = BOOKS.filter(
    (b) => !b[4] && b[0] !== CURRENT && b[0] !== STALLING && !REREADS.includes(b[0]),
  );
  const series = new Map<string, DemoBook[]>();
  for (const b of BOOKS) {
    if (b[4]) series.set(b[4], [...(series.get(b[4]) ?? []), b]);
  }
  const units = [...singles.map((b) => [b]), ...series.values()];
  rng.shuffle(units);
  const out = units.flat();
  REREADS.forEach((title, i) => {
    const book = BOOKS.find((b) => b[0] === title)!;
    out.splice(Math.floor((out.length * (i + 1)) / 14), 0, book); // first read early on...
    out.splice(Math.floor(out.length * (0.8 + i * 0.05)), 0, book); // ...and again years later
  });
  out.push(BOOKS.find((b) => b[0] === CURRENT)!);
  return out;
}

function pickStyle(rng: Random, genre: string): Style {
  const [devour, slow, stopstart] = STYLE_ODDS[genre] ?? [0, 0, 0];
  const r = rng.random();
  return r < devour
    ? 'devour'
    : r < devour + slow
      ? 'slow'
      : r < devour + slow + stopstart
        ? 'stopstart'
        : 'steady';
}

/** Day-by-day reading of the books in order: {file: days}, and how many days that took. */
export function simulate(rng: Random): { log: Map<string, DemoDay[]>; days: number } {
  const log = new Map<string, DemoDay[]>();
  const seen = new Set<string>();
  let day = 0;
  const queue = order(rng);
  queue.forEach(([title, author, genre, , , , words], i) => {
    const file = fileName(title, author);
    const stop = title === CURRENT ? 38.0 : (ABANDON[title] ?? 100.0);
    const again = seen.has(title);
    seen.add(title);
    const wpm = SPEED[genre] * rng.uniform(0.85, 1.18) * (again ? 1.15 : 1);
    const style = STYLE[title] ?? pickStyle(rng, genre);
    const [chance, length] = {
      devour: [1.12, 1.9],
      slow: [0.85, 0.5],
      stopstart: [1, 1],
      steady: [1, 1],
    }[style];
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
      if (rng.random() > (weekend ? 0.86 : 0.72) * chance) continue;
      if (style === 'stopstart' && rng.random() < 0.2) day += rng.randint(4, 12); // put down for a week or so
      // a sag in the middle and a sprint for the last fifth
      const at = done / words,
        pull = at >= 0.8 ? 1.6 : at >= 0.35 && at < 0.6 ? 0.85 : 1;
      let minutes = Math.max(6.0, rng.lognormal(weekend ? 3.65 : 3.3, 0.45) * length * pull);
      let w = Math.floor(minutes * wpm * rng.uniform(0.85, 1.15));
      if (done + w > words) {
        minutes = Math.max(3, (minutes * (words - done)) / w); // the last day stops at the end
        w = words - done;
      }
      done += w;
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
  stalling(log, day, new Random(rng.randint(1, 1e9)));
  return { log, days: day };
}

/**
 * A second book on the go that's going the way given-up books go: read steadily for a few
 * weeks alongside the others, then slower, with longer and longer breaks, and not opened for
 * the last ten days or so. It has its own random numbers, so the rest of the history is as it was.
 */
function stalling(log: Map<string, DemoDay[]>, end: number, rng: Random): void {
  const [title, author, genre, , , , words] = BOOKS.find((b) => b[0] === STALLING)!;
  const wpm = SPEED[genre] * rng.uniform(0.9, 1.05);
  const entries: DemoDay[] = [];
  let day = end - 95,
    done = 0;
  // most days for four weeks, then breaks that keep growing
  const gaps = [0, 1, 0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 2, 0, 1, 0, 1, 3, 4, 5, 7, 9, 12];
  for (const gap of gaps) {
    day += gap + 1;
    const late = gap >= 3;
    const minutes = round1(Math.max(6, rng.lognormal(late ? 2.3 : 2.8, 0.35)));
    const w = Math.floor(minutes * wpm * rng.uniform(0.85, 1.15));
    done += w;
    entries.push({ day, minutes, words: w, progress: round1((done / words) * 100) });
  }
  log.set(fileName(title, author), entries);
}
