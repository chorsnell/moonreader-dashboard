import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { localDateTime } from '../common/time';
import type { BookHistory } from '../backup-import/reading-history.types';
import type { Highlight } from '../backup-import/highlights';
import { isKoreaderDb, readKoreader } from '../imports/koreader';
import { ImportsStore } from '../imports/imports.store';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { RebuildService } from '../rebuild/rebuild.service';
import {
  buildKoreaderBooks,
  cleanSidecarBook,
  type DeviceFile,
  matchFiles,
  type MatchResult,
  type SidecarBook,
} from './koreader-books';
import { mergeStatsDbs } from './merge-stats';

/** At most this many books a request, so one body can't hold the server up for long. */
export const MAX_BOOKS_PER_REQUEST = 500;
/** And this many files to match. */
export const MAX_FILES_PER_MATCH = 2000;

export type KoreaderTrigger = 'plugin' | 'webdav' | 'admin';

export class KoreaderSyncError extends Error {}

interface Links {
  [md5: string]: { book_id: string; title: string; author: string };
}

/**
 * Keeps what KOReader devices send (koreader/API.md) in library/koreader/: the latest
 * statistics.sqlite3, each book's sidecar data, and which dashboard book each device file is,
 * and turns them into the KOReader import (library/koreader.json) the rebuild merges.
 */
@Injectable()
export class KoreaderSyncService {
  constructor(
    private readonly library: LibraryService,
    private readonly imports: ImportsStore,
    private readonly rebuild: RebuildService,
    private readonly activity: ActivityLogService,
  ) {}

  /** One change at a time: two devices syncing at once mustn't lose each other's books. */
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  get dir(): string {
    return join(this.library.root, 'koreader');
  }
  /** One statistics database per device (or WebDAV folder), merged when the import is built. */
  private get statsDir(): string {
    return join(this.dir, 'statistics');
  }
  private get booksPath(): string {
    return join(this.dir, 'books.json');
  }
  private get linksPath(): string {
    return join(this.dir, 'links.json');
  }

  /**
   * A statistics.sqlite3 arrived (the plugin, KOReader's own WebDAV sync, or an upload on the
   * admin page): keep a copy and rebuild the import. `file` names it in the log.
   */
  async saveStats(
    path: string,
    trigger: KoreaderTrigger,
    { file = 'statistics.sqlite3', device = null }: { file?: string; device?: string | null } = {},
  ): Promise<{ books: number; days: number; highlights: number }> {
    return this.serial(() => this.saveStatsNow(path, trigger, file, device));
  }

  private async saveStatsNow(
    path: string,
    trigger: KoreaderTrigger,
    file: string,
    device: string | null,
  ): Promise<{ books: number; days: number; highlights: number }> {
    if (!isKoreaderDb(path)) {
      this.activity.record({
        type: trigger === 'admin' ? 'import' : 'sync',
        message: `KOReader: ${file} is not KOReader's statistics database, ignored`,
        outcome: 'failed',
        trigger,
        error: "That database isn't KOReader's statistics.sqlite3.",
        details: { source: 'koreader', file, device },
      });
      throw new KoreaderSyncError("That database isn't KOReader's statistics.sqlite3.");
    }
    // read it once here, so a broken file is refused before it replaces a good one
    readKoreader(path);
    const dest = join(this.statsDir, `${statsKey(trigger, device, file)}.sqlite3`);
    await mkdir(this.statsDir, { recursive: true });
    await copyFile(path, `${dest}.part`);
    await rename(`${dest}.part`, dest);
    return this.rebuildImport(trigger, `statistics from ${device ?? file}`, { file, device });
  }

  /** Books from a device's sidecars, upserted by md5. Returns how many were kept. */
  async saveBooks(raw: unknown, trigger: KoreaderTrigger = 'plugin'): Promise<number> {
    const body = (raw ?? {}) as { books?: unknown; device?: unknown };
    if (!Array.isArray(body.books)) throw new KoreaderSyncError('Expected { "books": [...] }.');
    if (body.books.length > MAX_BOOKS_PER_REQUEST) {
      throw new KoreaderSyncError(`At most ${MAX_BOOKS_PER_REQUEST} books a request.`);
    }
    const device = typeof body.device === 'string' ? body.device.slice(0, 160) : null;
    return this.serial(() => this.saveBooksNow(body.books as unknown[], device, trigger));
  }

  private async saveBooksNow(
    books: unknown[],
    device: string | null,
    trigger: KoreaderTrigger,
  ): Promise<number> {
    const stored = await this.readBooks();
    const received = localDateTime();
    let kept = 0;
    for (const b of books) {
      const clean = cleanSidecarBook(b);
      if (!clean) continue;
      stored[clean.md5] = { ...clean, received, device };
      kept++;
    }
    await this.writeJson(this.booksPath, stored);
    await this.rebuildImport(trigger, `${kept} book(s) from ${device ?? 'a device'}`, { device });
    return kept;
  }

  /** What the dashboard knows about the device's files (POST /api/koreader/match). */
  async match(raw: unknown): Promise<Omit<MatchResult, 'links'>> {
    const body = (raw ?? {}) as { files?: unknown; others?: unknown };
    const files = Array.isArray(body.files) ? (body.files as DeviceFile[]) : [];
    if (files.length > MAX_FILES_PER_MATCH) {
      throw new KoreaderSyncError(`At most ${MAX_FILES_PER_MATCH} files a request.`);
    }
    const history = await this.readData<{ books?: BookHistory[] }>('reading_history.json');
    const highlights = (await this.readData<Highlight[]>('highlights.json')) ?? [];
    const links = await this.readLinks();
    const result = matchFiles({
      files: files.filter((f) => f && typeof f === 'object'),
      others: body.others === true,
      books: history?.books ?? [],
      highlights: Array.isArray(highlights) ? highlights : [],
      koreader: await this.imports.get('koreader'),
      links,
    });
    // remember new matches, so the next import names these books the dashboard's way
    const changed = Object.entries(result.links).filter(
      ([md5, l]) => links[md5]?.book_id !== l.book_id,
    );
    if (changed.length) {
      await this.serial(async () => {
        await this.writeJson(this.linksPath, {
          ...(await this.readLinks()),
          ...Object.fromEntries(changed),
        });
        await this.rebuildImport('plugin', `${changed.length} book(s) matched`, {});
      });
    }
    return { books: result.books, ...(result.others ? { others: result.others } : {}) };
  }

  /** Builds library/koreader.json from what's kept, then rebuilds the dashboard. */
  private async rebuildImport(
    trigger: KoreaderTrigger,
    what: string,
    { file = null, device = null }: { file?: string | null; device?: string | null },
  ): Promise<{ books: number; days: number; highlights: number }> {
    const stats = await this.readStats();
    const books = buildKoreaderBooks(stats, await this.readBooks(), await this.readLinks());
    const days = books.reduce((s, b) => s + (b.daily?.length ?? 0), 0);
    const highlights = books.reduce((s, b) => s + (b.highlights?.length ?? 0), 0);
    if (books.length) {
      await this.imports.save({
        schema_version: 1,
        source: 'koreader',
        file: file ?? 'KOReader sync',
        imported: localDateTime(),
        books,
      });
    }
    this.activity.record({
      type: trigger === 'admin' ? 'import' : 'sync',
      message:
        `KOReader: ${what}` +
        (books.length
          ? ` (${books.length} books, ${days} reading days, ${highlights} highlights)`
          : ''),
      trigger,
      details: { source: 'koreader', books: books.length, days, highlights, device, file },
    });
    if (books.length) await this.rebuild.rebuildNow();
    return { books: books.length, days, highlights };
  }

  /** Every device's statistics, merged, as the importer reads them. */
  private async readStats() {
    let names: string[];
    try {
      names = (await readdir(this.statsDir)).filter((n) => n.endsWith('.sqlite3')).sort();
    } catch {
      return [];
    }
    if (!names.length) return [];
    if (names.length === 1) return readKoreader(join(this.statsDir, names[0]));
    const tmp = await mkdtemp(join(tmpdir(), 'koreader-merge-'));
    try {
      const merged = join(tmp, 'statistics.sqlite3');
      mergeStatsDbs(
        names.map((n) => join(this.statsDir, n)),
        merged,
      );
      return readKoreader(merged);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  private async readBooks(): Promise<Record<string, SidecarBook>> {
    return (await this.readJson<Record<string, SidecarBook>>(this.booksPath)) ?? {};
  }

  private async readLinks(): Promise<Links> {
    return (await this.readJson<Links>(this.linksPath)) ?? {};
  }

  private async readData<T>(name: string): Promise<T | null> {
    return this.readJson<T>(join(this.library.data, name));
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(`${path}.part`, JSON.stringify(value), 'utf8');
    await rename(`${path}.part`, path);
  }

  /** Forgets everything KOReader devices sent (used when the KOReader import is removed). */
  async forget(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

/** A file name for where a statistics database came from: the device, or the WebDAV path. */
export function statsKey(trigger: KoreaderTrigger, device: string | null, file: string): string {
  const slug = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'device';
  if (trigger === 'webdav') return `webdav-${slug(file)}`;
  if (trigger === 'admin') return 'upload';
  return `device-${slug(device ?? 'device')}`;
}
