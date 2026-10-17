import { readFile, stat } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { AccessSettingsService } from '../access/access-settings.service';
import { ReaderGuard } from '../access/reader.guard';
import { appConfig, type AppConfigType } from '../config/app.config';
import { publicPrefix } from '../common/http/public-prefix';
import { COVER_NAME } from '../covers/cover-store.service';
import { LibraryService } from '../library/library.service';
import { WEB_DIR } from '../paths';
import { withFeatures } from './features';

const DATA_FILE = /^[a-z_]+\.json$/;

/**
 * The dashboard page, its scripts, the data it reads and the book covers. Only these are
 * served: nothing else in the library (catalogue.json, backups, the log) is reachable.
 *
 * Its catch-all route must be registered last, so WebModule is imported last in AppModule.
 */
@Controller()
export class WebController {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly settings: AccessSettingsService,
  ) {}

  /**
   * Every URL in the page is relative; a <base> tag makes them resolve under the public
   * prefix, whatever the proxy did with the trailing slash.
   */
  @Get(['', 'index.html'])
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  async index(@Headers() headers: IncomingHttpHeaders): Promise<string> {
    const page = await withFeatures(await readFile(join(WEB_DIR, 'index.html'), 'utf8'), WEB_DIR);
    const base = escapeAttribute(`${publicPrefix(headers, this.config.basePath)}/`);
    return page.replace('<head>', `<head>\n<base href="${base}">`);
  }

  @Get('data/:name')
  @UseGuards(ReaderGuard)
  data(@Param('name') name: string, @Res() res: Response): Promise<void> {
    if (!DATA_FILE.test(name)) throw new NotFoundException();
    return sendFile(res, join(this.library.data, name), 'no-cache');
  }

  /** Cached for good (the URL changes with the file); privately when the dashboard is. */
  @Get('covers/:name')
  @UseGuards(ReaderGuard)
  async cover(@Param('name') name: string, @Res() res: Response): Promise<void> {
    if (!COVER_NAME.test(name)) throw new NotFoundException();
    const scope = (await this.settings.load()).access === 'public' ? 'public' : 'private';
    return sendFile(res, join(this.library.covers, name), `${scope}, max-age=31536000, immutable`);
  }

  @Get('*path')
  asset(@Param('path') path: string[], @Res() res: Response): Promise<void> {
    const full = normalize(join(WEB_DIR, ...path));
    if (!full.startsWith(WEB_DIR + sep)) throw new NotFoundException();
    return sendFile(res, full, 'public, max-age=300');
  }
}

function escapeAttribute(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Sends a file that exists, or a 404 (never a directory listing or a path outside its folder). */
async function sendFile(res: Response, full: string, cacheControl: string): Promise<void> {
  const st = await stat(full).catch(() => null);
  if (!st?.isFile()) throw new NotFoundException();
  res.setHeader('Cache-Control', cacheControl);
  await new Promise<void>((resolve, reject) =>
    res.sendFile(full, { cacheControl: false, dotfiles: 'allow' }, (err) =>
      err && !res.headersSent ? reject(new NotFoundException()) : resolve(),
    ),
  );
}
