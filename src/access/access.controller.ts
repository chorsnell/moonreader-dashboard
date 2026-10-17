import { timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { appConfig, type AppConfigType } from '../config/app.config';
import { publicPrefix } from '../common/http/public-prefix';
import { ActivityLogService } from '../library/activity-log.service';
import { AccessSettingsService, checkPassword, hashPassword } from './access-settings.service';
import { SESSION_COOKIE } from './access.service';
import { toChangeAccessDto, toLoginDto } from './access.dto';
import { AdminOnly, WRONG_PASSWORD_DELAY_MS } from './admin.guard';
import { SessionService, type Role } from './session.service';

const MIN_READ_PASSWORD = 4;

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Signing in and out, and the admin's choice of who can see the dashboard. */
@Controller('api')
export class AccessController {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly settings: AccessSettingsService,
    private readonly sessions: SessionService,
    private readonly activity: ActivityLogService,
  ) {}

  /** The admin token signs in as the admin; the read password as a reader. */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { password } = toLoginDto(body);
    const token = this.config.uploadToken;
    const readPassword = (await this.settings.load()).read_password;
    let role: Role;
    if (token && password && same(password, token)) role = 'admin';
    else if (readPassword && password && checkPassword(password, readPassword)) role = 'reader';
    else {
      await sleep(WRONG_PASSWORD_DELAY_MS);
      throw new ForbiddenException({ error: 'Wrong password.' });
    }
    const { value, maxAge } = await this.sessions.create(role);
    res.setHeader('Set-Cookie', this.cookie(req, value, maxAge));
    return { ok: true, role };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', this.cookie(req, '', 0));
    return { ok: true };
  }

  /** Public, or only with the read password. Optionally sets a new read password. */
  @Post('access')
  @HttpCode(200)
  @AdminOnly({ denied: 'Only the admin can change this.' })
  async changeAccess(@Body() body: unknown) {
    const { access, password } = toChangeAccessDto(body);
    const next = { ...(await this.settings.load()), access };
    if (password) {
      if (password.length < MIN_READ_PASSWORD) {
        throw new BadRequestException({
          error: `Use a read password of at least ${MIN_READ_PASSWORD} characters.`,
        });
      }
      if (this.config.uploadToken && same(password, this.config.uploadToken)) {
        throw new BadRequestException({
          error: 'Use a read password that differs from the admin token.',
        });
      }
      next.read_password = hashPassword(password);
    }
    if (next.access === 'password' && !next.read_password) {
      throw new BadRequestException({ error: 'Set a read password.' });
    }
    await this.settings.save(next);
    this.activity.log(
      `Dashboard is now ${next.access}${password ? ', with a new read password' : ''}`,
    );
    return { ok: true, access: next.access };
  }

  private cookie(req: Request, value: string, maxAge: number): string {
    const secure =
      String(req.headers['x-forwarded-proto'] ?? '').toLowerCase() === 'https' ? '; Secure' : '';
    const path = `${publicPrefix(req.headers, this.config.basePath)}/`;
    return `${SESSION_COOKIE}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
  }
}
