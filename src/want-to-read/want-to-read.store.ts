import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { mtimeMs } from '../common/files';
import { appConfig, type AppConfigType } from '../config/app.config';
import { emptyWant, normaliseWant, type WantFile } from './want-to-read';

/** library/want_to_read.json: the owner's own want-to-read list (BOO-102). */
@Injectable()
export class WantStore {
  readonly file: string;

  constructor(@Inject(appConfig.KEY) config: AppConfigType) {
    this.file = join(config.library, 'want_to_read.json');
  }

  async load(): Promise<WantFile> {
    try {
      return normaliseWant(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return emptyWant();
    }
  }

  /** The file's modification time (0 without one), for the rebuild watcher. */
  mtime(): Promise<number> {
    return mtimeMs(this.file);
  }

  /** Loads, changes and saves the list, one change at a time. Returns what `change` did. */
  update<T>(change: (file: WantFile) => { file: WantFile; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const { file, result } = change(await this.load());
      await writeFile(`${this.file}.part`, JSON.stringify(file, null, 1), 'utf8');
      await rename(`${this.file}.part`, this.file);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  private queue: Promise<unknown> = Promise.resolve();
}
