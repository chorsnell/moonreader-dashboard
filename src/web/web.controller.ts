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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { AccessSettingsService } from '../access/access-settings.service';
import { ReaderGuard } from '../access/reader.guard';
import { appConfig, type AppConfigType } from '../config/app.config';
import { publicPrefix } from '../common/http/public-prefix';
import { COVER_NAME } from '../covers/cover-store.service';
import { LibraryService } from '../library/library.service';
import { filterDataFile } from '../privacy/privacy';
import { PrivacyService } from '../privacy/privacy.service';
import {
  escapeAttribute,
  GENERIC_DESCRIPTION,
  SITE_NAME,
  shareTags,
  withShareTags,
} from '../share/share-card';
import { ShareService } from '../share/share.service';
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
    private readonly privacy: PrivacyService,
    private readonly share: ShareService,
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
    const prefix = publicPrefix(headers, this.config.basePath);
    const base = escapeAttribute(`${prefix}/`);
    const tagged = withShareTags(page, await this.shareTags(headers, prefix));
    return tagged.replace('<head>', `<head>\n<base href="${base}">`);
  }

  /**
   * Link preview tags. Only a public dashboard says anything about the reading (as the
   * public sees it): one behind a password gets its name alone, as anyone without it would.
   */
  private async shareTags(headers: IncomingHttpHeaders, prefix: string): Promise<string> {
    const origin = this.config.publicUrl || requestOrigin(headers, prefix);
    const url = origin ? `${origin}/` : null;
    const generic = { title: SITE_NAME, description: GENERIC_DESCRIPTION, url, image: null };
    try {
      if ((await this.settings.load()).access !== 'public' || !(await this.library.hasData())) {
        return shareTags(generic);
      }
      const [card, image] = await Promise.all([this.share.card(), this.share.collage()]);
      const path = image ? `share.jpg?v=${image.version}` : null;
      return shareTags({
        title: card.title,
        description: card.description,
        url,
        image: path && (url ? `${url}${path}` : path),
      });
    } catch {
      return shareTags(generic); // the page matters more than its preview
    }
  }

  /** The link preview picture, a collage of recent covers: for a public dashboard only. */
  @Get('share.jpg')
  async shareImage(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if ((await this.settings.load()).access !== 'public') throw new NotFoundException();
    const image = await this.share.collage();
    if (!image) throw new NotFoundException();
    const etag = `"${image.version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }
    res.type('image/jpeg').send(image.jpeg);
  }

  /** The admin gets the files as written; everyone else a copy filtered by their policy. */
  @Get('data/:name')
  @UseGuards(ReaderGuard)
  async data(
    @Param('name') name: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!DATA_FILE.test(name)) throw new NotFoundException();
    res.setHeader('Vary', 'Cookie, X-Upload-Token');
    const viewer = await this.privacy.viewer(req);
    const ctx = await this.privacy.context(viewer);
    const path = join(this.library.data, name);
    if (!ctx) return sendFile(res, path, 'no-cache');
    let data: unknown;
    try {
      data = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new NotFoundException();
    }
    const filtered = filterDataFile(name, data, ctx);
    if (filtered === null) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(filtered);
  }

  /** Cached for good (the URL changes with the file); privately when the dashboard is. */
  @Get('covers/:name')
  @UseGuards(ReaderGuard)
  async cover(
    @Param('name') name: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const m = COVER_NAME.exec(name);
    if (!m) throw new NotFoundException();
    const ctx = await this.privacy.context(await this.privacy.viewer(req));
    if (ctx?.private.has(m[1])) throw new NotFoundException(); // a private book's cover
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

const HOST = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/;

/**
 * The dashboard's address from the request: the host the reverse proxy forwarded (or the
 * Host header) and X-Forwarded-Proto, or null when the host doesn't look like one. Link
 * previews need an absolute address; PUBLIC_URL sets it outright.
 */
export function requestOrigin(headers: IncomingHttpHeaders, prefix: string): string | null {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).split(',')[0].trim();
  const host = first(headers['x-forwarded-host']) || first(headers.host);
  if (!HOST.test(host)) return null;
  const proto = first(headers['x-forwarded-proto']).toLowerCase() === 'https' ? 'https' : 'http';
  return `${proto}://${host}${prefix}`;
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
