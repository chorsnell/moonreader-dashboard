import { copyFile, link, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { appConfig, type AppConfigType } from '../config/app.config';
import { exists, findFiles, mtimeMs, newestFirst } from '../common/files';
import { SEED_CATALOGUE } from '../paths';
import { ActivityLogService } from './activity-log.service';
import { LIBRARY_CHANGED } from './library.events';

/** Makes an uploaded file name safe to use in the inbox. */
export function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/**
 * The library folder: where backups arrive (inbox/, dav/), where the page's data is
 * written (data/), covers, and catalogue.json.
 */
@Injectable()
export class LibraryService implements OnModuleInit {
  readonly root: string;
  readonly inbox: string;
  readonly data: string;
  readonly dav: string;
  readonly covers: string;
  readonly catalogue: string;
  /** What the metadata lookup found; an input to the build, like catalogue.json. */
  readonly metadata: string;

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly activity: ActivityLogService,
    private readonly events: EventEmitter2,
  ) {
    this.root = config.library;
    this.inbox = join(this.root, 'inbox');
    this.data = join(this.root, 'data');
    this.dav = join(this.root, 'dav');
    this.covers = join(this.root, 'covers');
    this.catalogue = join(this.root, 'catalogue.json');
    this.metadata = join(this.root, 'metadata.json');
  }

  /** Creates the folders and a starting catalogue.json on first run. */
  async onModuleInit(): Promise<void> {
    for (const dir of [this.inbox, this.data, this.dav, this.covers]) {
      await mkdir(dir, { recursive: true });
    }
    if (!(await exists(this.catalogue))) {
      await copyFile(SEED_CATALOGUE, this.catalogue);
      this.activity.log('Created catalogue.json from the built-in copy');
    }
  }

  /** Tells the rebuild watcher to look now rather than at its next poll, and why. */
  changed(reason?: string): void {
    this.events.emit(LIBRARY_CHANGED, reason);
  }

  /** The backups in inbox/, newest first. */
  async backups(): Promise<string[]> {
    const names = await readdir(this.inbox).catch(() => [] as string[]);
    return newestFirst(
      names
        .filter((f) => f.toLowerCase().endsWith('.mrpro') && !f.startsWith('.'))
        .map((f) => join(this.inbox, f)),
    );
  }

  /** The newest backup, if it, catalogue.json, metadata.json or a synced position is newer than the data. */
  async needsBuild(): Promise<string | null> {
    const [newest] = await this.backups();
    if (!newest) return null;
    const built = await mtimeMs(join(this.data, 'meta.json'));
    const syncs = await Promise.all((await findFiles(this.dav, '.po')).map(mtimeMs));
    const changed = Math.max(
      await mtimeMs(newest),
      await mtimeMs(this.catalogue),
      await mtimeMs(this.metadata),
      ...syncs,
    );
    return changed > built ? newest : null;
  }

  /** Keeps the newest backups in inbox/ and dav/ and deletes the rest. Returns what was removed. */
  async pruneBackups(): Promise<string[]> {
    const keep = this.config.keepBackups;
    const dav = await newestFirst(await findFiles(this.dav, '.mrpro'));
    const old = [...(await this.backups()).slice(keep), ...dav.slice(keep)];
    const removed: string[] = [];
    for (const file of old) {
      try {
        await rm(file);
        removed.push(file);
      } catch {
        // already gone
      }
    }
    return removed;
  }

  /** Sets a backup that failed to build aside as .failed, so it isn't retried. */
  async setAside(backup: string): Promise<boolean> {
    try {
      await rename(backup, `${backup}.failed`);
      return true;
    } catch {
      return false;
    }
  }

  /** A backup arrived over WebDAV: put it in the inbox and rebuild. Returns its inbox name. */
  async receiveBackup(src: string, name: string, reason = 'webdav'): Promise<string> {
    const safe = safeFileName(name);
    const dest = join(this.inbox, safe);
    if (src !== dest) {
      const part = `${dest}.part`;
      await rm(part, { force: true });
      try {
        await link(src, part); // a hard link costs no extra space when inbox/ and dav/ share a disk
      } catch {
        await copyFile(src, part);
      }
      await rename(part, dest);
    }
    this.changed(reason);
    return safe;
  }

  async hasData(): Promise<boolean> {
    return exists(join(this.data, 'books.json'));
  }

  /** data/meta.json, or {} before the first build. */
  async meta(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(join(this.data, 'meta.json'), 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      return {};
    }
  }

  /** A path relative to the library, for log messages. */
  relative(path: string): string {
    return path.startsWith(this.root) ? path.slice(this.root.length + 1) : basename(path);
  }
}
