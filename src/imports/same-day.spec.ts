import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BookHistory } from '../backup-import/reading-history.types';
import { mergeStatsDbs } from '../koreader-sync/merge-stats';
import type { ImportedBook, ImportFile, ImportSource } from './imports.types';
import { readKoreader } from './koreader';
import { mergeImports } from './merge';

const DATE = '2026-11-20';
const at = (time: string) => Date.parse(`${DATE}T${time}Z`) / 1000;
/** [page, start_time, seconds, total_pages] */
type Entry = [number, number, number, number];
/** Ten real minutes in the evening. */
const evening: Entry[] = [[40, at('20:00:07'), 600, 300]];

let tmp: string;
let n = 0;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'same-day-'));
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

function statsDb(books: { title?: string; md5?: string; entries: Entry[] }[]): string {
  const path = join(tmp, `${++n}.sqlite3`);
  const db = new DatabaseSync(path);
  db.exec(`
    create table book (id integer primary key, title text, authors text, pages integer,
      series text, md5 text);
    create table page_stat_data (id_book integer, page integer, start_time integer,
      duration integer, total_pages integer, unique (id_book, page, start_time));
  `);
  books.forEach(({ title = 'Emma', md5 = 'abc', entries }, i) => {
    db.prepare('insert into book values (?, ?, ?, 300, null, ?)').run(
      i + 1,
      title,
      'Jane Austen',
      md5,
    );
    for (const e of entries) {
      db.prepare('insert into page_stat_data values (?, ?, ?, ?, ?)').run(i + 1, ...e);
    }
  });
  db.close();
  return path;
}

const moon = (): BookHistory => ({
  id: 'emma',
  title: 'Emma',
  author: 'Jane Austen',
  series: null,
  series_no: null,
  genre: 'Classics',
  subgenre: 'Romance',
  isbn13: null,
  isbn10: null,
  work_id: null,
  status: 'in_progress',
  progress: 10,
  total_minutes: 30,
  total_words: 6000,
  times_read: 1,
  first_read: DATE,
  last_read: DATE,
  reads: [
    {
      read_no: 1,
      start: DATE,
      end: DATE,
      days_read: 1,
      minutes: 30,
      progress: 10,
      finished: false,
    },
  ],
  daily: [{ date: DATE, minutes: 30, words: 6000, progress: 10 }],
  synced: null,
  source_files: ['emma.epub'],
});

const file = (source: ImportSource, books: ImportedBook[]): ImportFile => ({
  schema_version: 1,
  source,
  file: source,
  imported: `${DATE}T22:00:00`,
  books,
});

/** A device import with one day, shaped as Kobo's and Kindle's are. */
const device = (minutes: number, daily = true): ImportedBook => ({
  id: 'dev-1',
  title: 'Emma',
  author: 'Jane Austen',
  isbn13: null,
  isbn10: null,
  rating: null,
  shelves: [],
  shelf: 'currently-reading',
  read_count: 0,
  date_added: null,
  pages: null,
  progress: 20,
  reads: [{ start: DATE, end: DATE, finished: false, progress: 20, minutes }],
  ...(daily ? { daily: [{ date: DATE, minutes, words: null, progress: 20 }] } : {}),
});

/** A fresh Moon+ history with the imports merged in, as each rebuild makes it. */
function rebuild(...imports: ImportFile[]): BookHistory {
  const books = [moon()];
  mergeImports(books, structuredClone(imports), { books: {}, exclude: [] });
  expect(books).toHaveLength(1);
  return books[0];
}

describe('the same day in several apps', () => {
  it('adds Moon+ and KOReader up, keeping what each recorded', () => {
    const b = rebuild(file('koreader', readKoreader(statsDb([{ entries: evening }]))));
    expect(b.daily).toEqual([
      {
        date: DATE,
        minutes: 40,
        words: 6000,
        progress: 13.3,
        by_source: {
          moonplus: { minutes: 30, words: 6000 },
          koreader: { minutes: 10, words: null },
        },
      },
    ]);
    expect(b).toMatchObject({ total_minutes: 40, total_words: 6000, progress: 13.3 });
    expect(b.reads).toEqual([expect.objectContaining({ minutes: 40, days_read: 1 })]);
  });

  it('leaves out the rows the plugin copied from Moon+, in any time zone', () => {
    // 90 minutes from local noon where that is 06:15 UTC (UTC+5:45), and from noon UTC
    const synthetic: Entry[] = [
      [10, at('06:15:00'), 3600, 100],
      [10, at('07:15:00'), 1800, 100],
      [10, at('12:00:00'), 300, 100],
    ];
    const books = readKoreader(
      statsDb([
        { entries: [...synthetic, ...evening] },
        {
          title: 'Not on the device',
          md5: 'moonplus:beta',
          entries: [[5, at('12:00:00'), 60, 100]],
        },
      ]),
    );
    expect(books.map((x) => x.title)).toEqual(['Emma']);
    expect(books[0].daily).toEqual([{ date: DATE, minutes: 10, words: null, progress: 13.3 }]);
    expect(rebuild(file('koreader', books)).total_minutes).toBe(40);
    // only synthetic rows: KOReader has nothing of its own
    expect(readKoreader(statsDb([{ entries: synthetic }]))).toEqual([]);
  });

  it('keeps real entries that only partly look synthetic', () => {
    const [b] = readKoreader(
      statsDb([
        {
          entries: [
            [1, at('12:00:01'), 60, 100], // 100 pages, not on a quarter hour
            [2, at('13:00:00'), 60, 300], // on the hour, another page count
          ],
        },
      ]),
    );
    expect(b.daily?.[0].minutes).toBe(2);
  });

  it('gives identical results when rebuilt twice', () => {
    const imports = [
      file('kobo', [device(5)]),
      file('koreader', readKoreader(statsDb([{ entries: evening }]))),
    ];
    const first = rebuild(...imports);
    expect(first.total_minutes).toBe(45);
    expect(rebuild(...imports)).toEqual(first);
  });

  it('counts two KOReader devices once per entry, even under different titles', () => {
    const second: Entry = [60, at('21:00:09'), 300, 300];
    const merged = join(tmp, 'merged.sqlite3');
    mergeStatsDbs(
      [
        statsDb([{ entries: evening }]),
        // the other device synced the first's entry, and spells the title its own way
        statsDb([{ title: 'Emma: A Novel', entries: [...evening, second] }]),
      ],
      merged,
    );
    const books = readKoreader(merged);
    const total = books.flatMap((x) => x.daily ?? []).reduce((s, d) => s + (d.minutes ?? 0), 0);
    expect(total).toBe(15);
    const linked = books.map((x) => ({ ...x, title: 'Emma' }));
    expect(rebuild(file('koreader', linked)).daily[0].by_source?.koreader?.minutes).toBe(15);
  });

  it.each(['kobo', 'kindle'] as const)('adds %s days to Moon+’s', (source) => {
    const b = rebuild(file(source, [device(5)]));
    expect(b.daily[0]).toMatchObject({ minutes: 35, words: 6000, progress: 20 });
    expect(b.total_minutes).toBe(35);
    expect(b.reads).toEqual([expect.objectContaining({ minutes: 35, progress: 20 })]);
    expect(b.progress).toBe(20);
  });

  it('keeps total and read minutes together for a Kobo read with no day data', () => {
    const b = rebuild(file('kobo', [device(50, false)]));
    expect(b.total_minutes).toBe(80);
    expect(b.reads[0].minutes).toBe(80);
    expect(b.daily[0].minutes).toBe(30);
  });

  it('only fills gaps from a KOReader import saved before synthetic rows were left out', () => {
    // it may still hold the copy of Moon+'s own day
    const b = rebuild(file('koreader', [device(30)]));
    expect(b.daily[0].minutes).toBe(30);
    expect(b.total_minutes).toBe(30);
  });
});
