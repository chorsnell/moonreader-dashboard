import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { publicPrefix } from '../common/http/public-prefix';
import { appConfig, type AppConfigType } from '../config/app.config';
import { CoverStore } from '../covers/cover-store.service';
import { requestOrigin } from '../web/web.controller';
import { deviceTokenOf, OutboundService, type OutboundViewer } from './outbound.service';
import { einkCover, einkPicture, einkStats, EINK_HEIGHT, EINK_WIDTH } from './eink';
import type { NowSummary } from './now';

/**
 * The e-ink view (BOO-73): /eink.png (800 x 480, one bit), /eink/cover.png (the current
 * cover, dithered) and /api/trmnl (JSON for a TRMNL private plugin's polling). Who may ask
 * is as for /api/now: the device token, or the dashboard's usual rules.
 */
@Controller()
export class EinkController {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly outbound: OutboundService,
    private readonly covers: CoverStore,
  ) {}

  private async who(req: Request): Promise<OutboundViewer> {
    const who = await this.outbound.viewerFor(req);
    if (!who) throw new UnauthorizedException({ error: 'Sign in, or use the device token.' });
    return who;
  }

  private async coverOf(now: NowSummary): Promise<Buffer | null> {
    const book = (now.reading ?? []).find((b) => b.cover);
    if (!book) return null;
    const file = (await this.covers.existing()).get(book.id);
    return file ? readFile(join(this.covers.dir, file)).catch(() => null) : null;
  }

  @Get('eink.png')
  async picture(@Req() req: Request, @Res() res: Response): Promise<void> {
    const now = await this.outbound.now(await this.who(req));
    sendPng(req, res, einkPicture(now, await this.coverOf(now)).png());
  }

  @Get('eink/cover.png')
  async cover(@Req() req: Request, @Res() res: Response): Promise<void> {
    const now = await this.outbound.now(await this.who(req));
    const data = await this.coverOf(now);
    const bm = data ? einkCover(data) : null;
    if (!bm) throw new NotFoundException();
    sendPng(req, res, bm.png());
  }

  /**
   * For a TRMNL private plugin set to "Polling": TRMNL's server fetches this on the
   * plugin's schedule and hands the fields to the plugin's Liquid markup.
   */
  @Get('api/trmnl')
  @Header('Cache-Control', 'private, no-store')
  async trmnl(@Req() req: Request) {
    const now = await this.outbound.now(await this.who(req));
    const book = now.reading?.[0] ?? null;
    const origin =
      this.config.publicUrl ||
      requestOrigin(req.headers, publicPrefix(req.headers, this.config.basePath)) ||
      '';
    const token = deviceTokenOf(req);
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    const version = createHash('sha256')
      .update(JSON.stringify(now))
      .digest('base64url')
      .slice(0, 10);
    const sep = q ? '&' : '?';
    return {
      today: now.today,
      title: book?.title ?? null,
      author: book?.author ?? null,
      progress: book?.progress === null || !book ? null : Math.round(book.progress),
      // the version makes TRMNL fetch the image again when it changes
      cover_url: book?.cover && origin ? `${origin}/eink/cover.png${q}${sep}v=${version}` : null,
      image_url: origin ? `${origin}/eink.png${q}${sep}v=${version}` : null,
      reading_shared: now.reading !== null,
      stats: einkStats(now),
      streak: now.streak?.current ?? null,
      streak_at_risk: now.streak?.at_risk ?? null,
      week_minutes: now.week_minutes,
      today_minutes: now.today_minutes,
      year: now.year,
      quote: now.quote?.text ?? null,
      quote_source: now.quote
        ? `${now.quote.title}${now.quote.author ? `, ${now.quote.author}` : ''}`
        : null,
      width: EINK_WIDTH,
      height: EINK_HEIGHT,
    };
  }
}

function sendPng(req: Request, res: Response, png: Buffer): void {
  const etag = `"${createHash('sha256').update(png).digest('base64url').slice(0, 22)}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie, Authorization, X-Device-Token, X-Upload-Token');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type('image/png').send(png);
}
