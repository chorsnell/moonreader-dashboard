import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminOnly } from '../access/admin.guard';
import { RequestBodyError, saveRequestBody } from '../common/http/request-body';
import { localDateTime } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { RebuildService } from '../rebuild/rebuild.service';
import { detectUpload } from './detect';
import { type FinishedBook, goodreadsCsv } from './goodreads';
import { ImportsStore } from './imports.store';
import { IMPORT_SOURCES, type ImportSource, SOURCE_NAMES } from './imports.types';

/** A Kobo or KOReader database with years of books can run to a few hundred MB. */
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

interface BookRow {
  id: string;
  title: string;
  author: string;
  isbn13?: string | null;
  isbn10?: string | null;
  rating?: number;
  shelves?: string[];
  source?: string;
  first_read?: string | null;
}

interface ReadRow {
  book_id: string;
  end: string;
  finished: boolean | null;
}

/**
 * Imports from other reading apps, sites and e-readers (Goodreads, StoryGraph, Kobo,
 * Kindle, KOReader), for the admin's Imports section.
 */
@Controller('api/admin/imports')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class ImportsController {
  constructor(
    private readonly store: ImportsStore,
    private readonly library: LibraryService,
    private readonly rebuild: RebuildService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list() {
    const files = await this.store.all();
    return {
      imports: files.map((f) => ({
        source: f.source,
        name: SOURCE_NAMES[f.source],
        file: f.file,
        imported: f.imported,
        books: f.books.length,
        read: f.books.filter((b) => b.shelf === 'read').length,
        rated: f.books.filter((b) => b.rating).length,
        days: f.books.reduce((s, b) => s + (b.daily?.length ?? 0), 0),
        highlights: f.books.reduce((s, b) => s + (b.highlights?.length ?? 0), 0),
      })),
      kindle_titles: (await this.store.titles()).size,
      has_backup: (await this.library.backups()).length > 0,
    };
  }

  /**
   * PUT the file as the body: a Goodreads or StoryGraph export, a Kobo's KoboReader.sqlite,
   * KOReader's statistics.sqlite3, a Kindle's My Clippings.txt, Amazon's Kindle reading
   * sessions, or a list of Kindle titles.
   * What it is comes from its contents.
   */
  @Put()
  @HttpCode(200)
  async upload(@Req() req: Request, @Query('name') name = 'export.csv') {
    const file = basename(String(name)).slice(0, 200);
    const tmp = await mkdtemp(join(tmpdir(), 'import-'));
    const refuse = (error: string) => {
      this.activity.record({
        type: 'import',
        message: `Refused import ${file}`,
        outcome: 'failed',
        trigger: 'admin',
        error,
        details: { file },
      });
      return new BadRequestException({ error });
    };
    try {
      const path = join(tmp, 'upload');
      try {
        await saveRequestBody(req, path, { maxBytes: MAX_UPLOAD_BYTES });
      } catch (e) {
        if (e instanceof RequestBodyError) throw refuse(e.message);
        throw e;
      }
      let found;
      try {
        found = await detectUpload(path, await this.store.titles());
      } catch (e) {
        throw refuse(e instanceof Error ? e.message : String(e));
      }
      if (found.kind === 'titles') {
        if (!found.titles.size) throw refuse('That list has no Kindle titles.');
        await this.store.saveTitles(found.titles);
        const renamed = await this.renameKindleBooks();
        this.activity.record({
          type: 'import',
          message: `Imported ${found.titles.size} Kindle titles from ${file}`,
          trigger: 'admin',
          details: { source: 'kindle_titles', file, titles: found.titles.size, renamed },
        });
        const rebuilding = renamed ? await this.rebuild.rebuildNow() : false;
        return {
          ok: true,
          source: 'kindle_titles',
          titles: found.titles.size,
          renamed,
          rebuilding,
        };
      }
      const { source, books } = found;
      if (!books.length) throw refuse('That file has no books in it.');
      await this.store.save({
        schema_version: 1,
        source,
        file,
        imported: localDateTime(),
        books,
      });
      const rated = books.filter((b) => b.rating).length;
      const days = books.reduce((s, b) => s + (b.daily?.length ?? 0), 0);
      const highlights = books.reduce((s, b) => s + (b.highlights?.length ?? 0), 0);
      this.activity.record({
        type: 'import',
        message:
          `Imported ${SOURCE_NAMES[source]} from ${file}: ${books.length} books` +
          (rated ? `, ${rated} rated` : '') +
          (days ? `, ${days} reading days` : '') +
          (highlights ? `, ${highlights} highlights` : ''),
        trigger: 'admin',
        details: { source, file, books: books.length, rated, days, highlights },
      });
      const rebuilding = await this.rebuild.rebuildNow();
      return { ok: true, source, books: books.length, rated, days, highlights, rebuilding };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  /** Gives Kindle reading-session books named only by ASIN their titles. Returns how many. */
  private async renameKindleBooks(): Promise<number> {
    const kindle = await this.store.get('kindle');
    if (!kindle) return 0;
    const titles = await this.store.titles();
    let renamed = 0;
    for (const b of kindle.books) {
      const t = titles.get(b.id);
      if (t && (b.title !== t.title || b.author !== t.author)) {
        Object.assign(b, { title: t.title, author: t.author });
        renamed++;
      }
    }
    if (renamed) await this.store.save(kindle);
    return renamed;
  }

  @Delete(':source')
  @HttpCode(200)
  async remove(@Param('source') source: string) {
    if (!(IMPORT_SOURCES as readonly string[]).includes(source)) {
      throw new NotFoundException({ error: 'No such import.' });
    }
    const s = source as ImportSource;
    if (!(await this.store.remove(s))) throw new NotFoundException({ error: 'No such import.' });
    this.activity.record({
      type: 'import',
      message: `Removed the ${SOURCE_NAMES[s]} import`,
      trigger: 'admin',
      details: { source: s },
    });
    const rebuilding = await this.rebuild.rebuildNow();
    return { ok: true, rebuilding };
  }

  /** Finished books as a CSV that Goodreads' import reads (books only Goodreads knows are left out). */
  @Get('export/goodreads')
  async export(@Res() res: Response): Promise<void> {
    const load = async <T>(name: string): Promise<T[]> => {
      try {
        return JSON.parse(await readFile(join(this.library.data, name), 'utf8')) as T[];
      } catch {
        return [];
      }
    };
    const books = await load<BookRow>('books.json');
    const reads = await load<ReadRow>('reads.json');
    const finished = new Map<string, string[]>();
    for (const r of reads) {
      if (r.finished === true) finished.set(r.book_id, [...(finished.get(r.book_id) ?? []), r.end]);
    }
    const rows: FinishedBook[] = books
      .filter((b) => b.source !== 'goodreads' && finished.has(b.id))
      .map((b) => ({
        title: b.title,
        author: b.author,
        isbn10: b.isbn10 ?? null,
        isbn13: b.isbn13 ?? null,
        rating: b.rating ?? null,
        shelves: b.shelves ?? [],
        finished: finished.get(b.id)!.sort(),
        first_read: b.first_read ?? null,
      }));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="goodreads_import.csv"');
    res.send(goodreadsCsv(rows));
  }
}
