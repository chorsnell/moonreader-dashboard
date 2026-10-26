import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  HttpCode,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminOnly } from '../access/admin.guard';
import { publicPrefix } from '../common/http/public-prefix';
import { RequestBodyError, saveRequestBody } from '../common/http/request-body';
import { appConfig, type AppConfigType } from '../config/app.config';
import { zip } from '../highlights/export';
import { requestOrigin } from '../web/web.controller';
import { KoreaderSyncError, KoreaderSyncService } from './koreader-sync.service';

/** A statistics database with years of reading runs to tens of MB. */
const MAX_STATS_BYTES = 500 * 1024 * 1024;
/** Sidecar data for a few hundred books, highlights included. */
const MAX_JSON_BYTES = 20 * 1024 * 1024;
/** The plugin's folder, shipped in the image next to web/ (see the Dockerfile). */
export const PLUGIN_DIR = join(process.cwd(), 'koreader', 'readingdashboard.koplugin');

/** A Lua string literal for any text. */
const luaString = (s: string) =>
  `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;

/**
 * The KOReader plugin's API (koreader/API.md). Admin only: the plugin sends UPLOAD_TOKEN as
 * X-Upload-Token. Bodies are read here, after the guard, rather than by the app-wide JSON
 * parser (4 kB), so a stranger can't make the server parse a large body.
 */
@Controller('api/koreader')
@AdminOnly({ denied: 'Only the admin can do this.', off: 'Set UPLOAD_TOKEN to sync KOReader.' })
export class KoreaderSyncController {
  constructor(
    private readonly sync: KoreaderSyncService,
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
  ) {}

  /**
   * The plugin as a zip to unpack into koreader/plugins/, with this dashboard's address filled
   * in (defaults.lua), and the admin password too with ?token=1, so nothing has to be typed
   * on an e-reader's keyboard.
   */
  @Get('plugin.zip')
  async plugin(@Req() req: Request, @Res() res: Response, @Query('token') token?: string) {
    let names: string[];
    try {
      names = (await readdir(PLUGIN_DIR, { recursive: true, withFileTypes: true }))
        .filter((e) => e.isFile() && !e.name.startsWith('.') && e.name !== 'defaults.lua')
        .map((e) => join(e.parentPath, e.name));
    } catch {
      throw new NotFoundException({ error: 'The KOReader plugin is not part of this build.' });
    }
    const files: { name: string; data: Buffer | string }[] = await Promise.all(
      names.sort().map(async (path) => ({
        name: `readingdashboard.koplugin/${relative(PLUGIN_DIR, path).split(sep).join('/')}`,
        data: await readFile(path),
      })),
    );
    const prefix = publicPrefix(req.headers, this.config.basePath);
    const url = this.config.publicUrl || requestOrigin(req.headers, prefix) || '';
    const fields = [`url = ${luaString(url)}`];
    if (token === '1' && this.config.uploadToken) {
      fields.push(`token = ${luaString(this.config.uploadToken)}`);
    }
    files.push({
      name: 'readingdashboard.koplugin/defaults.lua',
      data: `-- Filled in by the dashboard when this copy was downloaded.\nreturn { ${fields.join(', ')} }\n`,
    });
    res
      .status(200)
      .set({
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="readingdashboard.koplugin.zip"',
        'Cache-Control': 'no-store',
      })
      .send(zip(files));
  }

  @Put('stats')
  @HttpCode(200)
  async stats(@Req() req: Request, @Query('device') device?: string) {
    return this.withBody(req, MAX_STATS_BYTES, async (path) => {
      const counts = await this.sync.saveStats(path, 'plugin', {
        device: typeof device === 'string' && device ? device.slice(0, 160) : null,
      });
      return { ok: true, books: counts.books, days: counts.days };
    });
  }

  @Post('books')
  @HttpCode(200)
  async books(@Req() req: Request) {
    this.requireJson(req);
    return this.withBody(req, MAX_JSON_BYTES, async (path) => {
      const kept = await this.sync.saveBooks(await this.json(path));
      return { ok: true, books: kept };
    });
  }

  @Post('match')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async match(@Req() req: Request) {
    this.requireJson(req);
    return this.withBody(req, MAX_JSON_BYTES, async (path) =>
      this.sync.match(await this.json(path)),
    );
  }

  /**
   * POST bodies must say they're JSON: another site can't send that without a CORS preflight,
   * so a signed-in admin's cookie can't be used to post here from elsewhere.
   */
  private requireJson(req: Request): void {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
      req.resume();
      throw new BadRequestException({ error: 'Send the body as application/json.' });
    }
  }

  private async json(path: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new BadRequestException({ error: 'The body is not valid JSON.' });
    }
  }

  /** Saves the body to a temporary file, runs `work` on it, and turns errors into 400s. */
  private async withBody<T>(
    req: Request,
    maxBytes: number,
    work: (path: string) => Promise<T>,
  ): Promise<T> {
    const tmp = await mkdtemp(join(tmpdir(), 'koreader-'));
    try {
      const path = join(tmp, 'body');
      try {
        await saveRequestBody(req, path, { maxBytes });
      } catch (e) {
        if (e instanceof RequestBodyError) throw new BadRequestException({ error: e.message });
        throw e;
      }
      try {
        return await work(path);
      } catch (e) {
        if (e instanceof KoreaderSyncError) throw new BadRequestException({ error: e.message });
        throw e;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}
