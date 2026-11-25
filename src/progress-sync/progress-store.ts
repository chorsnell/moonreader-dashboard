import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LibraryService } from '../library/library.service';
import type { Mapping } from './layout';
import { type WrittenPlace, writtenPath } from './written';

/** One device's last push of a document, to know when it sends the same place again. */
export interface Sent {
  device_id: string;
  progress: string;
  percentage: number;
}

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
  /** The same moment in ms, to compare with .po files. */
  at?: number;
  /** From KOReader's "Send document metadata". */
  filename?: string;
  title?: string;
  /** What each device last sent. */
  sent?: Sent[];
}

/** Writes remembered per .po file, in case Moon+ sends back one older than the last. */
const REMEMBERED_WRITES = 10;

/** A JSON object in a file, read once and written one change at a time. */
class JsonMap<T> {
  private cache: Promise<Record<string, T>> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: () => string) {}

  async get(key: string): Promise<T | null> {
    const all = await this.load();
    // keys come from devices: "constructor" is not a document
    return Object.hasOwn(all, key) ? all[key] : null;
  }

  update(key: string, value: (old: T | null) => T): Promise<void> {
    const run = this.queue.then(async () => {
      const all = await this.load();
      const next = { ...all, [key]: value(Object.hasOwn(all, key) ? all[key] : null) };
      const path = this.path();
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(`${path}.tmp`, JSON.stringify(next, null, 1));
      await rename(`${path}.tmp`, path);
      this.cache = Promise.resolve(next);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** One read shared by everyone asking at once, so none replaces a newer copy. */
  private load(): Promise<Record<string, T>> {
    this.cache ??= readFile(this.path(), 'utf8')
      .then((text) => {
        const parsed: unknown = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, T>)
          : {};
      })
      .catch(() => ({}));
    return this.cache;
  }
}

/**
 * What progress sync keeps, in library/progress-sync/:
 * - koreader.json: the positions KOReader devices send, keyed by KOSync's document id (the
 *   book file's partial MD5, or the MD5 of its file name);
 * - moonplus-written.json: the places the dashboard wrote for Moon+, keyed by .po path,
 *   so they aren't mistaken for Moon+'s own when they come back;
 * - mappings.json: how Moon+'s chapters fitted each book, keyed by its partial MD5.
 */
@Injectable()
export class ProgressStore {
  private readonly positions = new JsonMap<KosyncProgress>(() => join(this.dir, 'koreader.json'));
  private readonly written = new JsonMap<WrittenPlace[]>(() => writtenPath(this.library.root));

  private readonly mappings = new JsonMap<Mapping>(() => join(this.dir, 'mappings.json'));

  constructor(private readonly library: LibraryService) {}

  get dir(): string {
    return join(this.library.root, 'progress-sync');
  }

  get(document: string): Promise<KosyncProgress | null> {
    return this.positions.get(document);
  }

  put(document: string, progress: KosyncProgress): Promise<void> {
    return this.positions.update(document, () => progress);
  }

  mapping(md5: string): Promise<Mapping | null> {
    return this.mappings.get(md5);
  }

  fitted(md5: string, mapping: Mapping): Promise<void> {
    return this.mappings.update(md5, () => mapping);
  }

  writtenFor(key: string): Promise<WrittenPlace[] | null> {
    return this.written.get(key);
  }

  wrote(key: string, place: WrittenPlace): Promise<void> {
    // anything but a list is from an earlier version, which kept one place per file
    return this.written.update(key, (old) =>
      [...(Array.isArray(old) ? old : []), place].slice(-REMEMBERED_WRITES),
    );
  }
}
