import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
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
import { localDateTime } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { RebuildService } from '../rebuild/rebuild.service';
import { type FinishedBook, goodreadsCsv, parseReadingExport } from './goodreads';
import { ImportsStore } from './imports.store';
import { IMPORT_SOURCES, type ImportSource } from './imports.types';

/** A Goodreads export of a few thousand books is a megabyte or two. */
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

const NAMES: Record<ImportSource, string> = { goodreads: 'Goodreads', storygraph: 'StoryGraph' };

async function readText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_EXPORT_BYTES) {
      throw new BadRequestException({ error: 'That file is too large (20 MB at most).' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

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

/** Imports from other reading apps and sites (Goodreads, StoryGraph), for the admin's Imports section. */
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
        name: NAMES[f.source],
        file: f.file,
        imported: f.imported,
        books: f.books.length,
        read: f.books.filter((b) => b.shelf === 'read').length,
        rated: f.books.filter((b) => b.rating).length,
      })),
      has_backup: (await this.library.backups()).length > 0,
    };
  }

  /** PUT the export file as the body: a Goodreads library export or a StoryGraph export. */
  @Put()
  @HttpCode(200)
  async upload(@Req() req: Request, @Query('name') name = 'export.csv') {
    const file = basename(String(name)).slice(0, 200);
    const text = await readText(req);
    let parsed;
    try {
      parsed = parseReadingExport(text);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.activity.record({
        type: 'import',
        message: `Refused import ${file}`,
        outcome: 'failed',
        trigger: 'admin',
        error,
        details: { file },
      });
      throw new BadRequestException({ error });
    }
    if (!parsed.books.length) throw new BadRequestException({ error: 'That export has no books.' });
    await this.store.save({
      schema_version: 1,
      source: parsed.source,
      file,
      imported: localDateTime(),
      books: parsed.books,
    });
    const rated = parsed.books.filter((b) => b.rating).length;
    this.activity.record({
      type: 'import',
      message: `Imported ${NAMES[parsed.source]} export ${file}: ${parsed.books.length} books, ${rated} rated`,
      trigger: 'admin',
      details: { source: parsed.source, file, books: parsed.books.length, rated },
    });
    const rebuilding = await this.rebuild.rebuildNow();
    return { ok: true, source: parsed.source, books: parsed.books.length, rated, rebuilding };
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
      message: `Removed the ${NAMES[s]} import`,
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
