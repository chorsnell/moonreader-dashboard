/**
 * The page turns in the statistics databases KOReader devices sent (library/koreader/
 * statistics/, one per device; src/koreader-sync keeps them), each tied to its dashboard
 * book. Which rows count is countedEntries' call, over the databases merged as the KOReader
 * import merges them, so the page-level views and the daily totals agree.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bookKey, SERIES_SUFFIX } from '../common/book-match';
import type { BookHistory, Catalogue } from '../backup-import/reading-history.types';
import { countedEntries } from '../imports/koreader';
import type { ImportedBook } from '../imports/imports.types';
import { koreaderAuthors } from '../koreader-sync/koreader-books';
import { mergeStatsDbs } from '../koreader-sync/merge-stats';
import type { PageEntry } from './sessions';

/** One book of one statistics database, and its page turns. */
export interface StatsBook {
  rowId: string;
  md5: string;
  title: string;
  author: string;
  entries: Omit<PageEntry, 'book_id' | 'device'>[];
}

/** "device-kobo-libra-2-ab12.sqlite3" -> "kobo-libra-2-ab12"; WebDAV and uploads name none. */
export const deviceOf = (file: string): string | null =>
  /^device-(.+)\.sqlite3$/.exec(file)?.[1] ?? null;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The books and counted page turns of one statistics.sqlite3. */
export function readStatsDb(path: string): StatsBook[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const entries = countedEntries(db);
    const bookCols = new Set(
      db
        .prepare('pragma table_info(book)')
        .all()
        .map((c) => String(c.name)),
    );
    const pick = (c: string) => (bookCols.has(c) ? `"${c}"` : 'null') + ` as "${c}"`;
    const books = new Map<string, StatsBook & { pages: number | null }>();
    for (const b of db
      .prepare(
        `select ${['id', 'title', 'authors', 'pages', 'md5'].map(pick).join(', ')} from book`,
      )
      .all()) {
      books.set(String(b.id), {
        rowId: String(b.id),
        md5: str(b.md5),
        title: str(b.title),
        author: koreaderAuthors(b.authors),
        pages: num(b.pages),
        entries: [],
      });
    }
    for (const e of entries) {
      const book = books.get(e.bookId);
      if (!book) continue;
      const total = e.totalPages || book.pages;
      // time on no page in particular still counts; it just has no place in the book
      const placed = e.page !== null && e.page > 0 && total !== null && total > 0;
      book.entries.push({
        page: placed ? Math.min(e.page!, total) : 0,
        start: e.start,
        seconds: e.seconds,
        total: placed ? total : null,
      });
    }
    // a book with no title isn't imported, so has no daily totals either
    return [...books.values()].filter((b) => b.title && b.entries.length);
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

/** The same entry in any database: the book's md5 (else title and author), page and start. */
const entryKey = (b: StatsBook, e: StatsBook['entries'][number]) =>
  `${b.md5 || `${b.title}\0${b.author}`}\0${e.page}\0${e.start}`;

/** One database as it is, or several merged as the KOReader import merges them. */
async function readMerged(paths: string[]): Promise<StatsBook[]> {
  if (paths.length < 2) return paths.length ? readStatsDb(paths[0]) : [];
  const tmp = await mkdtemp(join(tmpdir(), 'koreader-pages-'));
  try {
    const merged = join(tmp, 'statistics.sqlite3');
    mergeStatsDbs(paths, merged);
    return readStatsDb(merged);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
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
  const readable: string[] = [];
  const unreadable: string[] = [];
  const devices = new Map<string, Set<string>>();
  for (const name of names) {
    const path = join(statsDir, name);
    try {
      const books = readStatsDb(path);
      readable.push(path);
      const device = deviceOf(name);
      if (!device) continue;
      for (const b of books) {
        for (const e of b.entries) {
          const key = entryKey(b, e);
          devices.set(key, (devices.get(key) ?? new Set()).add(device));
        }
      }
    } catch {
      unreadable.push(name);
    }
  }
  const entries: PageEntry[] = [];
  for (const b of await readMerged(readable)) {
    const book_id = match(b);
    if (book_id === null) continue;
    for (const e of b.entries) {
      const held = devices.get(entryKey(b, e));
      entries.push({ ...e, book_id, device: held?.size === 1 ? [...held][0] : null });
    }
  }
  return { entries, unreadable };
}
