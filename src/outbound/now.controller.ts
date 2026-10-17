import { join } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminOnly } from '../access/admin.guard';
import { CoverStore } from '../covers/cover-store.service';
import type { StatsAudience } from '../stats/stats.service';
import { MAX_GOAL, OutboundService, type OutboundViewer } from './outbound.service';

/**
 * The "now" summary for Home Assistant's REST sensor and other small devices (BOO-71), and
 * the admin's settings for them: the year's goal and the device token.
 */
@Controller()
export class NowController {
  constructor(
    private readonly outbound: OutboundService,
    private readonly covers: CoverStore,
  ) {}

  private async who(req: Request): Promise<OutboundViewer> {
    const who = await this.outbound.viewerFor(req);
    if (!who) throw new UnauthorizedException({ error: 'Sign in, or use the device token.' });
    return who;
  }

  /** What you're reading, today's minutes, the streak, the year's goal, a quote. */
  @Get('api/now')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization, X-Device-Token, X-Upload-Token')
  async now(@Req() req: Request) {
    return this.outbound.now(await this.who(req));
  }

  /** The cover of the book read most recently (for a sensor's picture), or 404. */
  @Get('api/now/cover')
  async cover(@Req() req: Request, @Res() res: Response): Promise<void> {
    const who = await this.who(req);
    const now = await this.outbound.now(who);
    const book = (now.reading ?? []).find((b) => b.cover);
    if (!book) throw new NotFoundException();
    const file = (await this.covers.existing()).get(book.id);
    if (!file) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, max-age=300');
    await new Promise<void>((resolve, reject) =>
      res.sendFile(join(this.covers.dir, file), { cacheControl: false }, (err) =>
        err && !res.headersSent ? reject(new NotFoundException()) : resolve(),
      ),
    );
  }

  @Get('api/admin/outbound')
  @Header('Cache-Control', 'no-store')
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async settings() {
    const c = await this.outbound.config();
    return {
      goal: c.goal,
      device_token: !!c.device_token_hash,
      device_token_created: c.device_token_created,
      device_audience: c.device_audience,
    };
  }

  /** {audience: 'admin' | 'public' | 'reader' | 'friends'}: whose view the device token gets. */
  @Put('api/admin/outbound/audience')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async setAudience(@Body() body: unknown) {
    const a = String((body as { audience?: unknown } | null)?.audience ?? '');
    if (!['admin', 'public', 'reader', 'friends'].includes(a)) {
      throw new BadRequestException({ error: 'Choose admin, public, reader or friends.' });
    }
    const c = await this.outbound.setDeviceAudience(a as StatsAudience);
    return { ok: true, device_audience: c.device_audience };
  }

  /** {goal: books a year, or null for none}. */
  @Put('api/admin/outbound/goal')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async setGoal(@Body() body: unknown) {
    const raw = (body as { goal?: unknown } | null)?.goal;
    const goal = raw === null || raw === '' || raw === 0 || raw === undefined ? null : Number(raw);
    if (goal !== null && (!Number.isInteger(goal) || goal < 1 || goal > MAX_GOAL)) {
      throw new BadRequestException({
        error: `The goal must be a whole number, 1 to ${MAX_GOAL}.`,
      });
    }
    const c = await this.outbound.setGoal(goal);
    return { ok: true, goal: c.goal };
  }

  /** A new device token, shown this once; the old one stops working. */
  @Post('api/admin/outbound/token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async newToken() {
    return { ok: true, token: await this.outbound.newDeviceToken() };
  }

  @Delete('api/admin/outbound/token')
  @AdminOnly({ denied: 'Only the admin can do this.' })
  async revoke() {
    await this.outbound.revokeDeviceToken();
    return { ok: true };
  }
}
