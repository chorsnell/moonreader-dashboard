import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LibraryService } from '../library/library.service';

/** One document's latest position, as KOSync keeps it. */
export interface KosyncProgress {
  /** An xpointer for reflowable books, a page number for paged ones. */
  progress: string;
  /** 0..1. */
  percentage: number;
  device: string;
  device_id: string;
  /** Seconds since 1970, set by the server when the position arrives. */
  timestamp: number;
}

/**
 * The positions KOReader devices send through progress sync, keyed by KOSync's document id
 * (the book file's partial MD5, or the MD5 of its file name), in
 * library/progress-sync/koreader.json.
 */
@Injectable()
export class ProgressStore {
  private cache: Record<string, KosyncProgress> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly library: LibraryService) {}

  get dir(): string {
    return join(this.library.root, 'progress-sync');
  }
  private get path(): string {
    return join(this.dir, 'koreader.json');
  }

  async get(document: string): Promise<KosyncProgress | null> {
    return (await this.load())[document] ?? null;
  }

  async all(): Promise<Record<string, KosyncProgress>> {
    return { ...(await this.load()) };
  }

  /** Saves a position, one write at a time. */
  put(document: string, progress: KosyncProgress): Promise<void> {
    const run = this.queue.then(async () => {
      const all = await this.load();
      all[document] = progress;
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(all, null, 1));
      await rename(tmp, this.path);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<Record<string, KosyncProgress>> {
    if (this.cache) return this.cache;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      this.cache =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, KosyncProgress>)
          : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }
}
