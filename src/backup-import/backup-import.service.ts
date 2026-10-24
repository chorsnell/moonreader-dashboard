import { mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Injectable } from '@nestjs/common';
import { BibliographyStore } from '../bibliography/bibliography-store.service';
import { buildBibliography } from '../bibliography/build';
import { findFiles, mtimeMs } from '../common/files';
import { localDate, localDateTime, round1 } from '../common/time';
import { CoverStore } from '../covers/cover-store.service';
import { ImportsStore } from '../imports/imports.store';
import { mergeImports, type MergeResult } from '../imports/merge';
import { buildToRead, type ToReadRow } from '../imports/to-read';
import { LibraryService } from '../library/library.service';
import { bookFacts } from '../metadata/merge';
import { MetadataStore } from '../metadata/metadata-store.service';
import type { MetadataFile } from '../metadata/metadata.types';
import { readBackup } from './backup-archive';
import { applyFinishRules } from './finish-rules';
import { buildHighlights, type Highlight, type NoteRow, readNotes } from './highlights';
import { buildReadingHistory } from './reading-history';
import type {
  BookHistory,
  Catalogue,
  StatisticsRow,
  SyncedPositionFile,
} from './reading-history.types';

/** What an import did, as lines for update.log. */
export interface ImportSummary {
  books: number;
  reads: number;
  readingDays: number;
  syncedApplied: number;
  /** Synced .po files that matched no book in the backup. */
  unmatchedSyncs: string[];
  newCovers: number;
  /** "<file>  ->  <title>" for every file not in catalogue.json. */
  untagged: string[];
  highlights: number;
  /** What the Goodreads/StoryGraph imports added, when there are any. */
  imported: (MergeResult & { sources: string[] }) | null;
  lines: string[];
}

/** Only this much of a .po file is read; a position is a few dozen characters. */
const PO_READ_LIMIT = 2000;

/**
 * How far before a build's start meta.json is dated, to allow for file systems that keep
 * modification times to the second (or two). At worst this costs one extra rebuild.
 */
const MTIME_MARGIN_MS = 2000;

/**
 * Turns a Moon+ backup (plus any positions synced over WebDAV) into the data/*.json files
 * the page reads, and saves the covers it finds in the backup.
 */
@Injectable()
export class BackupImportService {
  constructor(
    private readonly library: LibraryService,
    private readonly covers: CoverStore,
    private readonly metadata: MetadataStore,
    private readonly imports: ImportsStore,
    private readonly bibliography: BibliographyStore,
  ) {}

  /** Builds from a backup, or from the imports alone (Kobo, Kindle…) when backup is null. */
  async importBackup(backup: string | null): Promise<ImportSummary> {
    const started = new Date();
    const catalogue = JSON.parse(await readFile(this.library.catalogue, 'utf8')) as Catalogue;
    const tmp = await mkdtemp(join(tmpdir(), 'moonreader-'));
    try {
      const contents = backup
        ? await readBackup(backup, tmp)
        : { databasePath: null, positionsXml: null, covers: new Map<string, Buffer>() };
      if (backup && !contents.databasePath) {
        throw new Error('This backup has no mrbooks.db database.');
      }
      const { bookMeta, isbns, added, statistics, notes } = contents.databasePath
        ? readDatabase(contents.databasePath)
        : { bookMeta: new Map(), isbns: new Map(), added: new Map(), statistics: [], notes: [] };
      const result = buildReadingHistory({
        catalogue,
        bookMeta,
        isbns,
        added,
        statistics,
        positions: parsePositions(contents.positionsXml),
        synced: await this.readSyncedPositions(),
      });
      const metadata = await this.metadata.read();
      // before the imports, which bring their own finished flags
      applyFinishRules(result.books, catalogue, metadata, localDate());
      // books read elsewhere, ratings and shelves (Goodreads, StoryGraph)
      const importFiles = await this.imports.all();
      const imported = importFiles.length
        ? {
            ...mergeImports(result.books, importFiles, catalogue),
            sources: importFiles.map((f) => f.source),
          }
        : null;

      // the to-read pile: unopened Moon+ files and to-read shelves (BOO-76)
      const toRead = buildToRead(result.books, result.unopened, imported?.toRead ?? []);

      const { highlights } = buildHighlights(result.books, notes);
      // highlights from Kobo and Kindle, numbered after Moon+'s
      let nextId = highlights.reduce((m, h) => Math.max(m, h.id), 0);
      for (const h of imported?.highlights ?? []) {
        highlights.push({
          id: ++nextId,
          book_id: h.book_id,
          date: h.time ? h.time.slice(0, 10) : null,
          time: h.time,
          progress: h.progress,
          chapter: h.chapter,
          text: h.text,
          note: h.note,
          colour: null,
          kind: h.kind,
        });
      }

      let newCovers = 0;
      for (const book of result.books) {
        for (const file of book.source_files) {
          const image = contents.covers.get(file.toLowerCase());
          if (image && (await this.covers.save(book.id, image))) {
            newCovers++;
            break;
          }
        }
      }

      const counts = await this.writeData(
        backup,
        result.books,
        catalogue,
        metadata,
        highlights,
        result.untagged.length,
        result.syncedApplied,
        result.unmatchedSyncs,
        importFiles.map((f) => ({ source: f.source, file: f.file, imported: f.imported })),
        toRead,
      );
      // The watcher rebuilds when an input is newer than meta.json. Date it to when this
      // build started reading its inputs, so a position synced (or a catalogue saved) while
      // it ran is still newer, and gets its own rebuild.
      const builtFrom = new Date(started.getTime() - MTIME_MARGIN_MS);
      await utimes(join(this.library.data, 'meta.json'), builtFrom, builtFrom);
      const lines = [
        `${backup ? basename(backup) : 'Imports only (no Moon+ backup)'}: ${counts.books} books, ${counts.reads} reads, ${counts.readingDays} reading days` +
          (counts.highlights ? `, ${counts.highlights} highlights and notes` : '') +
          (result.syncedApplied ? `, ${result.syncedApplied} synced position(s) applied` : '') +
          (newCovers ? `, ${newCovers} new cover(s) from the backup` : ''),
      ];
      if (toRead.length) lines.push(`To-read pile: ${toRead.length} book(s) not started yet`);
      if (imported) {
        lines.push(
          `Imports (${imported.sources.join(', ')}): ${imported.matched} matched, ${imported.added} added` +
            (imported.highlights.length ? `, ${imported.highlights.length} highlights` : '') +
            (imported.skipped
              ? `, ${imported.skipped} to-read or excluded left out of the library`
              : ''),
        );
      }
      if (result.unreadableSyncs.length) {
        lines.push(
          `${result.unreadableSyncs.length} synced .po file(s) not understood (please report):`,
        );
        lines.push(...result.unreadableSyncs.slice(0, 10).map((u) => `  ${u}`));
      }
      if (result.titleMatchedSyncs.length) {
        lines.push(`${result.titleMatchedSyncs.length} synced position(s) matched by title:`);
        lines.push(...result.titleMatchedSyncs.map((u) => `  ${u}`));
      }
      if (result.unmatchedSyncs.length) {
        lines.push(
          `${result.unmatchedSyncs.length} synced position(s) matched no book in the backup (shown as books of their own):`,
        );
        lines.push(...result.unmatchedSyncs.map((u) => `  ${u}`));
      }
      if (result.untagged.length) {
        lines.push(
          `${result.untagged.length} file(s) not in catalogue.json (shown as "Untagged"):`,
        );
        lines.push(...result.untagged.map((u) => `  ${u}`));
      }
      return {
        ...counts,
        syncedApplied: result.syncedApplied,
        unmatchedSyncs: result.unmatchedSyncs,
        newCovers,
        untagged: result.untagged,
        imported,
        lines,
      };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  /** The .po files Moon+ synced over WebDAV. */
  private async readSyncedPositions(): Promise<SyncedPositionFile[]> {
    const out: SyncedPositionFile[] = [];
    for (const path of await findFiles(this.library.dav, '.po')) {
      try {
        const text = (await readFile(path, 'utf8')).slice(0, PO_READ_LIMIT);
        out.push({ name: basename(path), text, mtimeMs: await mtimeMs(path) });
      } catch {
        // removed while we were looking
      }
    }
    return out;
  }

  private async writeData(
    backup: string | null,
    books: BookHistory[],
    catalogue: Catalogue,
    metadata: MetadataFile,
    highlights: Highlight[],
    untagged: number,
    synced: number,
    unmatchedSyncs: string[],
    imports: { source: string; file: string; imported: string }[] = [],
    toRead: ToReadRow[] = [],
  ): Promise<Pick<ImportSummary, 'books' | 'reads' | 'readingDays' | 'highlights'>> {
    const booksRows = [];
    const readsRows = [];
    const dailyRows = [];
    for (const b of books) {
      const facts = bookFacts(b, catalogue, metadata);
      booksRows.push({
        id: b.id,
        title: b.title,
        author: b.author,
        series: b.series,
        series_no: b.series_no,
        genre: b.genre,
        subgenre: b.subgenre,
        ...facts,
        status: b.status,
        progress: b.progress,
        hours: b.source && !b.total_minutes ? null : round1(b.total_minutes / 60),
        words: b.total_words,
        times_read: b.times_read,
        first_read: b.first_read,
        last_read: b.last_read,
        // only with an import, so the files stay as they were without one
        ...(b.rating ? { rating: b.rating } : {}),
        ...(b.shelves?.length ? { shelves: b.shelves } : {}),
        ...(b.source ? { source: b.source } : {}),
        ...(b.added ? { added: b.added } : {}),
        // so the book page can link straight to the book on Goodreads (an export row with no
        // Book Id falls back to its title, which isn't one)
        ...(/^\d+$/.test(b.imports?.goodreads ?? '') ? { goodreads_id: b.imports!.goodreads } : {}),
      });
      for (const r of b.reads) {
        readsRows.push({
          read_id: `${b.id}#${r.read_no}`,
          book_id: b.id,
          title: b.title,
          author: b.author,
          genre: b.genre,
          subgenre: b.subgenre,
          series: b.series,
          read_no: r.read_no,
          times_read: b.times_read,
          start: r.start,
          end: r.end,
          days_read: r.days_read,
          hours: r.minutes ? round1(r.minutes / 60) : null,
          progress: r.progress,
          finished: r.finished,
          ...(r.finished_by ? { finished_by: r.finished_by } : {}),
          ...(r.source ? { source: r.source } : {}),
        });
      }
      for (const d of b.daily) {
        dailyRows.push({
          date: d.date,
          book_id: b.id,
          title: b.title,
          author: b.author,
          genre: b.genre,
          minutes: d.minutes,
          words: d.words,
          progress: d.progress,
        });
      }
    }
    readsRows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    dailyRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const generated = localDateTime();
    const backupFile = backup ? basename(backup) : null;
    await mkdir(this.library.data, { recursive: true });
    await this.dump('books.json', booksRows);
    await this.dump('reads.json', readsRows);
    await this.dump('daily.json', dailyRows);
    // kept apart from the reading data: highlights are the most personal part
    await this.dump('highlights.json', highlights);
    // books waiting to be read that the library doesn't otherwise have
    await this.dump('to_read.json', toRead);
    // books by your authors and in your series that you don't have (BOO-103)
    await this.dump(
      'bibliography.json',
      buildBibliography(booksRows, toRead, await this.bibliography.read()),
    );
    await this.dump(
      'reading_history.json',
      {
        schema_version: 1,
        source: { app: 'Moon+ Reader Pro', backup_file: backupFile, generated },
        books,
      },
      true,
    );
    // written last; its time is what the watcher compares against (see importBackup)
    await this.dump('meta.json', {
      backup_file: backupFile,
      generated,
      untagged,
      synced_positions: synced,
      unmatched_positions: unmatchedSyncs,
      ...(imports.length ? { imports } : {}),
    });
    return {
      books: books.length,
      reads: readsRows.length,
      readingDays: dailyRows.length,
      highlights: highlights.length,
    };
  }

  /** Writes through a .tmp file so the page never reads a half-written one. */
  private async dump(name: string, value: unknown, pretty = false): Promise<void> {
    const path = join(this.library.data, name);
    await writeFile(`${path}.tmp`, JSON.stringify(value, null, pretty ? 1 : undefined), 'utf8');
    await rename(`${path}.tmp`, path);
  }
}

/** Book titles and authors, the reading log and highlights, from Moon+'s database. */
function readDatabase(path: string): {
  bookMeta: Map<string, [string, string]>;
  isbns: Map<string, string>;
  added: Map<string, string>;
  statistics: StatisticsRow[];
  notes: NoteRow[];
} {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const bookMeta = new Map<string, [string, string]>();
    const isbns = new Map<string, string>();
    const added = new Map<string, string>();
    for (const table of ['tmpbooks', 'books']) {
      // Moon+ isn't known to keep ISBNs, but read one if a version has a column for it
      const names = db
        .prepare(`pragma table_info(${table})`)
        .all()
        .map((c) => String(c.name));
      const columns = names.map((c) => c.toLowerCase());
      const isbn = names.find((c) => /^(isbn\w*|identifier)$/i.test(c));
      const hasAdded = columns.includes('addtime');
      const rows = db
        .prepare(
          `select book, filename, author${isbn ? `, "${isbn}" as isbn` : ''}${hasAdded ? ', addTime' : ''} from ${table}`,
        )
        .all();
      for (const { book, filename, author, isbn: id, addTime } of rows) {
        if (!filename) continue;
        const file = String(filename).toLowerCase();
        bookMeta.set(file, [String(book ?? ''), String(author ?? '')]);
        if (id) isbns.set(file, String(id));
        const day = addedDay(addTime);
        if (day && (!added.has(file) || day < added.get(file)!)) added.set(file, day);
      }
    }
    const statistics = db
      .prepare('select filename, usedTime, readWords, dates from statistics')
      .all()
      .map((r) => ({
        filename: r.filename == null ? null : String(r.filename),
        usedTime: r.usedTime == null ? null : Number(r.usedTime),
        readWords: r.readWords == null ? null : Number(r.readWords),
        dates: r.dates == null ? null : String(r.dates),
      }));
    return { bookMeta, isbns, added, statistics, notes: readNotes(db) };
  } finally {
    db.close();
  }
}

/**
 * Moon+'s addTime as a day: a time in ms (or seconds) since 1970, written as text. Anything
 * else, or a time before 2000 or after now, is unknown.
 */
export function addedDay(raw: unknown): string | null {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n >= 1e11 ? n : n * 1000;
  if (ms < Date.UTC(2000, 0, 1) || ms > Date.now() + 86_400_000) return null;
  return localDate(new Date(ms));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

/** Lower-case file path -> last position (%), from positions10.xml. */
function parsePositions(xml: string | null): Map<string, number> {
  const positions = new Map<string, number>();
  for (const [, key, value] of (xml ?? '').matchAll(/<string name="(.*?)">(.*?)<\/string>/g)) {
    const m = /:([\d.]+)%/.exec(value);
    if (m) positions.set(unescapeXml(key).toLowerCase(), Number(m[1]));
  }
  return positions;
}
