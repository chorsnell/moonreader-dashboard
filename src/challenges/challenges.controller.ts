import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Get,
  Header,
  HttpCode,
  Put,
} from '@nestjs/common';
import { AdminOnly } from '../access/admin.guard';
import { ActivityLogService } from '../library/activity-log.service';
import { ChallengeError, DEFAULT_CHALLENGES, toChallenges } from './challenges';
import { ChallengesService } from './challenges.service';

/** The admin sets the reading challenges; visitors see progress through data/challenges.json. */
@Controller('api/admin/challenges')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class ChallengesController {
  constructor(
    private readonly challenges: ChallengesService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list() {
    return { ...(await this.challenges.load()), defaults: DEFAULT_CHALLENGES };
  }

  @Put()
  @HttpCode(200)
  async save(@Body() body: unknown) {
    const raw =
      body && typeof body === 'object' ? (body as Record<string, unknown>).challenges : null;
    let list;
    try {
      list = toChallenges(raw);
    } catch (e) {
      if (e instanceof ChallengeError) throw new BadRequestException({ error: e.message });
      throw e;
    }
    const challenges = await this.challenges.save(list);
    this.activity.record({
      type: 'settings',
      message: `Reading challenges saved (${challenges.length})`,
      trigger: 'admin',
    });
    return { challenges, custom: true };
  }

  /** Back to the default set. */
  @Post('reset')
  @HttpCode(200)
  async reset() {
    const challenges = await this.challenges.save(undefined);
    this.activity.record({
      type: 'settings',
      message: 'Reading challenges reset to the defaults',
      trigger: 'admin',
    });
    return { challenges, custom: false };
  }
}
