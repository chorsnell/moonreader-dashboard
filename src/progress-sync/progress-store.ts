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

/** A position the dashboard wrote into a .po file for Moon+. */
export interface WrittenPosition {
  chapter: number;
  offset: number;
}

/** A JSON object in a file, read once and written one change at a time. */
class JsonMap<T> {
  private cache: Record<string, T> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: () => string,
    private readonly name: string,
  ) {}

  private get path(): string {
    return join(this.dir(), this.name);
  }

  async get(key: string): Promise<T | null> {
    return (await this.load())[key] ?? null;
  }

  async all(): Promise<Record<string, T>> {
    return { ...(await this.load()) };
  }

  set(key: string, value: T): Promise<void> {
    const run = this.queue.then(async () => {
      const all = await this.load();
      all[key] = value;
      await mkdir(this.dir(), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(all, null, 1));
      await rename(tmp, this.path);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<Record<string, T>> {
    if (this.cache) return this.cache;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      this.cache =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, T>)
          : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }
}

/**
 * What progress sync keeps, in library/progress-sync/:
 * - koreader.json: the positions KOReader devices send, keyed by KOSync's document id (the
 *   book file's partial MD5, or the MD5 of its file name);
 * - moonplus-written.json: the positions the dashboard wrote for Moon+, keyed by .po path,
 *   so they aren't mistaken for Moon+'s own when they come back.
 */
@Injectable()
export class ProgressStore {
  private readonly positions = new JsonMap<KosyncProgress>(() => this.dir, 'koreader.json');
  private readonly written = new JsonMap<WrittenPosition>(() => this.dir, 'moonplus-written.json');

  constructor(private readonly library: LibraryService) {}

  get dir(): string {
    return join(this.library.root, 'progress-sync');
  }

  get(document: string): Promise<KosyncProgress | null> {
    return this.positions.get(document);
  }

  all(): Promise<Record<string, KosyncProgress>> {
    return this.positions.all();
  }

  put(document: string, progress: KosyncProgress): Promise<void> {
    return this.positions.set(document, progress);
  }

  writtenFor(poPath: string): Promise<WrittenPosition | null> {
    return this.written.get(poPath);
  }

  wrote(poPath: string, position: WrittenPosition): Promise<void> {
    return this.written.set(poPath, position);
  }
}
