import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { exists } from '../common/files';
import { LibraryService } from '../library/library.service';
import {
  type BookRef,
  emptyPrices,
  normalisePrices,
  type PricesFile,
  servedPrices,
} from './prices';

export type LibraryBook = BookRef & Record<string, unknown>;

/**
 * library/prices.json, and the copy of it the page reads (data/prices.json), rewritten
 * whenever the prices change. Money is kept in that one data file so it can be held back
 * from viewers who shouldn't see it.
 */
@Injectable()
export class PricesService implements OnModuleInit {
  readonly file: string;
  readonly served: string;

  constructor(private readonly library: LibraryService) {
    this.file = join(library.root, 'prices.json');
    this.served = join(library.data, 'prices.json');
  }

  async onModuleInit(): Promise<void> {
    await this.publish();
  }

  async has(): Promise<boolean> {
    return exists(this.file);
  }

  async load(): Promise<PricesFile> {
    try {
      return normalisePrices(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return emptyPrices();
    }
  }

  /** Loads, changes and saves the prices, one change at a time. Returns what `change` did. */
  update<T>(change: (prices: PricesFile) => { prices: PricesFile; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const { prices, result } = change(await this.load());
      await writeAtomic(this.file, JSON.stringify(prices, null, 1));
      await this.publish(prices);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  private queue: Promise<unknown> = Promise.resolve();

  /** Writes data/prices.json from prices.json, or removes it when there are no prices. */
  async publish(prices?: PricesFile): Promise<void> {
    if (!prices && !(await this.has())) {
      await rm(this.served, { force: true });
      return;
    }
    await mkdir(this.library.data, { recursive: true });
    await writeAtomic(this.served, JSON.stringify(servedPrices(prices ?? (await this.load()))));
  }

  /** The books of the last build, for matching and the admin's list. */
  async books(): Promise<LibraryBook[]> {
    try {
      const rows: unknown = JSON.parse(
        await readFile(join(this.library.data, 'books.json'), 'utf8'),
      );
      return Array.isArray(rows) ? (rows as LibraryBook[]) : [];
    } catch {
      return [];
    }
  }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await writeFile(`${path}.tmp`, text, 'utf8');
  await rename(`${path}.tmp`, path);
}
