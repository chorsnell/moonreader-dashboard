import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { localDate } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { CoverStore } from './cover-store.service';
import { OpenLibraryClient } from './open-library.client';

/** Books Open Library doesn't know are tried again after this many days. */
export const RETRY_DAYS = 30;
/** Give up for this round after this many lookups in a row fail to reach Open Library. */
const MAX_FAILURES = 3;

interface BookRow {
  id: string;
  title: string;
  author?: string | null;
}

/**
 * Looks up the covers the backup didn't have on Open Library, in the background, one book at
 * a time. It takes a few minutes the first time; later runs only try new books.
 */
@Injectable()
export class CoverLookupService implements OnApplicationShutdown {
  private running: Promise<void> | null = null;
  private readonly stop = new AbortController();

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly store: CoverStore,
    private readonly openLibrary: OpenLibraryClient,
    private readonly activity: ActivityLogService,
  ) {}

  /** Starts a lookup unless one is already running or lookups are off. Doesn't wait for it. */
  start(): void {
    void this.run();
  }

  /** Looks up the missing covers and resolves when done (or joins a lookup already running). */
  run(): Promise<void> {
    if (!this.config.coverLookup || this.stop.signal.aborted) return Promise.resolve();
    this.running ??= this.lookUpMissing()
      .catch((e: unknown) => {
        if (!this.stop.signal.aborted) this.activity.log(`Cover lookup failed: ${String(e)}`);
      })
      .finally(() => (this.running = null));
    return this.running;
  }

  /** Whether a lookup is running now. */
  get busy(): boolean {
    return this.running !== null;
  }

  async onApplicationShutdown(): Promise<void> {
    this.stop.abort();
    await this.running;
  }

  private async lookUpMissing(): Promise<void> {
    let books: BookRow[];
    try {
      books = JSON.parse(
        await readFile(join(this.library.data, 'books.json'), 'utf8'),
      ) as BookRow[];
    } catch {
      return; // no data yet, so no covers to look up
    }
    const misses = await this.store.readMisses();
    const today = localDate();
    const retryFrom = localDate(new Date(Date.now() - RETRY_DAYS * 86_400_000));
    const have = await this.store.existing();
    const todo = books.filter((b) => !have.has(b.id) && (misses[b.id] ?? '') < retryFrom);
    if (!todo.length) return;

    const signal = this.stop.signal;
    this.activity.log(`  Looking up ${todo.length} cover(s) on Open Library`);
    let found = 0;
    let failures = 0;
    for (const [n, book] of todo.entries()) {
      if (n) await sleep(this.config.coverPauseMs, undefined, { signal });
      let image: Buffer | null;
      try {
        const cover = await this.openLibrary.findCover(book.title, book.author ?? '', signal);
        image = cover ? await this.openLibrary.coverImage(cover, signal) : null;
      } catch (e) {
        if (signal.aborted) break;
        if (++failures >= MAX_FAILURES) {
          this.activity.log(
            `  Stopped: Open Library could not be reached (${(e as Error).message}). ` +
              'The rest will be tried after the next rebuild.',
          );
          break;
        }
        continue;
      }
      failures = 0;
      if (image && (await this.store.save(book.id, image))) {
        found++;
        delete misses[book.id];
      } else {
        misses[book.id] = today;
      }
      if (n % 20 === 19) await this.store.writeMisses(misses);
    }
    await this.store.writeMisses(misses);
    if (signal.aborted) return;
    const left = todo.filter((b) => b.id in misses).length;
    this.activity.log(
      `  Found ${found} cover(s) on Open Library` +
        (left ? `; ${left} book(s) not found, retried after ${RETRY_DAYS} days` : ''),
    );
  }
}
