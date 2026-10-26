import { DatabaseSync } from 'node:sqlite';

const columns = (db: DatabaseSync, schema: string, table: string): Set<string> =>
  new Set(
    db
      .prepare(`pragma ${schema}.table_info(${table})`)
      .all()
      .map((c) => String(c.name)),
  );

/**
 * Merges several devices' KOReader statistics databases into one at `dest`, the way
 * KOReader's own sync does: a book is the same book when its title, authors and md5 agree,
 * and a page entry is the same entry when its book, page and start time agree. So a device
 * that already merged another's statistics (KOReader's WebDAV sync) counts nothing twice.
 */
export function mergeStatsDbs(sources: string[], dest: string): void {
  const db = new DatabaseSync(dest);
  try {
    db.exec(`
      create table book (id integer primary key autoincrement, title text, authors text,
        notes integer, last_open integer, highlights integer, pages integer, series text,
        language text, md5 text, total_read_time integer, total_read_pages integer);
      create unique index book_title_authors_md5 on book(title, authors, md5);
      create table page_stat_data (id_book integer, page integer not null default 0,
        start_time integer not null default 0, duration integer not null default 0,
        total_pages integer not null default 0, unique (id_book, page, start_time));
    `);
    sources.forEach((src, i) => {
      const schema = `src${i}`;
      db.prepare(`attach database ? as ${schema}`).run(src);
      try {
        const bookCols = columns(db, schema, 'book');
        const pick = (c: string) => (bookCols.has(c) ? `"${c}"` : 'null');
        // the unique index treats nulls as different, so a missing title or md5 becomes ''
        const key = (c: string) => (bookCols.has(c) ? `coalesce("${c}", '')` : "''");
        db.exec(`
          insert or ignore into book (title, authors, pages, series, language, md5, last_open)
          select ${key('title')}, ${key('authors')},
            ${['pages', 'series', 'language'].map(pick).join(', ')}, ${key('md5')}, ${pick('last_open')}
          from ${schema}.book;
        `);
        const total = columns(db, schema, 'page_stat_data').has('total_pages')
          ? 's.total_pages'
          : '0';
        db.exec(`
          insert or ignore into page_stat_data (id_book, page, start_time, duration, total_pages)
          select m.id, s.page, s.start_time, s.duration, ${total}
          from ${schema}.page_stat_data s
          join ${schema}.book b on b.id = s.id_book
          join book m on m.title = coalesce(b.title, '') and m.authors = coalesce(b.authors, '')
            and m.md5 = coalesce(b.md5, '');
        `);
      } finally {
        db.exec(`detach database ${schema}`);
      }
    });
  } finally {
    db.close();
  }
}
