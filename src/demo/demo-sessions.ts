/**
 * Made-up KOReader page turns for the demo's recent reading, as if those books had been read
 * on two e-readers, so the page-level views have a data/sessions.json to draw. They follow
 * the demo's days and minutes and don't change them.
 */
import {
  buildSessions,
  type PageEntry,
  type SessionBook,
  type SessionsFile,
} from '../sessions/sessions';
import { Random } from './random';

/** How much of the demo's history has page-level data. */
const DAYS = 120;
const DEVICES = ['kobo-libra-2-demo', 'boox-palma-demo'];

interface DailyRow {
  date: string;
  book_id: string;
  minutes: number | null;
  progress: number | null;
}

export function demoSessions(
  books: (SessionBook & { pages?: number | null })[],
  daily: DailyRow[],
  today: string,
  seed: number,
): SessionsFile {
  const rng = new Random(seed + 91);
  const from = new Date(Date.parse(today) - DAYS * 86_400_000).toISOString().slice(0, 10);
  const byId = new Map(books.map((b) => [b.id, b]));
  const at = new Map<string, number>();
  const entries: PageEntry[] = [];
  for (const d of daily) {
    const book = byId.get(d.book_id);
    if (!book) continue;
    const total = book.pages || 320;
    const had = at.get(d.book_id);
    const to = d.progress === null ? null : Math.max(1, Math.round((d.progress / 100) * total));
    if (to !== null) at.set(d.book_id, to);
    if (d.date < from || d.date >= today || to === null || !d.minutes) continue;
    const turns = Math.max(1, Math.round((d.minutes * 60) / 75));
    const first = had !== undefined && had < to ? had : Math.max(1, to - turns);
    // mostly evenings, some lunchtimes and early mornings
    const when = rng.random();
    const hour = when < 0.65 ? 20 + Math.floor(rng.random() * 3) : when < 0.85 ? 12 : 7;
    const [y, m, day] = d.date.split('-').map(Number);
    let t = new Date(y, m - 1, day, hour, Math.floor(rng.random() * 50)).getTime() / 1000;
    const device = DEVICES[rng.random() < 0.8 ? 0 : 1];
    let left = Math.round(d.minutes * 60);
    for (let i = 0; i < turns && left > 0; i++) {
      let page = Math.max(1, Math.round(first + ((to - first) * (i + 1)) / turns));
      // now and then a look back, or a page that takes a while
      if (rng.random() < 0.01) page = Math.max(1, page - 8);
      const stall = rng.random() < 0.008;
      const usual = (d.minutes * 60) / turns;
      const seconds =
        i === turns - 1
          ? left
          : Math.min(left, Math.max(8, Math.round(usual * (stall ? 5 : 0.6 + rng.random() * 0.7))));
      entries.push({ book_id: d.book_id, page, start: t, seconds, total, device });
      t += seconds;
      left -= seconds;
    }
  }
  return buildSessions(entries, books, new Date(`${today}T09:00:00`));
}
