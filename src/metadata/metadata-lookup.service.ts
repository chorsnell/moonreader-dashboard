import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { localDate } from '../common/time';
import { OpenLibraryClient } from '../covers/open-library.client';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { firstIsbn, parseIsbn } from './isbn';
import { MetadataStore } from './metadata-store.service';
import type { BookMetadata } from './metadata.types';
import { WikidataClient } from './wikidata.client';

/** Books and authors not found are tried again after this many days. */
export const RETRY_DAYS = 30;
/** Give up for this round after this many lookups in a row fail to reach a service. */
const MAX_FAILURES = 3;
/** Books whose subjects are looked up per round, for books looked up before subjects were kept. */
export const SUBJECTS_PER_ROUND = 100;
/** Subjects kept per book (popular works have hundreds). */
export const MAX_SUBJECTS = 80;

/** A work's subjects, trimmed, without repeats, at most MAX_SUBJECTS. */
export function cleanSubjects(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== 'string') continue;
    const t = s.trim().replace(/\s+/g, ' ');
    if (!t || t.length > 120 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= MAX_SUBJECTS) break;
  }
  return out;
}

interface BookRow {
  id: string;
  title: string;
  author?: string | null;
  isbn13?: string | null;
  work_id?: string | null;
  genre?: string;
}

/** A work as stored: the parts of an Open Library search result the dashboard uses. */
export function workMetadata(doc: {
  key?: string;
  first_publish_year?: number;
  number_of_pages_median?: number;
  isbn?: string[];
  author_key?: string[];
}): BookMetadata {
  const isbn = firstIsbn(doc.isbn);
  return {
    work_id: doc.key?.replace(/^\/works\//, '') || null,
    isbn13: isbn?.isbn13 ?? null,
    isbn10: isbn?.isbn10 ?? null,
    published_year: Number.isInteger(doc.first_publish_year) ? doc.first_publish_year! : null,
    pages: Number.isInteger(doc.number_of_pages_median) ? doc.number_of_pages_median! : null,
    author_key: doc.author_key?.[0] ?? null,
  };
}

/**
 * Looks up each book's publication year, page count, ISBN and subjects on Open Library, and
 * each author's country and gender on Wikidata, in the background after a rebuild. What it
 * finds goes in library/metadata.json, which the next build merges into books.json; subjects
 * go in library/.metadata-subjects.json, for the admin's genre suggestions.
 */
@Injectable()
export class MetadataLookupService implements OnApplicationShutdown {
  private running: Promise<void> | null = null;
  private readonly stop = new AbortController();

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly store: MetadataStore,
    private readonly openLibrary: OpenLibraryClient,
    private readonly wikidata: WikidataClient,
    private readonly activity: ActivityLogService,
  ) {}

  /** Starts a lookup unless one is running or lookups are off. Doesn't wait for it. */
  start(trigger = 'rebuild'): void {
    void this.run(trigger);
  }

  /** Looks up what's missing; resolves when done (or joins a lookup already running). */
  run(trigger = 'rebuild'): Promise<void> {
    if (!this.config.metadataLookup || this.stop.signal.aborted) return Promise.resolve();
    this.running ??= this.lookUpMissing(trigger)
      .catch((e: unknown) => {
        if (this.stop.signal.aborted) return;
        this.activity.record({
          type: 'metadata',
          message: 'Metadata lookup failed',
          outcome: 'failed',
          trigger,
          error: String(e),
        });
      })
      .finally(() => (this.running = null));
    return this.running;
  }

  async onApplicationShutdown(): Promise<void> {
    this.stop.abort();
    await this.running;
  }

  private async lookUpMissing(trigger: string): Promise<void> {
    const started = Date.now();
    let books: BookRow[];
    try {
      books = JSON.parse(
        await readFile(join(this.library.data, 'books.json'), 'utf8'),
      ) as BookRow[];
    } catch {
      return; // no data yet
    }
    const metadata = await this.store.read();
    const misses = await this.store.readMisses();
    const subjects = await this.store.readSubjects();
    let subjectsChanged = false;
    const today = localDate();
    const retryFrom = localDate(new Date(Date.now() - RETRY_DAYS * 86_400_000));
    const due = (missed: string | undefined) => (missed ?? '') < retryFrom;
    const todoBooks = books.filter((b) => !metadata.books[b.id] && due(misses.books[b.id]));
    const signal = this.stop.signal;
    let changed = false;
    let failures = 0;
    let unreachable = '';
    /** Runs one lookup; false when it's time to stop for this round. */
    const attempt = async (fn: () => Promise<void>): Promise<boolean> => {
      try {
        await fn();
        failures = 0;
        return true;
      } catch (e) {
        if (signal.aborted) return false;
        if (++failures < MAX_FAILURES) return true;
        unreachable = (e as Error).message;
        return false;
      }
    };

    let foundBooks = 0;
    if (todoBooks.length) {
      this.activity.log(`  Looking up ${todoBooks.length} book(s) on Open Library`);
    }
    for (const [n, book] of todoBooks.entries()) {
      if (n) await sleep(this.config.coverPauseMs, undefined, { signal }).catch(() => {});
      if (signal.aborted) break;
      const ok = await attempt(async () => {
        const isbn = parseIsbn(book.isbn13)?.isbn13 ?? null;
        const doc = await this.openLibrary.findWork(book.title, book.author ?? '', isbn, signal);
        if (doc) {
          metadata.books[book.id] = { ...workMetadata(doc), looked_up: today };
          subjects.books[book.id] = {
            work_id: metadata.books[book.id].work_id ?? null,
            subjects: cleanSubjects(doc.subject),
            looked_up: today,
          };
          subjectsChanged = true;
          delete misses.books[book.id];
          changed = true;
          foundBooks++;
        } else {
          misses.books[book.id] = today;
        }
      });
      if (!ok) break;
    }

    // authors, through the Open Library author id of one of their books
    const keys = new Map<string, string>();
    for (const b of books) {
      const name = (b.author ?? '').trim();
      const key = metadata.books[b.id]?.author_key;
      if (name && key && !keys.has(name.toLowerCase())) keys.set(name.toLowerCase(), key);
    }
    const names = new Map(books.map((b) => [(b.author ?? '').toLowerCase(), b.author ?? '']));
    const todoAuthors = [...keys].filter(
      ([name]) => !metadata.authors[name] && due(misses.authors[name]),
    );
    let foundAuthors = 0;
    if (!signal.aborted && failures < MAX_FAILURES && todoAuthors.length) {
      this.activity.log(`  Looking up ${todoAuthors.length} author(s) on Wikidata`);
      for (const [name, key] of todoAuthors) {
        if (signal.aborted) break;
        const ok = await attempt(async () => {
          const id =
            (await this.openLibrary.authorWikidata(key, signal)) ??
            (await this.wikidata.findByOpenLibrary(key.replace(/^\/?authors\//, ''), signal));
          if (!id) {
            misses.authors[name] = today;
            return;
          }
          const facts = await this.wikidata.authorFacts(id, signal);
          metadata.authors[name] = {
            name: names.get(name),
            wikidata: id,
            ...facts,
            looked_up: today,
          };
          delete misses.authors[name];
          changed = true;
          foundAuthors++;
        });
        if (!ok) break;
      }
    }

    // subjects of books looked up before they were kept (or whose work changed), a round at
    // a time and untagged books first; works without any are tried again after RETRY_DAYS
    const workOf = (b: BookRow) => b.work_id || metadata.books[b.id]?.work_id || null;
    const todoSubjects = books
      .filter((b) => {
        const work = workOf(b);
        if (!work) return false;
        const had = subjects.books[b.id];
        return !had || had.work_id !== work || (!had.subjects.length && due(had.looked_up));
      })
      .sort((a, b) => Number(b.genre === 'Untagged') - Number(a.genre === 'Untagged'))
      .slice(0, SUBJECTS_PER_ROUND);
    let foundSubjects = 0;
    if (!signal.aborted && failures < MAX_FAILURES && todoSubjects.length) {
      this.activity.log(`  Looking up subjects of ${todoSubjects.length} book(s) on Open Library`);
      for (const [n, book] of todoSubjects.entries()) {
        if (n) await sleep(this.config.coverPauseMs, undefined, { signal }).catch(() => {});
        if (signal.aborted) break;
        const work = workOf(book)!;
        const ok = await attempt(async () => {
          const found = cleanSubjects(await this.openLibrary.workSubjects(work, signal));
          subjects.books[book.id] = { work_id: work, subjects: found, looked_up: today };
          subjectsChanged = true;
          if (found.length) foundSubjects++;
        });
        if (!ok) break;
      }
    }

    await this.store.writeMisses(misses);
    if (subjectsChanged) await this.store.writeSubjects(subjects);
    // a new metadata.json makes the watcher rebuild, which merges it into books.json
    if (changed) {
      await this.store.write(metadata);
      this.library.changed('metadata');
    }
    if (signal.aborted || (!todoBooks.length && !todoAuthors.length && !todoSubjects.length))
      return;
    const parts = [
      `${foundBooks} of ${todoBooks.length} book(s)`,
      `${foundAuthors} of ${todoAuthors.length} author(s)`,
      ...(todoSubjects.length
        ? [`subjects for ${foundSubjects} of ${todoSubjects.length} more book(s)`]
        : []),
    ];
    const found = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    this.activity.record({
      type: 'metadata',
      message: unreachable
        ? `Stopped looking up metadata: a service could not be reached. Found ${found} first; the rest will be tried after the next rebuild`
        : `Found metadata for ${found}; the rest are retried after ${RETRY_DAYS} days`,
      outcome: unreachable ? 'failed' : 'ok',
      error: unreachable || undefined,
      trigger,
      duration_ms: Date.now() - started,
      details: {
        books_tried: todoBooks.length,
        books_found: foundBooks,
        authors_tried: todoAuthors.length,
        authors_found: foundAuthors,
        subjects_tried: todoSubjects.length,
        subjects_found: foundSubjects,
      },
    });
  }
}
