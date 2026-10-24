import { DatabaseSync } from 'node:sqlite';

/** Unix seconds for a UTC time: midday, so the local date is the same in any likely zone. */
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * A small KOReader statistics.sqlite3, laid out like the device's. `old` leaves out
 * page_stat_data.total_pages, as databases from before KOReader 2020 do.
 */
export function makeKoreaderDb(path: string, { old = false } = {}): void {
  const db = new DatabaseSync(path);
  db.exec(`
    create table book (id integer primary key autoincrement, title text, authors text,
      notes integer, last_open integer, highlights integer, pages integer, series text,
      language text, md5 text, total_read_time integer, total_read_pages integer);
    create table page_stat_data (id_book integer, page integer not null default 0,
      start_time integer not null default 0, duration integer not null default 0
      ${old ? '' : ', total_pages integer not null default 0'},
      unique (id_book, page, start_time));
    create table numbers (id integer);
  `);
  const book = db.prepare(
    `insert into book (id, title, authors, pages, series, language, md5) values (?, ?, ?, ?, ?, 'en', ?)`,
  );
  // finished over two days, two authors, a numbered series
  book.run(1, 'KOReader Only Book', 'Kit Reader\nKay Coauthor', 200, 'Reader Saga #2', 'k0r3ad3r1');
  // read a year apart, so two reads; a series with no number
  book.run(2, 'Gamma', 'Gus Gamma', 300, 'Lonely', 'k0r3ad3r2');
  // also in the Moon+ backup (read 2026-03-01 to 03), on a day Moon+ has
  book.run(4, 'Alpha', 'Ann Author', 100, null, 'k0r3ad3r4');
  // opened but never read: left out
  book.run(3, 'Unread', 'N/A', 100, 'N/A', 'k0r3ad3r3');
  const stat = old
    ? db.prepare(
        'insert into page_stat_data (id_book, page, start_time, duration) values (?, ?, ?, ?)',
      )
    : db.prepare(
        'insert into page_stat_data (id_book, page, start_time, duration, total_pages) values (?, ?, ?, ?, ?)',
      );
  const read = (id: number, page: number, start: number, seconds: number, total: number) =>
    old ? stat.run(id, page, start, seconds) : stat.run(id, page, start, seconds, total);
  // 2026-03-06: pages 1-20, a minute each (20 minutes, to 10%), and the device left on a page
  for (let p = 1; p <= 20; p++) read(1, p, at('2026-03-06T12:00:00Z') + p * 60, 60, 200);
  read(1, 20, at('2026-03-06T13:00:00Z'), 5 * 3600, 200);
  // 2026-03-08: pages 21-200, 30 seconds each (90 minutes, to the end)
  for (let p = 21; p <= 200; p++) read(1, p, at('2026-03-08T11:00:00Z') + p * 30, 30, 200);
  // Gamma: a day in 2024 to page 30, then two days in 2026 to page 150
  for (let p = 1; p <= 30; p++) read(2, p, at('2024-01-10T12:00:00Z') + p * 60, 60, 300);
  for (let p = 100; p <= 120; p++) read(2, p, at('2026-02-01T12:00:00Z') + p * 60, 60, 300);
  for (let p = 121; p <= 150; p++) read(2, p, at('2026-02-02T12:00:00Z') + p * 60, 60, 300);
  for (let p = 40; p <= 49; p++) read(4, p, at('2026-03-02T12:00:00Z') + p * 60, 60, 100);
  db.close();
}
