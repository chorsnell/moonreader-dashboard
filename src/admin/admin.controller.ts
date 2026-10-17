import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { basename, join } from 'node:path';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly } from '../access/admin.guard';
import { appConfig, type AppConfigType } from '../config/app.config';
import { findFiles } from '../common/files';
import { logTimestamp } from '../common/time';
import { CoverLookupService } from '../covers/cover-lookup.service';
import { CoverStore } from '../covers/cover-store.service';
import { imageExt } from '../covers/png';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { StatusService } from '../library/status.service';
import { RebuildService } from '../rebuild/rebuild.service';
import { CatalogueService, toCatalogueChange } from './catalogue.service';

const MAX_COVER_BYTES = 5 * 1024 * 1024;
const BOOK_ID = /^[a-z0-9-]+$/;

interface BookRow {
  id: string;
  title: string;
  author?: string | null;
}

/** A backup the library keeps, for the admin's Data section. */
interface KeptBackup {
  name: string;
  folder: 'inbox' | 'dav';
  size: number;
  modified: string;
  failed: boolean;
}

async function readSmallBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > max)
      throw new BadRequestException({ error: 'That image is too large (5 MB at most).' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The admin page's endpoints: the data, the catalogue and the covers. Admin only. */
@Controller('api/admin')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class AdminController {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly status: StatusService,
    private readonly rebuild: RebuildService,
    private readonly catalogue: CatalogueService,
    private readonly store: CoverStore,
    private readonly lookup: CoverLookupService,
    private readonly activity: ActivityLogService,
  ) {}

  /** The current data and the backups kept, for the Data section. */
  @Get('status')
  @Header('Cache-Control', 'no-store')
  async info() {
    const files: { path: string; folder: 'inbox' | 'dav' }[] = [
      ...(await findFiles(this.library.inbox, '.mrpro')).map((path) => ({
        path,
        folder: 'inbox' as const,
      })),
      ...(await findFiles(this.library.inbox, '.mrpro.failed')).map((path) => ({
        path,
        folder: 'inbox' as const,
      })),
      ...(await findFiles(this.library.dav, '.mrpro')).map((path) => ({
        path,
        folder: 'dav' as const,
      })),
    ];
    const backups: KeptBackup[] = [];
    for (const { path, folder } of files) {
      const st = await stat(path).catch(() => null);
      if (!st || basename(path).startsWith('.')) continue;
      backups.push({
        name: this.library.relative(path),
        folder,
        size: st.size,
        modified: logTimestamp(st.mtime),
        failed: path.endsWith('.failed'),
      });
    }
    backups.sort((a, b) => (a.modified < b.modified ? 1 : -1));
    return {
      ...this.status.snapshot(),
      building: this.status.snapshot().building || this.rebuild.busy,
      meta: await this.library.meta(),
      keep_backups: this.config.keepBackups,
      backups,
      cover_lookup: this.config.coverLookup,
    };
  }

  /** Rebuilds from the newest backup now, even if nothing changed. */
  @Post('rebuild')
  @HttpCode(202)
  async rebuildNow() {
    if (!(await this.rebuild.rebuildNow())) {
      throw new ConflictException({ error: 'There is no backup to build from yet.' });
    }
    this.activity.log('Rebuild asked for from the admin page');
    return { ok: true };
  }

  @Get('catalogue')
  @Header('Cache-Control', 'no-store')
  async books() {
    return { books: await this.catalogue.books() };
  }

  /** Sets the title, author, series and genre of a book's files, then rebuilds. */
  @Put('catalogue')
  @HttpCode(200)
  async saveBook(@Body() body: unknown) {
    await this.catalogue.save(toCatalogueChange(body));
    return { ok: true };
  }

  /** Books with no cover, and when a lookup last found nothing for each. */
  @Get('covers')
  @Header('Cache-Control', 'no-store')
  async missingCovers() {
    let books: BookRow[] = [];
    try {
      books = JSON.parse(
        await readFile(join(this.library.data, 'books.json'), 'utf8'),
      ) as BookRow[];
    } catch {
      // no data yet
    }
    const have = await this.store.existing();
    const misses = await this.store.readMisses();
    return {
      lookup: this.config.coverLookup,
      running: this.lookup.busy,
      total: books.length,
      with_cover: books.filter((b) => have.has(b.id)).length,
      missing: books
        .filter((b) => !have.has(b.id))
        .map((b) => ({
          id: b.id,
          title: b.title,
          author: b.author ?? '',
          missed: misses[b.id] ?? null,
        })),
    };
  }

  /** Forgets earlier misses (all, or the books given) and looks the covers up again. */
  @Post('covers/lookup')
  @HttpCode(202)
  async lookUpAgain(@Body() body: unknown) {
    if (!this.config.coverLookup) {
      throw new ConflictException({
        error: 'Cover lookup is turned off on this server (COVER_LOOKUP).',
      });
    }
    const raw = (body ?? {}) as { ids?: unknown };
    const ids = Array.isArray(raw.ids) ? raw.ids.map(String) : null;
    const misses = await this.store.readMisses();
    for (const id of ids ?? Object.keys(misses)) delete misses[id];
    await this.store.writeMisses(misses);
    this.activity.log(
      `Cover lookup asked for from the admin page${ids ? ` (${ids.length} book(s))` : ''}`,
    );
    this.lookup.start();
    return { ok: true };
  }

  /** The admin's own cover for a book: PUT the JPEG or PNG as the body. */
  @Put('covers/:id')
  @HttpCode(200)
  async setCover(@Param('id') id: string, @Req() req: Request) {
    if (!BOOK_ID.test(id)) throw new BadRequestException({ error: 'No such book.' });
    const image = await readSmallBody(req, MAX_COVER_BYTES);
    if (!imageExt(image)) throw new BadRequestException({ error: 'Choose a JPEG or PNG image.' });
    if (!(await this.store.replace(id, image))) {
      throw new BadRequestException({ error: "That image couldn't be saved." });
    }
    this.activity.log(`Cover for ${id} set from the admin page`);
    return { ok: true };
  }
}
