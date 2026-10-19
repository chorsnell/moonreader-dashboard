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
import { catalogueEntry, normaliseCountry } from '../metadata/merge';
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
  /** catalogue.json's "finished": true or false by hand, null to leave it to the rules. */
  finished: boolean | null;
  /** Its file names, as Moon+ has them. */
  files: string[];
  /** True when a file isn't in catalogue.json, so the book is shown as "Untagged". */
  untagged: boolean;
  has_cover: boolean;
  /** The year and country entered by hand in catalogue.json (null: none). */
  published_year: number | null;
  author_country: string | null;
  /** What the last build shows for them (by hand, else what the metadata lookup found). */
  shown_published_year: number | null;
  shown_author_country: string | null;
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
  | 'author_gender'
  | 'finished';

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
  /** true or false to set "finished" by hand, null to clear it, left out to keep it. */
  finished?: boolean | null;
  /** A year (negative for BC) or an ISO 3166 code; null clears it, left out keeps it. */
  published_year?: number | null;
  author_country?: string | null;
}

const MAX_TEXT = 300;
/** Years go up to next year (pre-publication copies); BC years are negative. */
const maxYear = () => new Date().getFullYear() + 1;
const MAX_FILES = 50;

const asObject = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

function text(v: unknown, name: string, required = false): string {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (required && !s) throw new BadRequestException({ error: `Give the book a ${name}.` });
  if (s.length > MAX_TEXT) throw new BadRequestException({ error: `That ${name} is too long.` });
  return s;
}

const blank = (v: unknown) => v === null || (typeof v === 'string' && !v.trim());

/** A first-published year: left out keeps it, blank clears it. "1813", -400 and "400 BC" work. */
function optionalYear(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (blank(v)) return null;
  const s = String(v).trim();
  const bc = /^(\d{1,4})\s*(bc|bce)$/i.exec(s);
  const n = bc ? -Number(bc[1]) : /^-?\d{1,4}$/.test(s) ? Number(s) : NaN;
  if (!Number.isInteger(n) || n === 0 || n < -2999 || n > maxYear()) {
    throw new BadRequestException({
      error: `The year first published must be a whole year up to ${maxYear()} (e.g. 1813, or -400 or 400 BC).`,
    });
  }
  return n;
}

/** An author's country as an ISO code: left out keeps it, blank clears it. */
function optionalCountry(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (blank(v)) return null;
  const code = normaliseCountry(typeof v === 'string' ? v : '');
  if (!code) {
    throw new BadRequestException({
      error: 'That country isn’t one I know: use its English name or a two-letter code (GB, US…).',
    });
  }
  return code;
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
  const finished =
    b.finished === true || b.finished === false || b.finished === null ? b.finished : undefined;
  const publishedYear = optionalYear(b.published_year);
  const authorCountry = optionalCountry(b.author_country);
  return {
    files,
    exclude,
    ...(finished !== undefined && !exclude ? { finished } : {}),
    ...(publishedYear !== undefined && !exclude ? { published_year: publishedYear } : {}),
    ...(authorCountry !== undefined && !exclude ? { author_country: authorCountry } : {}),
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

  /** The books of the last build (none before the first). */
  async history(): Promise<BookHistory[]> {
    try {
      const raw = JSON.parse(
        await readFile(join(this.library.data, 'reading_history.json'), 'utf8'),
      ) as { books?: BookHistory[] };
      return raw.books ?? [];
    } catch {
      return []; // no build yet
    }
  }

  /** Every book of the last build, untagged ones first. */
  async books(): Promise<CatalogueBook[]> {
    const catalogue = await this.read();
    const history = await this.history();
    const shown = new Map<
      string,
      { published_year?: number | null; author_country?: string | null }
    >();
    try {
      const rows = JSON.parse(await readFile(join(this.library.data, 'books.json'), 'utf8')) as {
        id: string;
        published_year?: number | null;
        author_country?: string | null;
      }[];
      for (const r of Array.isArray(rows) ? rows : []) shown.set(r.id, r);
    } catch {
      // no build yet
    }
    const covers = await this.covers.existing();
    return history
      .map((b) => {
        const entry = catalogueEntry(b, catalogue);
        return {
          id: b.id,
          title: b.title,
          author: b.author,
          series: b.series,
          series_no: b.series_no,
          genre: b.genre,
          subgenre: b.subgenre,
          isbn13: b.isbn13 ?? null,
          status: b.status,
          finished: entry?.finished ?? null,
          files: b.source_files,
          untagged:
            b.genre === 'Untagged' || b.source_files.some((f) => !catalogue.books[f.toLowerCase()]),
          has_cover: covers.has(b.id),
          published_year: Number.isInteger(entry?.published_year) ? entry!.published_year! : null,
          author_country: normaliseCountry(entry?.author_country) ?? null,
          shown_published_year: shown.get(b.id)?.published_year ?? null,
          shown_author_country: shown.get(b.id)?.author_country ?? null,
        };
      })
      .sort((a, b) => Number(b.untagged) - Number(a.untagged) || a.title.localeCompare(b.title));
  }

  /** Saves a change, then asks for a rebuild. */
  save(change: CatalogueChange): Promise<void> {
    return this.saveMany([change], {
      message: change.exclude
        ? `Catalogue: marked ${change.files.length} file(s) as not a book`
        : `Catalogue: saved "${change.entry.title}" (${change.files.length} file(s))`,
      details: {
        files: change.files,
        exclude: change.exclude,
        ...(change.exclude ? {} : change.entry),
        ...(change.finished !== undefined ? { finished: change.finished } : {}),
        ...(change.published_year !== undefined ? { published_year: change.published_year } : {}),
        ...(change.author_country !== undefined ? { author_country: change.author_country } : {}),
      },
    });
  }

  /** Saves several changes in one write and one rebuild, recorded as one activity. */
  saveMany(
    changes: CatalogueChange[],
    record: { message: string; details: Record<string, unknown> },
  ): Promise<void> {
    const run = this.saving.then(async () => {
      const catalogue = await this.read();
      const exclude = new Set(catalogue.exclude);
      for (const change of changes) applyChange(catalogue, exclude, change);
      catalogue.exclude = [...exclude].sort();
      const file = this.library.catalogue;
      await writeFile(`${file}.part`, `${JSON.stringify(catalogue, null, 1)}\n`, 'utf8');
      await rename(`${file}.part`, file);
      this.activity.record({ type: 'settings', trigger: 'admin', ...record });
    });
    this.saving = run.catch(() => undefined);
    return run.then(() => this.library.changed('catalogue'));
  }
}

/** Applies one change to the catalogue's entries and its exclude list. */
function applyChange(catalogue: Catalogue, exclude: Set<string>, change: CatalogueChange): void {
  for (const key of change.files.map((f) => f.toLowerCase())) {
    if (change.exclude) {
      exclude.add(key);
      delete catalogue.books[key];
      continue;
    }
    exclude.delete(key);
    const prev = catalogue.books[key];
    const kept = {
      isbn13: prev?.isbn13 ?? null,
      isbn10: prev?.isbn10 ?? null,
      ...(prev?.isbn && !prev.isbn13 && !prev.isbn10 ? { isbn: prev.isbn } : {}),
      ...(prev?.work_id ? { work_id: prev.work_id } : {}),
      ...Object.fromEntries(
        (['published_year', 'pages', 'author_country', 'author_gender', 'finished'] as const)
          .filter((k) => prev?.[k] != null)
          .map((k) => [k, prev![k]]),
      ),
    };
    const entry: CatalogueEntry = { ...kept, ...change.entry };
    if (change.entry.isbn13 !== undefined) delete entry.isbn;
    if (!entry.isbn13) delete entry.isbn13;
    if (!entry.isbn10) delete entry.isbn10;
    if (change.finished !== undefined) entry.finished = change.finished ?? undefined;
    if (entry.finished === undefined) delete entry.finished;
    if (change.published_year === null) delete entry.published_year;
    else if (change.published_year !== undefined) entry.published_year = change.published_year;
    if (change.author_country === null) delete entry.author_country;
    else if (change.author_country !== undefined) entry.author_country = change.author_country;
    catalogue.books[key] = entry;
  }
}
