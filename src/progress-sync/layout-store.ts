import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LibraryService } from '../library/library.service';
import type { Layout } from './layout';
import { fileNameDigest } from './moonplus-files';

/**
 * Book page layouts from the KOReader plugin, in library/progress-sync/layouts/, one file per
 * KOSync document id: the book's partial MD5, and the MD5 of its file name (KOSync's other way
 * of naming a book).
 */
@Injectable()
export class LayoutStore {
  constructor(private readonly library: LibraryService) {}

  private get dir(): string {
    return join(this.library.root, 'progress-sync', 'layouts');
  }

  private path(document: string): string | null {
    return /^[0-9a-f]{32}$/.test(document) ? join(this.dir, `${document}.json`) : null;
  }

  async get(document: string): Promise<Layout | null> {
    const path = this.path(document.toLowerCase());
    if (!path) return null;
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Layout;
    } catch {
      return null;
    }
  }

  async put(layout: Layout): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const text = JSON.stringify(layout);
    const ids = new Set([layout.md5, ...(layout.file ? [fileNameDigest(layout.file)] : [])]);
    for (const id of ids) {
      const path = this.path(id)!;
      // a name of its own: two uploads of a book's layout may cross
      const tmp = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, text);
        await rename(tmp, path);
      } finally {
        await rm(tmp, { force: true });
      }
    }
  }
}
