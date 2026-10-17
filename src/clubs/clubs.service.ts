import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LibraryService } from '../library/library.service';
import { sameBook } from '../common/book-match';
import { progressOf, type Club } from './clubs';

/** library/clubs.json: the clubs this installation hosts, with their comments. */
@Injectable()
export class ClubsService {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly library: LibraryService) {
    this.file = join(library.root, 'clubs.json');
  }

  async list(): Promise<Club[]> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { clubs?: unknown };
      return Array.isArray(raw.clubs) ? (raw.clubs as Club[]) : [];
    } catch {
      return [];
    }
  }

  /** Changes the clubs one change at a time; `fn` edits the list in place. */
  update<T>(fn: (clubs: Club[]) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const clubs = await this.list();
      const out = fn(clubs);
      await writeFile(`${this.file}.part`, JSON.stringify({ clubs }, null, 2), 'utf8');
      await rename(`${this.file}.part`, this.file);
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** How far the owner is through each club's book, by club id. */
  async ownerProgress(clubs: Club[]): Promise<Map<string, number>> {
    let books: Record<string, unknown>[] = [];
    try {
      books = JSON.parse(await readFile(join(this.library.data, 'books.json'), 'utf8')) as Record<
        string,
        unknown
      >[];
    } catch {
      // no data yet
    }
    return new Map(
      clubs.map((c) => {
        const mine =
          (c.book.book_id && books.find((b) => b.id === c.book.book_id)) || sameBook(books, c.book);
        return [c.id, progressOf(mine || null)];
      }),
    );
  }
}
