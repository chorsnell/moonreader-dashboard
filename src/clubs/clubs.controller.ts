import { setTimeout as sleep } from 'node:timers/promises';
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
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessSettingsService } from '../access/access-settings.service';
import { AdminOnly } from '../access/admin.guard';
import { localDateTime } from '../common/time';
import { matchesHash, type Follower } from '../federation/federation';
import { FederationStore } from '../federation/federation.store';
import { FriendsAccessService } from '../friends/friends-access.service';
import { ActivityLogService } from '../library/activity-log.service';
import {
  ClubError,
  clubFor,
  MAX_CLUBS,
  MAX_COMMENTS,
  newClubId,
  toClubInput,
  toComment,
  type Club,
} from './clubs';
import { ClubsService } from './clubs.service';

function bad(e: unknown): never {
  if (e instanceof ClubError) throw new BadRequestException({ error: e.message });
  throw e;
}

/**
 * Book clubs (BOO-58): the clubs this installation hosts. The page reads them with the
 * owner's progress; members on other installations read and comment through
 * /api/federation/clubs with the token they follow this one with.
 */
@Controller()
export class ClubsController {
  constructor(
    private readonly clubs: ClubsService,
    private readonly federation: FederationStore,
    private readonly settings: AccessSettingsService,
    private readonly friendsAccess: FriendsAccessService,
    private readonly activity: ActivityLogService,
  ) {}

  /** The clubs, spoiler-safe at the owner's progress; for whoever may see friends. */
  @Get('api/clubs')
  @Header('Cache-Control', 'private, no-cache')
  async list(@Req() req: Request) {
    if (!(await this.friendsAccess.canRead(req))) throw new UnauthorizedException();
    if (!(await this.friendsAccess.canSee(req))) return { clubs: [] };
    const clubs = await this.clubs.list();
    const at = await this.clubs.ownerProgress(clubs);
    return { clubs: clubs.map((c) => clubFor(c, at.get(c.id) ?? 0)) };
  }

  // ---------- the admin ----------

  @Post('api/admin/clubs')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async create(@Body() body: unknown) {
    let input;
    try {
      input = toClubInput(body);
    } catch (e) {
      bad(e);
    }
    const club: Club = { ...input, id: newClubId(), created: localDateTime(), comments: [] };
    const ok = await this.clubs.update((list) => {
      if (list.length >= MAX_CLUBS) return false;
      list.push(club);
      return true;
    });
    if (!ok) throw new BadRequestException({ error: `${MAX_CLUBS} clubs at most.` });
    this.activity.record({
      type: 'friends',
      message: `Started a book club: ${club.book.title} with ${club.members.length - 1} friend(s)`,
      trigger: 'admin',
      details: { club: club.id, members: club.members.map((m) => m.key) },
    });
    return { ok: true, club: clubFor(club, 0) };
  }

  @Delete('api/admin/clubs/:id')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async remove(@Param('id') id: string) {
    const gone = await this.clubs.update((list) => {
      const i = list.findIndex((c) => c.id === id);
      if (i >= 0) list.splice(i, 1);
      return i >= 0;
    });
    if (!gone) throw new NotFoundException({ error: 'No such club.' });
    return { ok: true };
  }

  /** {position, text}: the owner's comment. */
  @Post('api/admin/clubs/:id/comments')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async ownerComment(@Param('id') id: string, @Body() body: unknown) {
    const { friends } = await this.settings.load();
    return this.comment(id, body, 'me', friends.share_name || 'You');
  }

  // ---------- members on other installations ----------

  /**
   * The clubs this follower is in. ?progress={"<club id>": pct} says how far they are in
   * each (their own spoiler protection, so their word is enough); comments beyond it are
   * hidden.
   */
  @Get('api/federation/clubs')
  @Header('Cache-Control', 'no-store')
  async memberClubs(@Req() req: Request, @Query('progress') raw?: string) {
    const f = await this.follower(req);
    let progress: Record<string, unknown> = {};
    try {
      progress = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      // none given: everything hidden
    }
    const { friends } = await this.settings.load();
    const host = friends.share_name || 'Host';
    const mine = (await this.clubs.list()).filter((c) =>
      c.members.some((m) => m.follower === f.id),
    );
    return {
      clubs: mine.map((c) => {
        const at = Number(progress[c.id]);
        const out = clubFor(c, Number.isFinite(at) ? Math.max(0, Math.min(100, at)) : 0);
        return {
          ...out,
          // as the member sees it: the host is a friend of theirs, and one of these is them
          members: c.members.map((m) => ({
            key: m.key,
            name: m.key === 'me' ? host : m.name,
            host: m.key === 'me',
            you: m.follower === f.id,
          })),
          comments: out.comments.map((x) => ({ ...x, name: x.member === 'me' ? host : x.name })),
        };
      }),
    };
  }

  /** {position, text}: a member's comment, posted from their installation. */
  @Post('api/federation/clubs/:id/comments')
  @HttpCode(200)
  async memberComment(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const f = await this.follower(req);
    const club = (await this.clubs.list()).find((c) => c.id === id);
    const member = club?.members.find((m) => m.follower === f.id);
    if (!club || !member) throw new NotFoundException({ error: 'No such club.' });
    return this.comment(id, body, member.key, member.name);
  }

  private async comment(id: string, body: unknown, member: string, name: string) {
    let c;
    try {
      c = toComment(body);
    } catch (e) {
      bad(e);
    }
    const comment = { id: newClubId(), member, name, created: localDateTime(), ...c };
    const ok = await this.clubs.update((list) => {
      const club = list.find((x) => x.id === id);
      if (!club) return null;
      if (club.comments.length >= MAX_COMMENTS) return false;
      club.comments.push(comment);
      return true;
    });
    if (ok === null) throw new NotFoundException({ error: 'No such club.' });
    if (!ok) throw new BadRequestException({ error: 'That club has too many comments.' });
    return { ok: true, comment: { ...comment, hidden: false } };
  }

  private async follower(req: Request): Promise<Follower> {
    const auth = req.headers.authorization ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const f = (await this.federation.read()).followers.find(
      (x) => x.status === 'approved' && matchesHash(token, x.token_hash),
    );
    if (!f) {
      await sleep(200);
      throw new UnauthorizedException({ error: 'Not shared with you (any more).' });
    }
    return f;
  }
}
