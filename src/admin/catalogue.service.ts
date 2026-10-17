import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  BookHistory,
  Catalogue,
  CatalogueEntry,
} from '../backup-import/reading-history.types';
import { CoverStore } from '../covers/cover-store.service';
import { parseIsbn } from '../metadata/isbn';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';

/** One book of the last build, as the admin's catalogue editor shows it. */
export interface CatalogueBook {
  id: string;
  title: string;
  author: string;
  series: string | null;
  series_no: number | null;
  genre: string;
  subgenre: string;
  isbn13: string | null;
  status: string;
  /** Its file names, as Moon+ has them. */
  files: string[];
  /** True when a file isn't in catalogue.json, so the book is shown as "Untagged". */
  untagged: boolean;
  has_cover: boolean;
}

/** Fields the editor doesn't show; a save keeps whatever the entry has. */
type KeptFields =
  | 'isbn'
  | 'work_id'
  | 'isbn13'
  | 'isbn10'
  | 'published_year'
  | 'pages'
  | 'author_country'
  | 'author_gender';

/** A change to the catalogue entries of a book's files. */
export interface CatalogueChange {
  files: string[];
  /** True to list the files as "not a book" instead. */
  exclude: boolean;
  /**
   * isbn13/isbn10 are left as they were when the body has no isbn; work_id and the
   * hand-entered metadata (published_year, pages, author_country, author_gender) always are.
   */
  entry: Required<Omit<CatalogueEntry, KeptFields>> &
    Partial<Pick<CatalogueEntry, 'isbn13' | 'isbn10'>>;
}

const MAX_TEXT = 300;
const MAX_FILES = 50;

const asObject = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

function text(v: unknown, name: string, required = false): string {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (required && !s) throw new BadRequestException({ error: `Give the book a ${name}.` });
  if (s.length > MAX_TEXT) throw new BadRequestException({ error: `That ${name} is too long.` });
  return s;
}

/** Checks a PUT /api/admin/catalogue body. */
export function toCatalogueChange(body: unknown): CatalogueChange {
  const b = asObject(body);
  const files = Array.isArray(b.files) ? b.files.map((f) => String(f).trim()).filter(Boolean) : [];
  if (!files.length || files.length > MAX_FILES || files.some((f) => f.length > MAX_TEXT)) {
    throw new BadRequestException({ error: 'Say which book files to change.' });
  }
  const exclude = b.exclude === true;
  let seriesNo: number | null = null;
  if (b.series_no !== undefined && b.series_no !== null && b.series_no !== '') {
    seriesNo = Number(b.series_no);
    if (!Number.isFinite(seriesNo) || seriesNo < 0 || seriesNo > 100_000) {
      throw new BadRequestException({ error: 'The number in the series must be a number.' });
    }
  }
  const series = text(b.series, 'series');
  // an empty isbn clears it; a missing one keeps what the catalogue has
  let isbns: Partial<Pick<CatalogueEntry, 'isbn13' | 'isbn10'>> = {};
  if (b.isbn !== undefined && b.isbn !== null) {
    const raw = text(b.isbn, 'ISBN');
    const parsed = raw ? parseIsbn(raw) : { isbn13: null, isbn10: null };
    if (!parsed) throw new BadRequestException({ error: 'That isn’t a valid ISBN.' });
    isbns = parsed;
  }
  return {
    files,
    exclude,
    entry: {
      title: exclude ? '' : text(b.title, 'title', true),
      author: text(b.author, 'author'),
      series: series || null,
      series_no: series ? seriesNo : null,
      genre: text(b.genre, 'genre') || 'Untagged',
      subgenre: text(b.subgenre, 'subgenre') || 'Untagged',
      ...isbns,
    },
  };
}

/**
 * catalogue.json, edited from the admin page: who wrote each book file, its series and
 * genre. A save is written through a .part file, one at a time, and triggers a rebuild.
 */
@Injectable()
export class CatalogueService {
  private saving: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly library: LibraryService,
    private readonly covers: CoverStore,
    private readonly activity: ActivityLogService,
  ) {}

  async read(): Promise<Catalogue> {
    const raw = asObject(JSON.parse(await readFile(this.library.catalogue, 'utf8')));
    return {
      ...raw,
      books: asObject(raw.books) as Catalogue['books'],
      exclude: Array.isArray(raw.exclude) ? (raw.exclude as string[]) : [],
    };
  }

  /** Every book of the last build, untagged ones first. */
  async books(): Promise<CatalogueBook[]> {
    const catalogue = await this.read();
    let history: BookHistory[] = [];
    try {
      const raw = JSON.parse(
        await readFile(join(this.library.data, 'reading_history.json'), 'utf8'),
      ) as { books?: BookHistory[] };
      history = raw.books ?? [];
    } catch {
      // no build yet
    }
    const covers = await this.covers.existing();
    return history
      .map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        series: b.series,
        series_no: b.series_no,
        genre: b.genre,
        subgenre: b.subgenre,
        isbn13: b.isbn13 ?? null,
        status: b.status,
        files: b.source_files,
        untagged:
          b.genre === 'Untagged' || b.source_files.some((f) => !catalogue.books[f.toLowerCase()]),
        has_cover: covers.has(b.id),
      }))
      .sort((a, b) => Number(b.untagged) - Number(a.untagged) || a.title.localeCompare(b.title));
  }

  /** Saves a change, then asks for a rebuild. */
  save(change: CatalogueChange): Promise<void> {
    const run = this.saving.then(async () => {
      const catalogue = await this.read();
      const keys = change.files.map((f) => f.toLowerCase());
      const exclude = new Set(catalogue.exclude);
      for (const key of keys) {
        if (change.exclude) {
          exclude.add(key);
          delete catalogue.books[key];
        } else {
          exclude.delete(key);
          const prev = catalogue.books[key];
          const kept = {
            isbn13: prev?.isbn13 ?? null,
            isbn10: prev?.isbn10 ?? null,
            ...(prev?.isbn && !prev.isbn13 && !prev.isbn10 ? { isbn: prev.isbn } : {}),
            ...(prev?.work_id ? { work_id: prev.work_id } : {}),
            ...Object.fromEntries(
              (['published_year', 'pages', 'author_country', 'author_gender'] as const)
                .filter((k) => prev?.[k] != null)
                .map((k) => [k, prev![k]]),
            ),
          };
          const entry: CatalogueEntry = { ...kept, ...change.entry };
          if (change.entry.isbn13 !== undefined) delete entry.isbn;
          if (!entry.isbn13) delete entry.isbn13;
          if (!entry.isbn10) delete entry.isbn10;
          catalogue.books[key] = entry;
        }
      }
      catalogue.exclude = [...exclude].sort();
      const file = this.library.catalogue;
      await writeFile(`${file}.part`, `${JSON.stringify(catalogue, null, 1)}\n`, 'utf8');
      await rename(`${file}.part`, file);
      this.activity.record({
        type: 'settings',
        message: change.exclude
          ? `Catalogue: marked ${keys.length} file(s) as not a book`
          : `Catalogue: saved "${change.entry.title}" (${keys.length} file(s))`,
        trigger: 'admin',
        details: {
          files: change.files,
          exclude: change.exclude,
          ...(change.exclude ? {} : change.entry),
        },
      });
    });
    this.saving = run.catch(() => undefined);
    return run.then(() => this.library.changed('catalogue'));
  }
}
