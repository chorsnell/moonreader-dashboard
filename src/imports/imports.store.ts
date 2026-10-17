import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { mtimeMs } from '../common/files';
import { IMPORT_SOURCES, type ImportFile, type ImportSource } from './imports.types';

/** The imports kept in the library folder: goodreads.json, storygraph.json… */
@Injectable()
export class ImportsStore {
  private readonly root: string;

  constructor(@Inject(appConfig.KEY) config: AppConfigType) {
    this.root = config.library;
  }

  path(source: ImportSource): string {
    return join(this.root, `${source}.json`);
  }

  async get(source: ImportSource): Promise<ImportFile | null> {
    try {
      const f = JSON.parse(await readFile(this.path(source), 'utf8')) as ImportFile;
      return f && Array.isArray(f.books) ? { ...f, source } : null;
    } catch {
      return null;
    }
  }

  /** Every import there is, in a fixed order (Goodreads before StoryGraph). */
  async all(): Promise<ImportFile[]> {
    const out: ImportFile[] = [];
    for (const s of IMPORT_SOURCES) {
      const f = await this.get(s);
      if (f) out.push(f);
    }
    return out;
  }

  async save(file: ImportFile): Promise<void> {
    const path = this.path(file.source);
    await writeFile(`${path}.part`, JSON.stringify(file, null, 1), 'utf8');
    await rename(`${path}.part`, path);
  }

  async remove(source: ImportSource): Promise<boolean> {
    if (!(await mtimeMs(this.path(source)))) return false;
    await rm(this.path(source), { force: true });
    return true;
  }

  /** The newest import's modification time (0 with none), for the rebuild watcher. */
  async newest(): Promise<number> {
    return Math.max(0, ...(await Promise.all(IMPORT_SOURCES.map((s) => mtimeMs(this.path(s))))));
  }
}
