import { setTimeout as sleep } from 'node:timers/promises';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessSettingsService } from '../access/access-settings.service';
import { AdminOnly } from '../access/admin.guard';
import { UploadTokenService } from '../access/upload-token.service';
import { appConfig, type AppConfigType } from '../config/app.config';
import { publicPrefix } from '../common/http/public-prefix';
import { localDateTime } from '../common/time';
import { FriendStore } from '../friends/friend-store.service';
import { cleanName } from '../friends/share';
import { ShareService } from '../friends/share.service';
import { ActivityLogService } from '../library/activity-log.service';
import {
  hashSecret,
  matchesHash,
  MAX_PENDING,
  newId,
  newSecret,
  normaliseUrl,
  publicFollower,
  scopeParts,
  toScope,
  type Follower,
} from './federation';
import { FederationStore } from './federation.store';
import { FederationService, FollowError } from './federation.service';

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function bearer(req: Request): string {
  const auth = req.headers.authorization ?? '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

/**
 * Federation (BOO-59). The public calls other installations make (asking to follow,
 * collecting the token, pulling the share) and the admin's: approving followers and
 * following friends. The protocol is in docs/friends.md.
 */
@Controller()
export class FederationController {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly store: FederationStore,
    private readonly federation: FederationService,
    private readonly share: ShareService,
    private readonly friends: FriendStore,
    private readonly settings: AccessSettingsService,
    private readonly tokens: UploadTokenService,
    private readonly activity: ActivityLogService,
  ) {}

  // ---------- what other installations call ----------

  /** {name, url, claim}: another installation asks to follow this one. */
  @Post('api/federation/follow')
  @HttpCode(202)
  async requestFollow(@Body() body: unknown) {
    if (!this.tokens.enabled) {
      throw new NotFoundException({ error: "This dashboard doesn't take follow requests." });
    }
    if (!(await this.settings.load()).friends.accept_follows) {
      throw new ForbiddenException({ error: "This dashboard isn't taking follow requests." });
    }
    const o = asObject(body);
    const url = normaliseUrl(o.url);
    const claim = typeof o.claim === 'string' ? o.claim : '';
    if (!url || claim.length < 20 || claim.length > 200) {
      throw new BadRequestException({ error: 'A follow request needs a url and a claim.' });
    }
    const name = cleanName(o.name, new URL(url).host);
    const id = await this.store.update((f) => {
      const pending = f.followers.filter((x) => x.status === 'pending');
      const again = pending.find((x) => x.url === url);
      if (again) {
        Object.assign(again, { name, claim_hash: hashSecret(claim), requested: localDateTime() });
        return again.id;
      }
      if (pending.length >= MAX_PENDING) return null;
      const follower: Follower = {
        id: newId(),
        name,
        url,
        status: 'pending',
        requested: localDateTime(),
        decided: null,
        claim_hash: hashSecret(claim),
        token_hash: null,
        pickup: null,
        scope: 'everything',
        views: [],
        hidden_books: [],
        last_pull: null,
      };
      f.followers.push(follower);
      return follower.id;
    });
    if (!id) {
      throw new HttpException({ error: 'Too many follow requests are waiting. Try later.' }, 429);
    }
    this.activity.record({
      type: 'friends',
      message: `${name} (${url}) asked to follow you`,
      trigger: 'federation',
      details: { url },
    });
    return { id, status: 'pending' };
  }

  /** {claim}: where a follow request stands; the token, once, after approval. */
  @Post('api/federation/follow/:id/status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async followStatus(@Param('id') id: string, @Body() body: unknown) {
    const claim = String(asObject(body).claim ?? '');
    const { friends } = await this.settings.load();
    const out = await this.store.update((f) => {
      const x = f.followers.find((y) => y.id === id);
      if (!x || !matchesHash(claim, x.claim_hash)) return null;
      const token = x.status === 'approved' ? x.pickup : null;
      if (token) x.pickup = null;
      return { status: x.status, ...(token ? { token } : {}) };
    });
    if (!out) {
      await sleep(200); // a wrong claim gets nothing, slowly
      throw new NotFoundException({ error: 'No such follow request.' });
    }
    return { ...out, name: friends.share_name || null };
  }

  /** The share bundle, for an approved follower's token. */
  @Get('api/federation/share')
  @Header('Cache-Control', 'no-store')
  async pullShare(@Req() req: Request) {
    const token = bearer(req);
    const f = (await this.store.read()).followers.find(
      (x) => x.status === 'approved' && matchesHash(token, x.token_hash),
    );
    if (!f) {
      await sleep(200);
      throw new UnauthorizedException({ error: 'Not shared with you (any more).' });
    }
    await this.store.update((file) => {
      const x = file.followers.find((y) => y.id === f.id);
      if (x) x.last_pull = localDateTime();
    });
    const { parts, leaderboards } = scopeParts(f);
    return this.share.bundle({ parts, leaderboards, hiddenBooks: f.hidden_books });
  }

  // ---------- the admin: followers ----------

  @Get('api/admin/federation')
  @Header('Cache-Control', 'no-store')
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async overview() {
    const file = await this.store.read();
    const following = [];
    for (const f of file.following) {
      const p = await this.friends.profile(f.slug);
      following.push({
        slug: f.slug,
        url: f.url,
        name: p?.name ?? f.name,
        status: f.status === 'approved' && p?.status === 'offline' ? 'offline' : f.status,
        added: f.added,
        updated: p?.updated ?? null,
        last_checked: p?.last_checked ?? null,
        last_error: p?.last_error ?? null,
        books: p?.books ?? 0,
      });
    }
    return {
      followers: file.followers.map(publicFollower),
      following,
      accept_follows: (await this.settings.load()).friends.accept_follows,
      refresh_minutes: this.config.federationRefreshMinutes,
    };
  }

  /** {scope, views, hidden_books}: approves a follow request and issues its token. */
  @Post('api/admin/federation/followers/:id/approve')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async approve(@Param('id') id: string, @Body() body: unknown) {
    const scope = toScope(body);
    const f = await this.store.update((file) => {
      const x = file.followers.find((y) => y.id === id);
      if (!x || x.status !== 'pending') return null;
      const token = newSecret();
      Object.assign(x, scope, {
        status: 'approved',
        decided: localDateTime(),
        token_hash: hashSecret(token),
        pickup: token,
      });
      return { ...x };
    });
    if (!f) throw new NotFoundException({ error: 'No such follow request waiting.' });
    this.activity.record({
      type: 'friends',
      message: `Approved ${f.name} (${f.url}) to follow you: ${f.scope}`,
      trigger: 'admin',
      details: { url: f.url, scope: f.scope, views: f.views, hidden_books: f.hidden_books.length },
    });
    return { ok: true, follower: publicFollower(f) };
  }

  /** Changes what an approved follower gets; it applies from their next pull. */
  @Put('api/admin/federation/followers/:id')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async changeScope(@Param('id') id: string, @Body() body: unknown) {
    const scope = toScope(body);
    const f = await this.store.update((file) => {
      const x = file.followers.find((y) => y.id === id);
      if (!x || (x.status !== 'approved' && x.status !== 'pending')) return null;
      Object.assign(x, scope);
      return { ...x };
    });
    if (!f) throw new NotFoundException({ error: 'No such follower.' });
    this.activity.record({
      type: 'friends',
      message: `Changed what ${f.name} (${f.url}) gets: ${f.scope}`,
      trigger: 'admin',
      details: { url: f.url, scope: f.scope, views: f.views, hidden_books: f.hidden_books.length },
    });
    return { ok: true, follower: publicFollower(f) };
  }

  /** Stops sharing with a follower at once: their token stops working. */
  @Post('api/admin/federation/followers/:id/revoke')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  revoke(@Param('id') id: string) {
    return this.decide(id, 'revoked', ['approved'], 'Stopped sharing with');
  }

  @Post('api/admin/federation/followers/:id/reject')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  reject(@Param('id') id: string) {
    return this.decide(id, 'rejected', ['pending'], 'Turned down');
  }

  /** Forgets a follower altogether (after rejecting or revoking, say). */
  @Delete('api/admin/federation/followers/:id')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async forget(@Param('id') id: string) {
    const gone = await this.store.update((file) => {
      const before = file.followers.length;
      file.followers = file.followers.filter((y) => y.id !== id);
      return file.followers.length < before;
    });
    if (!gone) throw new NotFoundException({ error: 'No such follower.' });
    return { ok: true };
  }

  private async decide(
    id: string,
    status: 'revoked' | 'rejected',
    from: Follower['status'][],
    verb: string,
  ) {
    const f = await this.store.update((file) => {
      const x = file.followers.find((y) => y.id === id);
      if (!x || !from.includes(x.status)) return null;
      Object.assign(x, { status, decided: localDateTime(), token_hash: null, pickup: null });
      return { ...x };
    });
    if (!f) throw new NotFoundException({ error: 'No such follower.' });
    this.activity.record({
      type: 'friends',
      message: `${verb} ${f.name} (${f.url})`,
      trigger: 'admin',
      details: { url: f.url },
    });
    return { ok: true, follower: publicFollower(f) };
  }

  // ---------- the admin: following friends ----------

  /** {url}: asks a friend's installation to let you follow it. */
  @Post('api/admin/federation/following')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async follow(@Body() body: unknown, @Req() req: Request) {
    const url = normaliseUrl(asObject(body).url);
    if (!url) throw new BadRequestException({ error: 'Give the address of their dashboard.' });
    if (url === this.ownUrl(req)) {
      throw new BadRequestException({ error: "That's this dashboard." });
    }
    const { friends } = await this.settings.load();
    try {
      const f = await this.federation.follow(url, {
        name: friends.share_name || new URL(this.ownUrl(req)).host,
        url: this.ownUrl(req),
      });
      return { ok: true, following: { slug: f.slug, url: f.url, status: f.status } };
    } catch (e) {
      if (e instanceof FollowError) throw new ConflictException({ error: e.message });
      throw e;
    }
  }

  /** Refreshes everyone you follow now (or one: {slug}). */
  @Post('api/admin/federation/refresh')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async refresh(@Body() body: unknown) {
    const slug = asObject(body).slug;
    if (typeof slug === 'string') {
      if (!(await this.federation.refresh(slug)))
        throw new NotFoundException({ error: 'Not following that.' });
    } else await this.federation.refreshAll();
    return this.overview();
  }

  @Delete('api/admin/federation/following/:slug')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async unfollow(@Param('slug') slug: string) {
    if (!(await this.federation.unfollow(slug))) {
      throw new NotFoundException({ error: 'Not following that.' });
    }
    return { ok: true };
  }

  /** This installation's address as the browser reached it, for the friend to see. */
  private ownUrl(req: Request): string {
    const first = (v: string | string[] | undefined) =>
      String(Array.isArray(v) ? v[0] : (v ?? ''))
        .split(',')[0]
        .trim();
    const proto = first(req.headers['x-forwarded-proto']) || req.protocol || 'http';
    const host = first(req.headers['x-forwarded-host']) || first(req.headers.host) || 'localhost';
    return `${proto}://${host}${publicPrefix(req.headers, this.config.basePath)}`;
  }
}
