import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeKoboDb } from '../../test/support/fake-kobo';
import { makeKoreaderDb } from '../../test/support/fake-koreader';
import { detectUpload } from './detect';
import { isKoreaderDb, koreaderSeries, readKoreader } from './koreader';

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'koreader-'));
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

describe('KOReader', () => {
  it('parses series with and without a number', () => {
    expect(koreaderSeries('Discworld #3')).toEqual({ series: 'Discworld', series_no: 3 });
    expect(koreaderSeries('Discworld#3.5')).toEqual({ series: 'Discworld', series_no: 3.5 });
    expect(koreaderSeries('Discworld')).toEqual({ series: 'Discworld', series_no: null });
    expect(koreaderSeries('N/A')).toBeNull();
    expect(koreaderSeries('')).toBeNull();
  });

  it('reads books, days, progress and reads from statistics.sqlite3', () => {
    const path = join(tmp, 'statistics.sqlite3');
    makeKoreaderDb(path);
    const books = readKoreader(path);
    expect(books.map((b) => b.title)).toEqual(['KOReader Only Book', 'Gamma', 'Alpha']);
    const [only, gamma] = books;
    expect(only).toMatchObject({
      id: 'k0r3ad3r1',
      author: 'Kit Reader & Kay Coauthor',
      series: 'Reader Saga',
      series_no: 2,
      pages: 200,
      shelf: 'read',
      read_count: 1,
      progress: 100,
      reads: [{ start: '2026-03-06', end: '2026-03-08', finished: true, progress: 100 }],
    });
    // the five hours left on page 20 are not reading
    expect(only.daily).toEqual([
      { date: '2026-03-06', minutes: 20, words: null, progress: 10 },
      { date: '2026-03-08', minutes: 90, words: null, progress: 100 },
    ]);
    expect(only.reads[0].minutes).toBe(110);
    expect(gamma).toMatchObject({
      author: 'Gus Gamma',
      series: 'Lonely',
      series_no: null,
      shelf: 'currently-reading',
      read_count: 0,
      progress: 50,
      reads: [
        { start: '2024-01-10', end: '2024-01-10', finished: false, progress: 10, minutes: 30 },
        { start: '2026-02-01', end: '2026-02-02', finished: false, progress: 50, minutes: 51 },
      ],
    });
  });

  it('falls back to the book’s page count in older databases', () => {
    const path = join(tmp, 'old.sqlite3');
    makeKoreaderDb(path, { old: true });
    const [only, gamma] = readKoreader(path);
    expect(only.daily?.map((d) => d.progress)).toEqual([10, 100]);
    expect(gamma.progress).toBe(50);
  });

  it('caps progress at 100 and skips books with no reading', () => {
    const path = join(tmp, 'odd.sqlite3');
    const db = new DatabaseSync(path);
    db.exec(`
      create table book (id integer primary key, title text, authors text, pages integer,
        series text, md5 text);
      create table page_stat_data (id_book integer, page integer, start_time integer,
        duration integer, total_pages integer);
      insert into book values (1, 'Grown', 'Ann', 100, null, null), (2, 'Empty', 'Bo', 50, null, null);
      insert into page_stat_data values (1, 120, ${Date.parse('2026-01-05T12:00:00Z') / 1000}, 90, 100);
    `);
    db.close();
    const books = readKoreader(path);
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ id: '1', title: 'Grown', progress: 100, shelf: 'read' });
    expect(books[0].daily).toEqual([
      { date: '2026-01-05', minutes: 1.5, words: null, progress: 100 },
    ]);
  });

  it('is told apart from a Kobo database', async () => {
    const ko = join(tmp, 'detect.sqlite3');
    const kobo = join(tmp, 'KoboReader.sqlite');
    makeKoreaderDb(ko);
    makeKoboDb(kobo);
    expect(isKoreaderDb(ko)).toBe(true);
    expect(isKoreaderDb(kobo)).toBe(false);
    expect(await detectUpload(ko)).toMatchObject({ kind: 'books', source: 'koreader' });
    expect(await detectUpload(kobo)).toMatchObject({ kind: 'books', source: 'kobo' });
  });
});
