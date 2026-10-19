import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { BookHistory } from '../backup-import/reading-history.types';
import { appConfig, type AppConfigType } from '../config/app.config';
import { LibraryService } from '../library/library.service';
import {
  UNTAGGED,
  suggestFromPeers,
  suggestFromSubjects,
  vocabulary,
  type GenreSuggestion,
  type TaggedBook,
} from '../metadata/genre-suggest';
import { catalogueEntry } from '../metadata/merge';
import { MetadataStore } from '../metadata/metadata-store.service';
import { CatalogueService, toCatalogueChange, type CatalogueChange } from './catalogue.service';

/** A book with a genre suggestion, as Admin → Catalogue shows it. */
export interface SuggestionRow {
  id: string;
  title: string;
  author: string;
  series: string | null;
  /** What the book has now ("Untagged" for an untagged one). */
  genre: string;
  subgenre: string;
  suggestion: GenreSuggestion;
  /** What the subjects alone say, when the suggestion follows the series or author instead. */
  from_subjects: GenreSuggestion | null;
  /** Every subject Open Library has for it (null: not looked up yet). */
  subjects: string[] | null;
}

export interface Suggestions {
  /** Whether the metadata lookup, which finds the subjects, is on. */
  lookup: boolean;
  /** Untagged books with a suggestion. */
  untagged: SuggestionRow[];
  /** Untagged books with nothing to go on yet (subjects not looked up, or none that help). */
  untagged_without: number;
  /** Tagged books whose subjects point at another genre than the catalogue's. */
  review: SuggestionRow[];
}

interface Rejected {
  genre: string;
  subgenre: string;
}

/** library/genre-suggestions.json: suggestions the owner turned down, by book id. */
interface ReviewFile {
  rejected: Record<string, Rejected[]>;
}

const MAX_ITEMS = 1000;
const same = (a: Rejected, b: Rejected) =>
  a.genre.toLowerCase() === b.genre.toLowerCase() &&
  a.subgenre.toLowerCase() === b.subgenre.toLowerCase();

/** Checks the items of an accept or reject body: [{ id, genre, subgenre }]. */
export function toSuggestionItems(
  body: unknown,
): { id: string; genre: string; subgenre: string }[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) {
    throw new BadRequestException({ error: 'Say which suggestions.' });
  }
  return items.map((raw) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    const id = typeof i.id === 'string' ? i.id : '';
    const genre = typeof i.genre === 'string' ? i.genre.trim() : '';
    const subgenre = typeof i.subgenre === 'string' ? i.subgenre.trim() : '';
    if (!/^[a-z0-9-]+$/.test(id) || !genre || genre === UNTAGGED || genre.length > 300) {
      throw new BadRequestException({ error: 'Each suggestion needs a book and a genre.' });
    }
    if (subgenre.length > 300)
      throw new BadRequestException({ error: 'That subgenre is too long.' });
    return { id, genre, subgenre };
  });
}

/**
 * Genre suggestions for Admin → Catalogue: for untagged books, from the series or author's
 * other books or the book's Open Library subjects; and, to check the starter catalogue's
 * guesses, tagged books whose subjects disagree. Nothing changes until the owner accepts a
 * suggestion, which is saved to catalogue.json like any edit; catalogue.json always wins.
 */
@Injectable()
export class GenreSuggestionsService {
  private saving: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly catalogue: CatalogueService,
    private readonly metadata: MetadataStore,
  ) {}

  async list(): Promise<Suggestions> {
    const [catalogue, history, subjects, review] = await Promise.all([
      this.catalogue.read(),
      this.catalogue.history(),
      this.metadata.readSubjects(),
      this.readReview(),
    ]);
    // the owner's own words: every pair catalogue.json uses
    const entries = Object.values(catalogue.books);
    const tagged: TaggedBook[] = entries.map((e) => ({
      title: e.title,
      author: e.author,
      series: e.series ?? null,
      genre: e.genre ?? UNTAGGED,
      subgenre: e.subgenre ?? UNTAGGED,
    }));
    const vocab = vocabulary(tagged);
    const rejected = (id: string, s: GenreSuggestion | null) =>
      !!s && (review.rejected[id] ?? []).some((r) => same(r, s));

    const untagged: SuggestionRow[] = [];
    const reviewRows: SuggestionRow[] = [];
    let without = 0;
    for (const b of history) {
      const found = subjects.books[b.id]?.subjects ?? null;
      const bySubjects = found?.length ? suggestFromSubjects(found, vocab) : null;
      const row = (suggestion: GenreSuggestion, alt: GenreSuggestion | null): SuggestionRow => ({
        id: b.id,
        title: b.title,
        author: b.author,
        series: b.series,
        genre: b.genre,
        subgenre: b.subgenre,
        suggestion,
        from_subjects: alt,
        subjects: found,
      });
      // "Untagged" as the catalogue editor shows it: no genre, or a file catalogue.json lacks
      const isUntagged =
        b.genre === UNTAGGED || b.source_files.some((f) => !catalogue.books[f.toLowerCase()]);
      if (isUntagged) {
        const byPeers = suggestFromPeers(b, tagged);
        const pick = [byPeers, bySubjects].find((s) => s && !rejected(b.id, s)) ?? null;
        if (!pick) {
          without++;
          continue;
        }
        const alt =
          pick.basis !== 'subjects' &&
          bySubjects &&
          (bySubjects.genre !== pick.genre || bySubjects.subgenre !== pick.subgenre)
            ? bySubjects
            : null;
        untagged.push(row(pick, alt));
      } else if (
        bySubjects &&
        bySubjects.confidence !== 'low' &&
        bySubjects.genre !== b.genre &&
        catalogueEntry(b, catalogue) &&
        !rejected(b.id, bySubjects)
      ) {
        reviewRows.push(row(bySubjects, null));
      }
    }
    const byTitle = (a: SuggestionRow, b: SuggestionRow) => a.title.localeCompare(b.title);
    return {
      lookup: this.config.metadataLookup,
      untagged: untagged.sort(byTitle),
      untagged_without: without,
      review: reviewRows.sort(byTitle),
    };
  }

  /** Saves the genres to catalogue.json (one write, one rebuild). Returns how many. */
  async accept(items: { id: string; genre: string; subgenre: string }[]): Promise<number> {
    const history = new Map((await this.catalogue.history()).map((b) => [b.id, b]));
    const changes: CatalogueChange[] = [];
    for (const item of items) {
      const b: BookHistory | undefined = history.get(item.id);
      if (!b) continue; // gone since the list was drawn
      changes.push(
        toCatalogueChange({
          files: b.source_files,
          title: b.title,
          author: b.author,
          series: b.series,
          series_no: b.series_no,
          genre: item.genre,
          subgenre: item.subgenre,
        }),
      );
    }
    if (!changes.length) {
      throw new BadRequestException({ error: 'Those books aren’t in the dashboard any more.' });
    }
    await this.catalogue.saveMany(changes, {
      message:
        changes.length === 1
          ? `Catalogue: accepted the genre suggestion for "${changes[0].entry.title}"`
          : `Catalogue: accepted ${changes.length} genre suggestions`,
      details: {
        accepted: changes.map((c) => ({
          title: c.entry.title,
          genre: c.entry.genre,
          subgenre: c.entry.subgenre,
        })),
      },
    });
    return changes.length;
  }

  /** Remembers suggestions the owner turned down, so they aren't offered again. */
  reject(items: { id: string; genre: string; subgenre: string }[]): Promise<void> {
    const run = this.saving.then(async () => {
      const review = await this.readReview();
      for (const { id, genre, subgenre } of items) {
        const list = (review.rejected[id] ??= []);
        if (!list.some((r) => same(r, { genre, subgenre }))) list.push({ genre, subgenre });
      }
      const file = this.file;
      await writeFile(`${file}.part`, `${JSON.stringify(review, null, 1)}\n`, 'utf8');
      await rename(`${file}.part`, file);
    });
    this.saving = run.catch(() => undefined);
    return run;
  }

  private async readReview(): Promise<ReviewFile> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<ReviewFile>;
      return { rejected: raw.rejected && typeof raw.rejected === 'object' ? raw.rejected : {} };
    } catch {
      return { rejected: {} };
    }
  }

  private get file(): string {
    return join(this.library.root, 'genre-suggestions.json');
  }
}
