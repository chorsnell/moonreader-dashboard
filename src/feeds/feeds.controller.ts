import { stat } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminOnly } from '../access/admin.guard';
import { AccessSettingsService } from '../access/access-settings.service';
import { publicPrefix } from '../common/http/public-prefix';
import { appConfig, type AppConfigType } from '../config/app.config';
import { COVER_NAME } from '../covers/cover-store.service';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { SITE_NAME } from '../share/share-card';
import { requestOrigin } from '../web/web.controller';
import {
  FEED_EXT,
  FeedError,
  feedPath,
  publicFeed,
  toFeedInput,
  type Feed,
  type FeedContext,
} from './feeds';
import { FeedsService } from './feeds.service';

const FEED_FILE = /^([A-Za-z0-9_-]{20,100})\.(atom|ics)$/;

/**
 * Atom and iCal feeds at secret URLs (BOO-74). Anyone with a feed's URL gets it, whether or
 * not the dashboard needs a password, so it's built only from what the feed's audience may
 * see. The admin makes, rotates and revokes them.
 */
@Controller()
export class FeedsController {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly feeds: FeedsService,
    private readonly library: LibraryService,
    private readonly settings: AccessSettingsService,
    private readonly activity: ActivityLogService,
  ) {}

  // ---------- the admin ----------

  @Get('api/admin/feeds')
  @Header('Cache-Control', 'no-store')
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async list() {
    return { feeds: (await this.feeds.list()).map(publicFeed) };
  }

  /** {kind, audience, name}: a new feed. Its URL is in the answer, and only there. */
  @Post('api/admin/feeds')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async create(@Body() body: unknown, @Headers() headers: IncomingHttpHeaders) {
    let made;
    try {
      made = await this.feeds.create(toFeedInput(body));
    } catch (e) {
      if (e instanceof FeedError) throw new BadRequestException({ error: e.message });
      throw e;
    }
    this.activity.record({
      type: 'settings',
      message: `Made a feed: ${made.feed.name} (${made.feed.kind}, for ${made.feed.audience})`,
      trigger: 'admin',
      details: { feed: made.feed.id },
    });
    return { ok: true, feed: publicFeed(made.feed), url: this.url(headers, made.feed, made.token) };
  }

  /** A new secret URL; the old one stops working. */
  @Post('api/admin/feeds/:id/rotate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async rotate(@Param('id') id: string, @Headers() headers: IncomingHttpHeaders) {
    const made = await this.feeds.rotate(id);
    if (!made) throw new NotFoundException({ error: 'No such feed.' });
    this.activity.record({
      type: 'settings',
      message: `Gave the feed ${made.feed.name} a new address`,
      trigger: 'admin',
      details: { feed: id },
    });
    return { ok: true, feed: publicFeed(made.feed), url: this.url(headers, made.feed, made.token) };
  }

  @Delete('api/admin/feeds/:id')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async revoke(@Param('id') id: string) {
    if (!(await this.feeds.revoke(id))) throw new NotFoundException({ error: 'No such feed.' });
    this.activity.record({
      type: 'settings',
      message: 'Revoked a feed',
      trigger: 'admin',
      details: { feed: id },
    });
    return { ok: true };
  }

  // ---------- the feeds ----------

  @Get('feeds/:file')
  async feed(
    @Param('file') file: string,
    @Headers() headers: IncomingHttpHeaders,
    @Res() res: Response,
  ): Promise<void> {
    const m = FEED_FILE.exec(file);
    const feed = m ? await this.feeds.byToken(m[1]) : null;
    if (!m || !feed || FEED_EXT[feed.kind] !== m[2]) return this.missing();
    const ctx = await this.context(headers, feed, m[1]);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (feed.kind === 'atom') {
      res.type('application/atom+xml; charset=utf-8').send(await this.feeds.atom(feed, ctx));
    } else {
      res.setHeader('Content-Disposition', 'inline; filename="reading.ics"');
      res.type('text/calendar; charset=utf-8').send(await this.feeds.ical(feed, ctx));
    }
  }

  /** A cover for the Atom feed, through its secret, so it shows on a password-protected dashboard too. */
  @Get('feeds/:token/covers/:name')
  async cover(
    @Param('token') token: string,
    @Param('name') name: string,
    @Res() res: Response,
  ): Promise<void> {
    const feed = await this.feeds.byToken(token);
    const m = COVER_NAME.exec(name);
    if (!feed || feed.kind !== 'atom' || !m) return this.missing();
    if (!(await this.feeds.coverAllowed(feed.audience, m[1]))) throw new NotFoundException();
    const full = join(this.library.covers, name);
    if (!(await stat(full).catch(() => null))?.isFile()) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Robots-Tag', 'noindex');
    await new Promise<void>((resolve, reject) =>
      res.sendFile(full, { cacheControl: false }, (err) =>
        err && !res.headersSent ? reject(new NotFoundException()) : resolve(),
      ),
    );
  }

  /** A wrong secret: slowly, and the same as no feed at all. */
  private async missing(): Promise<never> {
    await sleep(200);
    throw new NotFoundException();
  }

  private origin(headers: IncomingHttpHeaders): string {
    const prefix = publicPrefix(headers, this.config.basePath);
    return this.config.publicUrl || requestOrigin(headers, prefix) || prefix;
  }

  private url(headers: IncomingHttpHeaders, feed: Feed, token: string): string {
    return `${this.origin(headers)}/${feedPath(feed.kind, token)}`;
  }

  private async context(
    headers: IncomingHttpHeaders,
    feed: Feed,
    token: string,
  ): Promise<FeedContext> {
    const home = `${this.origin(headers)}/`;
    const { friends } = await this.settings.load();
    const who = friends.share_name ? `${friends.share_name}'s reading` : SITE_NAME;
    return {
      self: `${home}${feedPath(feed.kind, token)}`,
      home,
      cover: (path) => `${home}feeds/${token}/${path}`,
      title: feed.kind === 'atom' ? `${who}: finished books` : `${who}: reading calendar`,
    };
  }
}
