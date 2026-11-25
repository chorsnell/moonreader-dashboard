import { setTimeout as sleep } from 'node:timers/promises';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { WRONG_PASSWORD_DELAY_MS } from '../access/admin.guard';
import { appConfig, type AppConfigType } from '../config/app.config';
import { KosyncAuthGuard, keyMatches } from './kosync-auth.guard';
import { ProgressSyncError, ProgressSyncService, parseUpdate } from './progress-sync.service';

/**
 * A KOReader progress sync server (the API of koreader/koreader-sync-server), so KOReader's
 * own Progress sync plugin can use the dashboard: set its custom sync server to
 * `<dashboard address>/kosync`, log in with any username and UPLOAD_TOKEN as the password.
 * There is one account: "Register" succeeds only with that password.
 */
@Controller('kosync')
export class KosyncController {
  constructor(
    private readonly sync: ProgressSyncService,
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
  ) {}

  @Get('healthcheck')
  health() {
    return { state: 'OK' };
  }

  @Post('users/create')
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!username || !password) {
      throw new BadRequestException({ code: 2003, message: 'Invalid request' });
    }
    if (!keyMatches(password, this.config.uploadToken)) {
      await sleep(WRONG_PASSWORD_DELAY_MS);
      // the code koreader-sync-server uses for a taken username: there is only one account
      throw new HttpException(
        { code: 2002, message: "Use the dashboard's admin password (UPLOAD_TOKEN), then log in." },
        402,
      );
    }
    return { username };
  }

  @Get('users/auth')
  @UseGuards(KosyncAuthGuard)
  @Header('Cache-Control', 'no-store')
  auth() {
    return { authorized: 'OK' };
  }

  @Put('syncs/progress')
  @UseGuards(KosyncAuthGuard)
  async update(@Body() body: unknown) {
    let update;
    try {
      update = parseUpdate(body);
    } catch (e) {
      if (e instanceof ProgressSyncError) {
        throw new BadRequestException({ code: 2004, message: e.message });
      }
      throw e;
    }
    const timestamp = await this.sync.push(update);
    return { document: update.document, timestamp };
  }

  @Get('syncs/progress/:document')
  @UseGuards(KosyncAuthGuard)
  @Header('Cache-Control', 'no-store')
  async progress(@Param('document') document: string) {
    const found = await this.sync.pull(document);
    if (!found) return {};
    // No timestamp, on purpose. With one, KOReader's "newer"/"older" settings compare times,
    // and on opening a book everything counts as newer. Without one they compare how far
    // through the book you are, so "silently forward, ask backwards" means what it says.
    const { progress, percentage, device, device_id } = found;
    return { document, progress, percentage, device, device_id };
  }
}
