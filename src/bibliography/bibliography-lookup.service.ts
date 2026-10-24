import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { localDate } from '../common/time';
import { OpenLibraryClient, type AuthorDoc } from '../covers/open-library.client';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { MetadataStore } from '../metadata/metadata-store.service';
import type { MetadataFile } from '../metadata/metadata.types';
import { WikidataClient } from '../metadata/wikidata.client';
import { BibliographyStore } from './bibliography-store.service';
import type { BibliographyAuthor } from './bibliography.types';
import { authorId, bibliographyAuthors, type LibraryBook } from './build';
import { DiscoverySettings } from './discovery-settings.service';
import { discoveryTargets, subjectsToLookUp, subjectWorks, type PickBook } from './genre-picks';
import { keepWorks, mergeWikidata } from './works';

/** Authors are looked up again, and misses retried, after this many days. */
export const REFRESH_DAYS = 30;
/** At most this many authors are looked up per round. */
export const AUTHORS_PER_ROUND = 40;
/** Give up on a service for this round after this many failures in a row. */
const MAX_FAILURES = 3;

/** A name as plain lower-case words, "Surname, First" turned round: for comparing names. */
export function plainName(name: string): string {
  const turned = name.includes(',') ? name.split(',').reverse().join(' ') : name;
  return turned
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/**
 * Whether Open Library's author name is the author books.json names: the same words once
 * case, accents, punctuation and "Surname, First" order are ignored, or the same surname and
 * first initial ("H. G. Wells" and "Herbert George Wells").
 */
export function sameName(ours: string, theirs: string | undefined): boolean {
  const a = plainName(ours).split(' ').filter(Boolean);
  const b = plainName(theirs ?? '')
    .split(' ')
    .filter(Boolean);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ') || a.join('') === b.join('')) return true;
  return a.length > 1 && b.length > 1 && a.at(-1) === b.at(-1) && a[0][0] === b[0][0];
}

/** The first of Open Library's author search results whose name matches, as an author key. */
export function pickAuthor(name: string, docs: readonly AuthorDoc[]): string | null {
  for (const d of docs) {
    const key = typeof d?.key === 'string' ? d.key.replace(/^\/?authors\//, '') : '';
    if (/^OL\d+A$/.test(key) && sameName(name, d.name)) return key;
  }
  return null;
}

/**
 * The Open Library author key and Wikidata item the metadata lookup found for an author: the
 * author key of one of their books (a book of theirs alone first), and the Wikidata item of
 * their own entry in metadata.json, else of a book they wrote first.
 */
export function knownIds(
  id: string,
  books: readonly LibraryBook[],
  metadata: MetadataFile,
): { authorKey: string | null; wikidata: string | null } {
  const theirs = books
    .filter((b) => authorId(b.author) === id)
    .sort(
      (a, b) =>
        Number((b.author ?? '').toLowerCase() === id) -
        Number((a.author ?? '').toLowerCase() === id),
    );
  let authorKey: string | null = null;
  let wikidata: string | null = metadata.authors[id]?.wikidata ?? null;
  for (const b of theirs) {
    authorKey ??= (b.id && metadata.books[b.id]?.author_key) || null;
    wikidata ??= metadata.authors[(b.author ?? '').toLowerCase()]?.wikidata ?? null;
  }
  return {
    authorKey: authorKey ? authorKey.replace(/^\/?authors\//, '') : null,
    wikidata: wikidata && /^Q\d+$/.test(wikidata) ? wikidata : null,
  };
}

/**
 * Looks up the other books by the authors you read, and the rest of the series you read, on
 * Open Library and Wikidata (BOO-103), in the background after the metadata lookup. What it
 * finds goes in library/bibliography.json, which the next build turns into
 * data/bibliography.json.
 */
@Injectable()
export class BibliographyLookupService implements OnApplicationShutdown {
  private running: Promise<void> | null = null;
  private readonly stop = new AbortController();
  private lastOpenLibrary = 0;

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly store: BibliographyStore,
    private readonly metadata: MetadataStore,
    private readonly openLibrary: OpenLibraryClient,
    private readonly wikidata: WikidataClient,
    private readonly activity: ActivityLogService,
    private readonly discovery: DiscoverySettings,
  ) {}

  /** Looks up what's due; resolves when done (or joins a lookup already running). */
  run(trigger = 'rebuild'): Promise<void> {
    if (!this.config.bibliographyLookup || !this.config.metadataLookup) return Promise.resolve();
    if (this.stop.signal.aborted) return Promise.resolve();
    this.running ??= this.lookUp(trigger)
      .catch((e: unknown) => {
        if (this.stop.signal.aborted) return;
        this.activity.record({
          type: 'metadata',
          message: 'Bibliography lookup failed',
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

  /** Open Library requests are spaced COVER_PAUSE apart (Wikidata's client paces its own). */
  private async paceOpenLibrary(): Promise<void> {
    const wait = this.lastOpenLibrary + this.config.coverPauseMs - Date.now();
    if (wait > 0) await sleep(wait, undefined, { signal: this.stop.signal });
    this.lastOpenLibrary = Date.now();
  }

  private async lookUp(trigger: string): Promise<void> {
    let books: LibraryBook[];
    try {
      books = JSON.parse(
        await readFile(join(this.library.data, 'books.json'), 'utf8'),
      ) as LibraryBook[];
      if (!Array.isArray(books)) return;
    } catch {
      return; // no data yet
    }
    await this.lookUpAuthors(books, trigger);
    if (!this.stop.signal.aborted) await this.lookUpSubjects(books, trigger);
  }

  /**
   * The Open Library subjects of your genres and subgenres (BOO-105), for
   * data/genre_picks.json: each subject that's due (never looked up, or REFRESH_DAYS ago),
   * one request each. A subject with no works is a miss, retried after REFRESH_DAYS.
   */
  private async lookUpSubjects(books: readonly PickBook[], trigger: string): Promise<void> {
    const started = Date.now();
    const overrides = await this.discovery.overrides();
    const file = await this.store.read();
    const misses = await this.store.readMisses();
    const subjects = (file.subjects ??= {});
    const missed = (misses.subjects ??= {});
    const today = localDate();
    const refreshFrom = localDate(new Date(Date.now() - REFRESH_DAYS * 86_400_000));
    const todo = subjectsToLookUp(discoveryTargets(books, overrides)).filter(
      (s) => (subjects[s]?.looked_up ?? '') < refreshFrom && (missed[s] ?? '') < refreshFrom,
    );
    if (!todo.length) return;

    const signal = this.stop.signal;
    let failures = 0;
    let unreachable = '';
    let found = 0;
    let empty = 0;
    let changed = false;
    this.activity.log(`  Looking up ${todo.length} Open Library subject(s) for your genres`);
    for (const slug of todo) {
      if (signal.aborted) break;
      try {
        await this.paceOpenLibrary();
        const works = subjectWorks(await this.openLibrary.subjectWorks(slug, signal));
        failures = 0;
        if (!works.length) {
          missed[slug] = today;
          empty++;
          continue;
        }
        subjects[slug] = { looked_up: today, works };
        delete missed[slug];
        changed = true;
        found++;
      } catch (e) {
        if (signal.aborted) break;
        if (++failures >= MAX_FAILURES) {
          unreachable = (e as Error).message;
          break;
        }
      }
    }

    await this.store.writeMisses(misses);
    // like the authors: a new bibliography.json rebuilds, which writes data/genre_picks.json
    if (changed) {
      await this.store.write(file);
      this.library.changed('bibliography');
    }
    if (signal.aborted) return;
    this.activity.record({
      type: 'metadata',
      message: unreachable
        ? `Genre picks lookup stopped early: Open Library could not be reached. Found ${found} of ${todo.length} subject(s) first; the rest will be tried after the next rebuild`
        : `Found popular books for ${found} of ${todo.length} genre subject(s) on Open Library; the rest are retried after ${REFRESH_DAYS} days`,
      outcome: unreachable ? 'failed' : 'ok',
      error: unreachable || undefined,
      trigger,
      duration_ms: Date.now() - started,
      details: {
        subjects_tried: todo.length,
        subjects_found: found,
        subjects_empty: empty,
      },
    });
  }

  private async lookUpAuthors(books: LibraryBook[], trigger: string): Promise<void> {
    const started = Date.now();
    const metadata = await this.metadata.read();
    const file = await this.store.read();
    const misses = await this.store.readMisses();
    const today = localDate();
    const refreshFrom = localDate(new Date(Date.now() - REFRESH_DAYS * 86_400_000));
    const todo = bibliographyAuthors(books)
      .filter(
        (a) =>
          (file.authors[a.id]?.looked_up ?? '') < refreshFrom &&
          (misses.authors[a.id] ?? '') < refreshFrom,
      )
      .slice(0, AUTHORS_PER_ROUND);
    if (!todo.length) return;

    const signal = this.stop.signal;
    const failures = { openlibrary: 0, wikidata: 0 };
    let unreachable = '';
    let found = 0;
    let missed = 0;
    let changed = false;
    this.activity.log(`  Looking up the bibliographies of ${todo.length} author(s)`);
    for (const author of todo) {
      if (signal.aborted) break;
      const known = knownIds(author.id, books, metadata);
      let entry: BibliographyAuthor | null = null;
      try {
        let key = known.authorKey;
        if (!key) {
          await this.paceOpenLibrary();
          key = pickAuthor(
            author.name,
            await this.openLibrary.searchAuthors(plainName(author.name), signal),
          );
        }
        if (!key) {
          misses.authors[author.id] = today;
          missed++;
          failures.openlibrary = 0;
          continue;
        }
        await this.paceOpenLibrary();
        const works = keepWorks(await this.openLibrary.authorWorks(key, signal));
        failures.openlibrary = 0;
        entry = { author_key: key, wikidata: known.wikidata, looked_up: today, works };
      } catch (e) {
        if (signal.aborted) break;
        if (++failures.openlibrary >= MAX_FAILURES) {
          unreachable = (e as Error).message;
          break;
        }
        continue;
      }

      // series from Wikidata; while it can't be reached, Open Library's works are kept and
      // the author is tried again next round
      if (failures.wikidata < MAX_FAILURES) {
        try {
          if (!entry.wikidata) {
            await this.paceOpenLibrary();
            entry.wikidata = await this.openLibrary.authorWikidata(entry.author_key!, signal);
          }
          if (entry.wikidata) {
            entry.works = mergeWikidata(
              entry.works,
              await this.wikidata.authorWorks(entry.wikidata, signal),
            );
          }
          failures.wikidata = 0;
        } catch (e) {
          if (signal.aborted) break;
          entry.looked_up = file.authors[author.id]?.looked_up ?? '';
          if (++failures.wikidata >= MAX_FAILURES) unreachable ||= (e as Error).message;
        }
      } else {
        entry.looked_up = file.authors[author.id]?.looked_up ?? '';
      }
      file.authors[author.id] = entry;
      delete misses.authors[author.id];
      changed = true;
      found++;
    }

    await this.store.writeMisses(misses);
    // a new bibliography.json makes the watcher rebuild, which writes data/bibliography.json
    if (changed) {
      await this.store.write(file);
      this.library.changed('bibliography');
    }
    if (signal.aborted) return;
    const works = Object.values(file.authors).reduce((n, a) => n + a.works.length, 0);
    this.activity.record({
      type: 'metadata',
      message: unreachable
        ? `Bibliography lookup stopped early: a service could not be reached. Found ${found} of ${todo.length} author(s) first; the rest will be tried after the next rebuild`
        : `Found the bibliographies of ${found} of ${todo.length} author(s); the rest are retried after ${REFRESH_DAYS} days`,
      outcome: unreachable ? 'failed' : 'ok',
      error: unreachable || undefined,
      trigger,
      duration_ms: Date.now() - started,
      details: {
        bibliography_authors_tried: todo.length,
        bibliography_authors_found: found,
        bibliography_authors_missed: missed,
        bibliography_works: works,
      },
    });
  }
}
