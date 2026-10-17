import {
  BadRequestException,
  Body,
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
import { AccessSettingsService } from '../access/access-settings.service';
import { AdminOnly } from '../access/admin.guard';
import { readRequestBody, RequestBodyError } from '../common/http/request-body';
import { ActivityLogService } from '../library/activity-log.service';
import { FriendStore, type FriendProfile } from './friend-store.service';
import { FriendsAccessService } from './friends-access.service';
import { toFriendsSettings } from './friends-settings';
import { BundleError, cleanName, parseBundle, SLUG } from './share';
import { ShareService } from './share.service';

/** A share file is a few MB for a big library; this leaves plenty of room. */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

/** What the page needs to know about a friend (and nothing about how we reach them). */
export function publicProfile(p: FriendProfile) {
  return {
    slug: p.slug,
    name: p.name,
    source: p.source,
    updated: p.updated,
    generated: p.generated,
    leaderboards: p.leaderboards,
    privacy: p.privacy,
    parts: p.parts,
    books: p.books,
    clubs: p.clubs ?? 0,
    status: p.status ?? 'ok',
    last_checked: p.last_checked ?? null,
  };
}

/**
 * Friends' data in your dashboard (BOO-30): the index and files the page reads, uploading a
 * friend's share file, and exporting your own.
 */
@Controller()
export class FriendsController {
  constructor(
    private readonly store: FriendStore,
    private readonly share: ShareService,
    private readonly settings: AccessSettingsService,
    private readonly friendsAccess: FriendsAccessService,
    private readonly activity: ActivityLogService,
  ) {}

  /** Your friends, for the page. */
  @Get('data/friends.json')
  async index(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader('Vary', 'Cookie, X-Upload-Token');
    res.setHeader('Cache-Control', 'private, no-cache');
    // to anyone who may not see them: no friends (an empty list rather than a 404, which the
    // page would report as an error)
    if (!(await this.friendsAccess.canSee(req))) {
      if (!(await this.friendsAccess.canRead(req))) throw new NotFoundException();
      res.json({ me: null, friends: [] });
      return;
    }
    const { friends } = await this.settings.load();
    res.json({
      me: { name: friends.share_name || 'You', leaderboards: friends.leaderboards },
      friends: (await this.store.list()).filter((p) => p.books > 0).map(publicProfile),
    });
  }

  @Get('friends/:slug/:name')
  async file(
    @Param('slug') slug: string,
    @Param('name') name: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Vary', 'Cookie, X-Upload-Token');
    if (!SLUG.test(slug) || !(await this.friendsAccess.canSee(req))) throw new NotFoundException();
    const text = await this.store.file(slug, name);
    if (text === null) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-cache');
    res.type('application/json').send(text);
  }

  // ---------- admin ----------

  @Get('api/admin/friends')
  @Header('Cache-Control', 'no-store')
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async list() {
    return {
      friends: (await this.store.list()).map((p) => ({ ...publicProfile(p), url: p.url ?? null })),
      settings: (await this.settings.load()).friends,
    };
  }

  /** Your share name, leaderboard opt-ins, who sees friends here, and follow requests. */
  @Put('api/admin/friends/settings')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async saveSettings(@Body() body: unknown) {
    const current = await this.settings.load();
    const friends = toFriendsSettings({ ...current.friends, ...((body ?? {}) as object) });
    await this.settings.save({ ...current, friends });
    this.activity.record({
      type: 'settings',
      message: 'Changed sharing with friends',
      trigger: 'admin',
      details: { ...friends },
    });
    return { ok: true, settings: friends };
  }

  /** Your data as a share file for a friend to upload into their dashboard. */
  @Get('api/admin/share')
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async exportBundle(@Res() res: Response): Promise<void> {
    const bundle = await this.share.bundle();
    const name = bundle.profile.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() || 'friend';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="reading-${name}.json"`);
    res.json(bundle);
  }

  /**
   * A friend's share file, as the body (application/octet-stream). ?name= names them (default:
   * the name in the file); uploading the same name again replaces their data.
   */
  @Put('api/admin/friends/upload')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async upload(@Req() req: Request, @Query('name') rawName?: string) {
    let body: Buffer;
    try {
      body = await readRequestBody(req, MAX_BUNDLE_BYTES);
    } catch (e) {
      if (e instanceof RequestBodyError) throw new BadRequestException({ error: e.message });
      throw e;
    }
    let bundle;
    try {
      bundle = parseBundle(JSON.parse(body.toString('utf8')));
    } catch (e) {
      const error =
        e instanceof BundleError ? e.message : "That file isn't a share file (it isn't JSON).";
      this.activity.record({
        type: 'friends',
        message: "Refused a friend's share file",
        outcome: 'failed',
        trigger: 'admin',
        error,
      });
      throw new BadRequestException({ error });
    }
    const name = cleanName(rawName, bundle.profile.name);
    const slug = await this.store.freeSlug(name, (p) => p.source === 'upload');
    const profile = await this.store.save(slug, bundle, { source: 'upload', name });
    this.activity.record({
      type: 'friends',
      message: `Added ${name}'s reading (${bundle.books.length} books)`,
      trigger: 'admin',
      details: { friend: slug, books: bundle.books.length, reads: bundle.reads.length },
    });
    return { ok: true, friend: publicProfile(profile) };
  }

  @Delete('api/admin/friends/:slug')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async remove(@Param('slug') slug: string) {
    const p = await this.store.profile(slug);
    if (!p || p.source !== 'upload') throw new NotFoundException({ error: 'No such friend.' });
    await this.store.remove(slug);
    this.activity.record({
      type: 'friends',
      message: `Removed ${p.name}'s reading`,
      trigger: 'admin',
      details: { friend: slug },
    });
    return { ok: true };
  }
}
