import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LibraryService } from '../library/library.service';
import type { FederationFile } from './federation';

/**
 * library/federation.json: who follows you and whom you follow. It holds the tokens you use
 * to pull friends' data (and hashes of the ones you issued), so it's readable by the owner
 * only, and never served.
 */
@Injectable()
export class FederationStore {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(library: LibraryService) {
    this.file = join(library.root, 'federation.json');
  }

  async read(): Promise<FederationFile> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<FederationFile>;
      return {
        followers: Array.isArray(raw.followers) ? raw.followers : [],
        following: Array.isArray(raw.following) ? raw.following : [],
      };
    } catch {
      return { followers: [], following: [] };
    }
  }

  /** Changes the file one change at a time; `fn` edits it in place and returns a result. */
  update<T>(fn: (f: FederationFile) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.read();
      const out = await fn(data);
      await writeFile(`${this.file}.part`, JSON.stringify(data, null, 2), { mode: 0o600 });
      await rename(`${this.file}.part`, this.file);
      await chmod(this.file, 0o600).catch(() => undefined);
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
