import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BookHistory, Catalogue } from '../backup-import/reading-history.types';
import type { ImportedBook } from '../imports/imports.types';
import { buildContext, filterDataFile, PRESETS, DEFAULT_PRIVACY } from '../privacy/privacy';
import { bookMatcher, isSyntheticRow, readPageEntries } from './page-entries';
import {
  buildSessions,
  downsample,
  MAX_PROGRESS_POINTS,
  type PageEntry,
  type SessionBook,
  type SessionsFile,
  trimmedSeconds,
} from './sessions';

/** Unix seconds for a local time, so the tests hold in any time zone. */
const at = (local: string) => new Date(local).getTime() / 1000;
const NOW = new Date('2026-11-25T09:00:00');

const book = (id: string, extra: Partial<SessionBook> = {}): SessionBook => ({
  id,
  status: 'in_progress',
  progress: null,
  last_read: null,
  ...extra,
});

/** `count` pages in a row from `first`, `seconds` each. */
function read(
  first: number,
  count: number,
  from: string,
  { seconds = 60, total = 300, book_id = 'a', device = 'kobo' as string | null } = {},
): PageEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    book_id,
    page: first + i,
    start: at(from) + i * seconds,
    seconds,
    total,
    device,
  }));
}

describe('sessions', () => {
  it('splits at gaps over ten minutes, and reports each session', () => {
    const first = read(1, 5, '2026-11-20T20:00:00');
    // ends 20:05; ten minutes later is the same session, a second more is not
    const same = read(6, 1, '2026-11-20T20:15:00');
    const next = read(7, 2, '2026-11-20T20:26:01');
    const file = buildSessions([...next, ...first, ...same], [book('a')], NOW);
    expect(file.sessions).toEqual([
      {
        book_id: 'a',
        device: 'kobo',
        start: '2026-11-20T20:00:00',
        end: '2026-11-20T20:16:00',
        minutes: 6,
        pages: 6,
        first_page: 1,
        last_page: 6,
        total_pages: 300,
      },
      expect.objectContaining({ start: '2026-11-20T20:26:01', minutes: 2, first_page: 7 }),
    ]);
  });

  it('splits when the device changes', () => {
    const file = buildSessions(
      [
        ...read(1, 2, '2026-11-20T20:00:00'),
        ...read(3, 2, '2026-11-20T20:03:00', { device: 'boox' }),
      ],
      [book('a')],
      NOW,
    );
    expect(file.sessions.map((s) => s.device)).toEqual(['kobo', 'boox']);
  });

  it('adds up minutes by weekday and hour, splitting a page across the hour', () => {
    // Friday 20 November 2026
    const file = buildSessions(
      read(1, 1, '2026-11-20T20:59:00', { seconds: 180 }),
      [book('a')],
      NOW,
    );
    expect(file.time_of_day[4][20]).toBe(1);
    expect(file.time_of_day[4][21]).toBe(2);
    expect(file.books[0].time_of_day).toEqual([
      [4, 20, 1],
      [4, 21, 2],
    ]);
  });

  it('trims the quickest and slowest tenth from the reading speed', () => {
    expect(trimmedSeconds([...Array(18).fill(60), 1, 3000])).toBe(60);
    expect(trimmedSeconds(Array(9).fill(60))).toBeNull();
  });

  it('estimates what is left from the last 14 days', () => {
    const file = buildSessions(
      [
        // older than 14 days: counts for speed, not for pace
        ...read(1, 60, '2026-10-01T20:00:00'),
        ...read(61, 28, '2026-11-20T20:00:00'),
        // a page left open
        ...read(89, 1, '2026-11-20T20:28:00', { seconds: 3000 }),
      ],
      [book('a')],
      NOW,
    );
    expect(file.books[0]).toMatchObject({
      page: 89,
      pages_left: 211,
      minutes_per_page: 1,
      pages_per_hour: 60,
      // 78 minutes in 14 days; 211 minutes left takes 38 days
      eta: { minutes_left: 211, recent_minutes: 78, minutes_per_day: 5.6, finish: '2027-01-02' },
    });
  });

  it('keeps the speed right after a change of font size', () => {
    const file = buildSessions(
      [
        // half-size pages, 30 seconds each: a minute for each of today's
        ...read(1, 40, '2026-11-01T20:00:00', { seconds: 30, total: 600 }),
        ...read(21, 5, '2026-11-02T20:00:00'),
      ],
      [book('a')],
      NOW,
    );
    expect(file.books[0].minutes_per_page).toBe(1);
  });

  it('gives no finish date without recent reading, and no estimate once finished', () => {
    const old = read(1, 20, '2026-09-01T20:00:00');
    expect(buildSessions(old, [book('a')], NOW).books[0].eta).toEqual({
      minutes_left: 280,
      recent_minutes: 0,
      minutes_per_day: 0,
      finish: null,
    });
    const done = buildSessions(old, [book('a', { status: 'finished' })], NOW).books[0];
    expect(done).toMatchObject({ eta: null, pages_left: 0 });
  });

  it('takes progress made elsewhere since the last page turn', () => {
    const file = buildSessions(
      read(1, 20, '2026-11-01T20:00:00'),
      [book('a', { progress: 50, last_read: '2026-11-10' })],
      NOW,
    );
    expect(file.books[0]).toMatchObject({ page: 150, pages_left: 150 });
  });

  it('finds re-read pages and stalls, in the current page numbers', () => {
    const file = buildSessions(
      [
        // a smaller font before: 150 pages, so each is two of today's
        ...read(1, 5, '2026-11-01T20:00:00', { total: 150 }),
        ...read(11, 20, '2026-11-02T20:00:00'),
        ...read(31, 1, '2026-11-02T20:20:00', { seconds: 600 }),
        ...read(12, 3, '2026-11-03T20:00:00'),
        // a glance back isn't a re-read
        ...read(20, 1, '2026-11-03T20:03:00', { seconds: 6 }),
      ],
      [book('a')],
      NOW,
    );
    const b = file.books[0];
    expect(b.reread).toEqual({ pages: 3, ranges: [[12, 14, 2]] });
    expect(b.stalls).toEqual([{ page: 31, minutes: 10, date: '2026-11-02' }]);
    expect(b.progress[0]).toEqual(['2026-11-01T20:00', 0.7]);
  });

  it('says how far back each book and the whole file go', () => {
    const file = buildSessions(
      [
        ...read(1, 1, '2026-11-20T20:00:00'),
        ...read(1, 1, '2026-10-02T20:00:00', { book_id: 'b' }),
        ...read(1, 1, '2026-01-01T20:00:00', { book_id: 'unknown' }),
      ],
      [book('a'), book('b'), book('c')],
      NOW,
    );
    expect(file.coverage).toEqual({
      since: '2026-10-02',
      until: '2026-11-20',
      books: 2,
      sessions_since: '2026-10-02',
    });
    expect(file.books.map((b) => [b.book_id, b.since])).toEqual([
      ['a', '2026-11-20'],
      ['b', '2026-10-02'],
    ]);
    expect(buildSessions([], [], NOW).coverage.since).toBeNull();
  });

  it('downsamples long series, keeping both ends', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsample(xs, MAX_PROGRESS_POINTS);
    expect(out).toHaveLength(MAX_PROGRESS_POINTS);
    expect([out[0], out.at(-1)]).toEqual([0, 999]);
  });
});

describe('page entries', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pages-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  type Row = [book: number, page: number, start: number, seconds: number, total: number];
  function makeDb(name: string, books: [number, string, string, string][], rows: Row[]) {
    const db = new DatabaseSync(join(dir, name));
    db.exec(`
      create table book (id integer primary key, title text, authors text, pages integer, md5 text);
      create table page_stat_data (id_book integer, page integer, start_time integer,
        duration integer, total_pages integer);
    `);
    const b = db.prepare('insert into book values (?, ?, ?, 300, ?)');
    for (const [id, title, author, md5] of books) b.run(id, title, author, md5);
    const s = db.prepare('insert into page_stat_data values (?, ?, ?, ?, ?)');
    for (const r of rows) s.run(...r);
    db.close();
  }

  const library = [
    { id: 'alpha', title: 'Alpha', author: 'Ann Author', source_files: [], imports: {} },
    {
      id: 'renamed',
      title: 'Proper Name',
      author: 'Bo',
      source_files: [],
      imports: { koreader: 'md5b' },
    },
  ] as unknown as BookHistory[];
  const catalogue: Catalogue = { exclude: [], books: {} };
  const matcher = (imported: ImportedBook[] = []) => bookMatcher(library, imported, catalogue, {});
  const noon = at('2026-11-01T12:00:00');
  const t = at('2026-11-02T20:00:07');

  it('leaves out the Moon+ history the plugin copied in', async () => {
    expect(isSyntheticRow(noon, 3600, 100)).toBe(true);
    expect(isSyntheticRow(noon + 3600, 120, 100)).toBe(true);
    expect(isSyntheticRow(noon, 60, 300)).toBe(false);
    expect(isSyntheticRow(t, 60, 100)).toBe(false);
    makeDb(
      'device-kobo.sqlite3',
      [
        [1, 'Alpha', 'Ann Author', 'md5a'],
        [2, 'Alpha', 'Ann Author', 'moonplus:alpha'],
      ],
      [
        [1, 40, noon, 3600, 100],
        [1, 40, noon + 3600, 900, 100],
        [1, 5, t, 60, 300],
        [2, 7, t + 100, 60, 300],
        // over four hours: left open
        [1, 6, t + 200, 5 * 3600, 300],
      ],
    );
    const { entries } = await readPageEntries(dir, matcher());
    expect(entries).toEqual([
      { book_id: 'alpha', page: 5, start: t, seconds: 60, total: 300, device: 'kobo' },
    ]);
  });

  it('counts a page turn in two devices’ databases once', async () => {
    makeDb(
      'device-kobo.sqlite3',
      [[1, 'Alpha', 'Ann Author', 'md5a']],
      [
        [1, 5, t, 60, 300],
        [1, 6, t + 60, 60, 300],
      ],
    );
    // synced: has the first turn too, under another row id and spelling
    makeDb(
      'device-boox.sqlite3',
      [[7, 'ALPHA', 'Ann Author', 'md5a']],
      [
        [7, 5, t, 60, 300],
        [7, 9, t + 900, 60, 300],
      ],
    );
    makeDb(
      'webdav-statistics.sqlite3',
      [[1, 'Alpha', 'Ann Author', 'md5a']],
      [[1, 6, t + 60, 60, 300]],
    );
    await writeFile(join(dir, 'upload.sqlite3'), 'not a database');
    const { entries, unreadable } = await readPageEntries(dir, matcher());
    expect(entries.map((e) => [e.page, e.device]).sort()).toEqual([
      [5, null],
      [6, 'kobo'],
      [9, 'boox'],
    ]);
    expect(unreadable).toEqual(['upload.sqlite3']);
  });

  it('finds the dashboard book the import went to, and drops books it has none for', () => {
    const imported = [{ id: 'md5b', title: 'file_name', author: '' }] as ImportedBook[];
    const match = matcher(imported);
    expect(match({ rowId: '1', md5: 'md5b', title: 'file_name', author: '' })).toBe('renamed');
    expect(match({ rowId: '2', md5: 'x', title: 'Alpha', author: 'Ann Author' })).toBe('alpha');
    expect(match({ rowId: '3', md5: 'y', title: 'Nobody', author: 'N' })).toBeNull();
    const excluded = bookMatcher(
      library,
      imported,
      { ...catalogue, exclude: ['koreader:md5b'] },
      {},
    );
    expect(excluded({ rowId: '1', md5: 'md5b', title: 'file_name', author: '' })).toBeNull();
  });

  it('gives nothing without any statistics', async () => {
    expect(await readPageEntries(join(dir, 'none'), matcher())).toEqual({
      entries: [],
      unreadable: [],
    });
  });
});

describe('sessions.json for visitors', () => {
  const file = () =>
    buildSessions(
      [
        ...read(1, 20, '2026-11-20T20:00:00'),
        ...read(1, 20, '2026-10-02T20:00:00', { book_id: 'secret' }),
      ],
      [book('a'), book('secret')],
      NOW,
    );
  const seen = (policy = DEFAULT_PRIVACY.public, current: string[] = []) => {
    const ctx = buildContext(
      policy,
      { ...DEFAULT_PRIVACY, private_books: ['secret'], private_mode: 'anonymise' },
      current.map((id) => ({ id, status: 'in_progress', last_read: '2026-11-20' })),
      '2026-11-25',
    );
    return filterDataFile('sessions.json', file(), ctx) as SessionsFile;
  };

  it('leaves out private books, totals and device names', () => {
    const f = seen();
    expect(f.books.map((b) => b.book_id)).toEqual(['a']);
    expect(f.sessions.map((s) => [s.book_id, s.device])).toEqual([['a', null]]);
    expect(f.coverage).toMatchObject({ since: '2026-11-20', books: 1 });
    expect(f.time_of_day[4][20]).toBe(20);
    expect(JSON.stringify(f)).not.toContain('secret');
  });

  it('leaves out books being read now when that is hidden', () => {
    expect(seen({ ...PRESETS.everything, current: false }, ['a']).books).toEqual([]);
  });

  it('has no sessions or curves without exact days, and nothing without the diary', () => {
    const f = seen({ ...PRESETS.everything, streaks: false });
    expect(f.sessions).toEqual([]);
    expect(f.books[0].progress).toEqual([]);
    expect(f.coverage).toMatchObject({ since: '2026-11-16', sessions_since: null });
    expect(seen(PRESETS.taste)).toEqual([]);
  });
});
