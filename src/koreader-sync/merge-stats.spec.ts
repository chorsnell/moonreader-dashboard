import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeKoreaderDb } from '../../test/support/fake-koreader';
import { readKoreader } from '../imports/koreader';
import { mergeStatsDbs } from './merge-stats';

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'koreader-merge-'));
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

describe('merging devices’ KOReader statistics', () => {
  it('counts a database merged twice only once, and adds another device’s reading', () => {
    const a = join(tmp, 'a.sqlite3');
    const b = join(tmp, 'b.sqlite3');
    makeKoreaderDb(a);
    makeKoreaderDb(b, { old: true }); // a copy, as after KOReader's own sync, in the old layout
    // device b also read a new book, under another row id
    const db = new DatabaseSync(b);
    db.prepare(
      `insert into book (id, title, authors, pages, md5) values (9, 'Only On B', 'Bo', 50, 'bbb')`,
    ).run();
    const start = Math.floor(Date.parse('2026-04-01T12:00:00Z') / 1000);
    for (let p = 1; p <= 10; p++) {
      db.prepare(
        'insert into page_stat_data (id_book, page, start_time, duration) values (9, ?, ?, 60)',
      ).run(p, start + p * 60);
    }
    db.close();

    const merged = join(tmp, 'merged.sqlite3');
    mergeStatsDbs([a, b], merged);
    const single = readKoreader(a);
    const books = readKoreader(merged);
    expect(books.map((x) => x.title)).toEqual([...single.map((x) => x.title), 'Only On B']);
    // same days and minutes as one device: nothing doubled
    for (const s of single) {
      expect(books.find((x) => x.id === s.id)?.daily).toEqual(s.daily);
    }
    expect(books.find((x) => x.id === 'bbb')).toMatchObject({
      pages: 50,
      daily: [{ minutes: 10 }],
    });
  });
});
