/**
 * The page turns in the statistics databases KOReader devices sent (library/koreader/
 * statistics/, one per device; src/koreader-sync keeps them), each tied to its dashboard
 * book, with the plugin's copies of Moon+ history left out and nothing counted twice.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bookKey, SERIES_SUFFIX } from '../common/book-match';
import type { BookHistory, Catalogue } from '../backup-import/reading-history.types';
import { MAX_ENTRY_SECONDS, SYNTHETIC_MD5 } from '../imports/koreader';
import type { ImportedBook } from '../imports/imports.types';
import { koreaderAuthors } from '../koreader-sync/koreader-books';
import type { PageEntry } from './sessions';

/** One book of one statistics database, and its page turns. */
export interface StatsBook {
  rowId: string;
  md5: string;
  title: string;
  author: string;
  entries: Omit<PageEntry, 'book_id'>[];
}

/**
 * Whether a row is Moon+ history the plugin wrote into a real book's statistics
 * (koreader/API.md "Synthetic history rows"): out of 100 pages, at most an hour, starting at
 * local noon or whole hours after it. The device's time zone may not be the server's, so any
 * start on a quarter hour (every zone's whole hour) counts. A real page turn in a 100-page
 * book meets that about once in 900, which costs one page.
 */
export function isSyntheticRow(start: number, seconds: number, total: number | null): boolean {
  return total === 100 && seconds <= 3600 && start % 900 === 0;
}

/** "device-kobo-libra-2-ab12.sqlite3" -> "kobo-libra-2-ab12"; WebDAV and uploads name none. */
export const deviceOf = (file: string): string | null =>
  /^device-(.+)\.sqlite3$/.exec(file)?.[1] ?? null;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The books and page turns of one statistics.sqlite3. */
export function readStatsDb(path: string, device: string | null, now = Date.now()): StatsBook[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const columns = (table: string) =>
      new Set(
        db
          .prepare(`pragma table_info(${table})`)
          .all()
          .map((c) => String(c.name)),
      );
    const bookCols = columns('book');
    const pick = (c: string) => (bookCols.has(c) ? `"${c}"` : 'null') + ` as "${c}"`;
    const books = new Map<string, StatsBook & { pages: number | null }>();
    for (const b of db
      .prepare(
        `select ${['id', 'title', 'authors', 'pages', 'md5'].map(pick).join(', ')} from book`,
      )
      .all()) {
      const md5 = str(b.md5);
      // a book KOReader holds only because the plugin copied Moon+ history in
      if (md5.startsWith(SYNTHETIC_MD5)) continue;
      books.set(String(b.id), {
        rowId: String(b.id),
        md5,
        title: str(b.title),
        author: koreaderAuthors(b.authors),
        pages: num(b.pages),
        entries: [],
      });
    }
    const total = columns('page_stat_data').has('total_pages') ? 'total_pages' : 'null';
    const rows = db
      .prepare(
        `select id_book, page, start_time, duration, ${total} as total_pages from page_stat_data`,
      )
      .iterate();
    for (const r of rows) {
      const book = books.get(String(r.id_book));
      const page = num(r.page);
      const start = num(r.start_time);
      const seconds = num(r.duration);
      if (!book || page === null || page <= 0 || start === null || seconds === null) continue;
      // as the daily totals do: over four hours is the device left on a page
      if (seconds <= 0 || seconds > MAX_ENTRY_SECONDS) continue;
      // a broken clock
      if (new Date(start * 1000).getUTCFullYear() < 2000 || start * 1000 > now + 86_400_000) {
        continue;
      }
      const raw = num(r.total_pages);
      if (isSyntheticRow(start, seconds, raw)) continue;
      const pages = raw || book.pages || null;
      book.entries.push({
        page: pages ? Math.min(page, pages) : page,
        start,
        seconds,
        total: pages && pages > 0 ? pages : null,
        device,
      });
    }
    return [...books.values()].filter((b) => b.entries.length);
  } finally {
    db.close();
  }
}

/**
 * Which dashboard book a statistics book is: the one the rebuild gave its KOReader import
 * to, else an earlier match with the plugin (links.json), else by title and author the way
 * the merge matches (with catalogue.json's names). null: not in the library, or excluded.
 */
export function bookMatcher(
  books: BookHistory[],
  imported: ImportedBook[],
  catalogue: Catalogue,
  links: Record<string, { book_id: string }>,
): (b: Pick<StatsBook, 'rowId' | 'md5' | 'title' | 'author'>) => string | null {
  const ids = new Set(books.map((b) => b.id));
  const byImport = new Map<string, string>();
  const byKey = new Map<string, string>();
  for (const b of books) {
    if (b.imports?.koreader) byImport.set(b.imports.koreader, b.id);
    for (const f of b.source_files) {
      if (f.startsWith('koreader:')) byImport.set(f.slice('koreader:'.length), b.id);
    }
    const key = bookKey(b.title, b.author);
    if (!byKey.has(key)) byKey.set(key, b.id);
  }
  const exclude = new Set(catalogue.exclude);
  const named = (id: string | null, title: string, author: string) => {
    const entry = id === null ? undefined : catalogue.books[`koreader:${id}`.toLowerCase()];
    return (
      byKey.get(
        bookKey(entry?.title || title.replace(SERIES_SUFFIX, ''), entry ? entry.author : author),
      ) ?? byKey.get(bookKey(title, author))
    );
  };

  return (b) => {
    // the importer's id: the md5 (suffixed "-<row>" when two books share one), else the row id
    const same = b.md5
      ? imported.filter((i) => i.id === b.md5 || i.id.replace(/-\d+$/, '') === b.md5)
      : [];
    const entry = same.find((i) => bookKey(i.title, i.author) === bookKey(b.title, b.author));
    const ib = entry ?? same[0];
    if (ib && exclude.has(`koreader:${ib.id}`.toLowerCase())) return null;
    const linked = links[b.md5]?.book_id;
    return (
      (ib && byImport.get(ib.id)) ||
      (linked && ids.has(linked) ? linked : undefined) ||
      (ib && named(ib.id, ib.title, ib.author)) ||
      (b.title ? named(b.md5 || b.rowId, b.title, b.author) : undefined) ||
      null
    );
  };
}

/**
 * Every device's page turns under their dashboard books. A turn in more than one database
 * (KOReader's sync copies them between devices) counts once; when two devices hold it,
 * which one it was read on isn't known. A database that can't be read is named, not fatal.
 */
export async function readPageEntries(
  statsDir: string,
  match: ReturnType<typeof bookMatcher>,
): Promise<{ entries: PageEntry[]; unreadable: string[] }> {
  const names = (await readdir(statsDir).catch(() => [] as string[]))
    .filter((n) => n.endsWith('.sqlite3'))
    .sort();
  const seen = new Map<string, { entry: PageEntry; devices: Set<string> }>();
  const unreadable: string[] = [];
  for (const name of names) {
    let books: StatsBook[];
    try {
      books = readStatsDb(join(statsDir, name), deviceOf(name));
    } catch {
      unreadable.push(name);
      continue;
    }
    for (const b of books) {
      const book_id = match(b);
      if (book_id === null) continue;
      for (const e of b.entries) {
        const key = `${book_id}\0${e.page}\0${e.start}`;
        let had = seen.get(key);
        if (!had) {
          had = { entry: { ...e, book_id }, devices: new Set() };
          seen.set(key, had);
        }
        if (e.device) had.devices.add(e.device);
        had.entry.device = had.devices.size === 1 ? [...had.devices][0] : null;
      }
    }
  }
  return { entries: [...seen.values()].map((s) => s.entry), unreadable };
}
