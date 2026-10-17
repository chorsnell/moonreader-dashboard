/**
 * Friendlier views over one audience's stats: a year and an author, built from the calcs and
 * the data files as that audience gets them, so they never show more than the page would.
 */
import type { StatsSet } from './stats.service';

type Row = Record<string, unknown>;

const rowsOf = (set: StatsSet, id: string): Row[] => {
  const v = set.rows[id] ?? set.inputs.get(id);
  return Array.isArray(v) ? (v as Row[]) : [];
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A year in reading: its per-year totals, its year-in-review row and the reads finished. */
export function yearSummary(set: StatsSet, year: number): Row | null {
  const totals = rowsOf(set, 'per_year').find((r) => r.year === year) ?? null;
  const review = rowsOf(set, 'wrapped').find((r) => r.year === year) ?? null;
  const finished = rowsOf(set, 'reads')
    .filter((r) => r.finished === true && str(r.end).slice(0, 4) === String(year))
    .sort((a, b) => (str(a.end) < str(b.end) ? -1 : str(a.end) > str(b.end) ? 1 : 0));
  if (!totals && !review && !finished.length) return null;
  return { year, generated: set.generated, totals, review, finished };
}

/** Everything read by one author (matched ignoring case), with totals. */
export function authorSummary(set: StatsSet, name: string): Row | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const mine = (r: Row) => str(r.author).trim().toLowerCase() === want;
  const books = rowsOf(set, 'books').filter(mine);
  if (!books.length) return null;
  const ids = new Set(books.map((b) => b.id));
  const reads = rowsOf(set, 'reads').filter((r) => ids.has(r.book_id));
  const genres: Record<string, number> = {};
  for (const b of books) {
    const g = str(b.genre) || 'Untagged';
    genres[g] = (genres[g] ?? 0) + 1;
  }
  const dates = (k: string) =>
    books
      .map((b) => str(b[k]))
      .filter(Boolean)
      .sort();
  const first = dates('first_read');
  const last = dates('last_read');
  return {
    author: str(books[0].author),
    generated: set.generated,
    totals: {
      books: books.length,
      finished: books.filter((b) => b.status === 'finished').length,
      reads: reads.length,
      hours: Math.round(books.reduce((a, b) => a + num(b.hours), 0) * 10) / 10,
      words: books.reduce((a, b) => a + num(b.words), 0),
      first_read: first[0] ?? null,
      last_read: last[last.length - 1] ?? null,
      genres,
    },
    books,
    reads,
  };
}
