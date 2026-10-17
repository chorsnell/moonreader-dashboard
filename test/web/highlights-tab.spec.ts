import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { WEB_DIR } from '../../src/paths';
import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/highlights-tab.js');

const book = (id: string, title: string, author = 'A. Writer', genre = 'Classics') => ({
  id,
  title,
  author,
  genre,
  series: null,
  series_no: null,
});
const hl = (id: number, book_id: string, text: string, extra: object = {}) => ({
  id,
  book_id,
  date: '2024-03-01',
  time: '2024-03-01T21:00:00',
  progress: 10,
  chapter: 1,
  text,
  note: null,
  colour: '#ffff00',
  kind: 'highlight',
  ...extra,
});
const books = [book('a', 'Alpha'), book('b', 'Beta', 'B. Author', 'Horror')];
const highlights = [
  hl(1, 'a', 'Later on', { progress: 80 }),
  hl(2, 'a', 'Early on', { progress: 5, note: 'mine', kind: 'note', date: '2023-01-02' }),
  hl(3, 'b', 'It was a dark night.', { date: '2025-05-05' }),
  hl(4, 'b', 'It was a DARK night', { date: '2026-01-01' }),
  hl(5, 'b', 'Chapter 3', { kind: 'bookmark' }),
  hl(6, 'gone', 'From a book no longer in the library'),
];
type Row = Record<string, unknown>;

describe('highlights tab calcs', () => {
  it('lists highlights and notes with their book, in book order, without bookmarks', () => {
    const rows = run<Row>('highlight_rows', { highlights, books });
    expect(rows.map((r) => r.id)).toEqual([2, 1, 3, 4]);
    expect(rows[0]).toMatchObject({ title: 'Alpha', author: 'A. Writer', year: 2023 });
  });

  it('ranks the most-highlighted books', () => {
    const rows = run<Row>('highlight_books', { highlights, books });
    expect(rows.map((r) => [r.book_id, r.count, r.notes, r.first, r.last])).toEqual([
      ['a', 2, 1, '2023-01-02', '2024-03-01'],
      ['b', 2, 0, '2025-05-05', '2026-01-01'],
    ]);
  });

  it('counts highlights per year', () => {
    expect(run('highlight_years', { highlights, books })).toEqual([
      { year: 2023, count: 1, books: 1 },
      { year: 2024, count: 1, books: 1 },
      { year: 2025, count: 1, books: 1 },
      { year: 2026, count: 1, books: 1 },
    ]);
  });

  it('finds a passage highlighted twice, whatever its case and punctuation', () => {
    const rows = run<Row>('highlight_repeats', { highlights, books });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      book_id: 'b',
      times: 2,
      text: 'It was a dark night.',
      dates: ['2025-05-05', '2026-01-01'],
    });
  });

  it('copes with no highlights', () => {
    expect(run('highlight_rows', { highlights: [], books })).toEqual([]);
    expect(run('highlight_repeats', { highlights: [], books })).toEqual([]);
  });
});

describe('highlights search', () => {
  type Search = {
    parse: (q: string) => string[];
    matches: (h: object, terms: string[]) => boolean;
    ranges: (s: string, terms: string[]) => [number, number][];
  };
  const store: Record<string, unknown> = {};
  const noop = () => undefined;
  const rh = new Proxy(store, {
    get: (t, k: string) => (k in t ? t[k] : noop),
    set: (t, k: string, v: unknown) => {
      t[k] = v;
      return true;
    },
  });
  runInContext(
    readFileSync(join(WEB_DIR, 'features/highlights-tab.js'), 'utf8'),
    createContext({
      rh,
      dash: { calc: noop, file: noop, onData: noop, data: () => ({ status: 'missing' }) },
      d3: { timeFormat: () => noop },
    }),
  );
  const s = store.highlightSearch as Search;
  const h = {
    text: 'Café society, “the best” of times',
    note: 'Re-read it',
    title: 'X',
    author: 'Émile Zola',
  };

  it('splits words and quoted phrases, folding case, accents and curly quotes', () => {
    expect(s.parse('  Cafe "the BEST"  zola ')).toEqual(['cafe', 'the best', 'zola']);
  });

  it('needs every term somewhere in the text, note, title or author', () => {
    expect(s.matches(h, s.parse('cafe emile'))).toBe(true);
    expect(s.matches(h, s.parse('re-read times'))).toBe(true);
    expect(s.matches(h, s.parse('cafe missing'))).toBe(false);
    expect(s.matches(h, [])).toBe(true);
  });

  it('marks matches in the original text', () => {
    const text = h.text;
    const r = s.ranges(text, s.parse('café "the best" time'));
    expect(r.map(([a, b]) => text.slice(a, b))).toEqual(['Café', 'the best', 'time']);
  });
});
