import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LibraryService } from '../library/library.service';
import { imageExt, shrinkPng } from './png';

/** A saved cover's file name: <book id>.jpg or <book id>.png. */
export const COVER_NAME = /^([a-z0-9-]+)\.(jpg|png)$/;
const BOOK_ID = /^[a-z0-9-]+$/;

/** Book id -> the day a lookup last found nothing (YYYY-MM-DD). */
export type Misses = Record<string, string>;

/**
 * library/covers/: one image per book, named after the book id. An existing file is never
 * replaced, so people can put their own image there.
 */
@Injectable()
export class CoverStore {
  constructor(private readonly library: LibraryService) {}

  get dir(): string {
    return this.library.covers;
  }

  /** Book id -> file name, for every cover saved so far. */
  async existing(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const names = await readdir(this.dir).catch(() => [] as string[]);
    for (const f of names.sort()) {
      const m = COVER_NAME.exec(f);
      if (m && !out.has(m[1])) out.set(m[1], f);
    }
    return out;
  }

  /** Saves a cover unless the book already has one. Returns true if it was written. */
  async save(bookId: string, image: Buffer): Promise<boolean> {
    if (!imageExt(image) || !BOOK_ID.test(bookId) || (await this.existing()).has(bookId)) {
      return false;
    }
    const data = imageExt(image) === 'png' ? shrinkPng(image) : image;
    const path = join(this.dir, `${bookId}.${imageExt(data)}`);
    await mkdir(this.dir, { recursive: true });
    await writeFile(`${path}.part`, data);
    await rename(`${path}.part`, path);
    return true;
  }

  /** {book id: URL} for every saved cover; the mtime in the URL lets browsers cache them for good. */
  async urls(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [id, file] of await this.existing()) {
      try {
        const { mtimeMs } = await stat(join(this.dir, file));
        out[id] = `covers/${file}?v=${Math.floor(mtimeMs / 1000)}`;
      } catch {
        // removed in the meantime
      }
    }
    return out;
  }

  async readMisses(): Promise<Misses> {
    try {
      return JSON.parse(await readFile(this.missesFile, 'utf8')) as Misses;
    } catch {
      return {};
    }
  }

  async writeMisses(misses: Misses): Promise<void> {
    await writeFile(this.missesFile, JSON.stringify(misses), 'utf8');
  }

  private get missesFile(): string {
    return join(this.dir, '.misses.json');
  }
}
