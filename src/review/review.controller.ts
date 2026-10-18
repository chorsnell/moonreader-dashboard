import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminOnly } from '../access/admin.guard';
import { ReaderGuard } from '../access/reader.guard';
import { PrivacyService } from '../privacy/privacy.service';
import { ACTIONS, type Action } from './review';
import { ReviewService } from './review.service';

/** Today's highlights, for anyone who may read the dashboard (filtered for visitors). */
@Controller('api/review')
export class ReviewController {
  constructor(
    private readonly review: ReviewService,
    private readonly privacy: PrivacyService,
  ) {}

  @Get('today')
  @Header('Cache-Control', 'no-store')
  @UseGuards(ReaderGuard)
  async today(@Req() req: Request) {
    const viewer = await this.privacy.viewer(req);
    const ctx = await this.privacy.context(viewer);
    const t = await this.review.today(ctx);
    return { ...t, can_review: !viewer.policy };
  }
}

/** The owner's side of the review: answers, settings and the Anki export. */
@Controller('api/admin/review')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class ReviewAdminController {
  constructor(private readonly review: ReviewService) {}

  @Get('settings')
  @Header('Cache-Control', 'no-store')
  settings() {
    return this.review.settings();
  }

  /** {per_day?, notify?, hour?} */
  @Put('settings')
  @HttpCode(200)
  async saveSettings(@Body() body: unknown) {
    return { ok: true, ...(await this.review.saveSettings(body)) };
  }

  @Get('anki.txt')
  async anki(@Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="highlights-anki.txt"');
    res.send(await this.review.anki());
  }

  /** {action: keep | less | never | reset} for one of the highlights. */
  @Post(':key')
  @HttpCode(200)
  async answer(@Param('key') key: string, @Body() body: unknown) {
    const action = (body as { action?: unknown } | null)?.action;
    if (!ACTIONS.includes(action as Action)) {
      throw new BadRequestException({ error: `action must be one of ${ACTIONS.join(', ')}.` });
    }
    if (!/^[0-9a-f]{20}$/.test(key)) throw new NotFoundException({ error: 'No such highlight.' });
    const r = await this.review.answer(key, action as Action);
    if (!r) throw new NotFoundException({ error: 'No such highlight.' });
    return r;
  }
}
