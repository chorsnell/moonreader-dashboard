import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminOnly } from '../access/admin.guard';
import { HighlightsExportService, ReadwiseError } from './highlights-export.service';

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function asHttp(e: unknown): unknown {
  if (!(e instanceof ReadwiseError)) return e;
  if (e.status === 400) return new BadRequestException({ error: e.message });
  if (e.status === 429) return new HttpException({ error: e.message }, 429);
  return new BadGatewayException({ error: e.message });
}

/**
 * Exporting highlights (BOO-82): a Markdown file per book for Obsidian or Logseq (zipped),
 * a CSV for Readwise's import, and pushing to Readwise's API. Admin only; the Readwise
 * token is kept on the server and never sent back.
 */
@Controller('api/admin/highlights')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class HighlightsExportController {
  constructor(private readonly exports: HighlightsExportService) {}

  /** How much there is to export, and whether Readwise is connected (not the token). */
  @Get()
  @Header('Cache-Control', 'no-store')
  summary() {
    return this.exports.summary();
  }

  @Get('export/markdown.zip')
  async markdown(@Res() res: Response): Promise<void> {
    const body = await this.exports.markdown();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="highlights-markdown.zip"');
    res.send(body);
  }

  @Get('export/readwise.csv')
  async csv(@Res() res: Response): Promise<void> {
    const body = await this.exports.csv();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="readwise_highlights.csv"');
    res.send(body);
  }

  /** Saves the Readwise access token once Readwise accepts it. */
  @Put('readwise')
  @HttpCode(200)
  async setToken(@Body() body: unknown) {
    const token = String(obj(body).token ?? '').trim();
    if (!token) throw new BadRequestException({ error: 'Paste your Readwise access token.' });
    if (token.length > 200 || /\s/.test(token)) {
      throw new BadRequestException({ error: 'That doesn’t look like a Readwise token.' });
    }
    try {
      await this.exports.setToken(token);
    } catch (e) {
      throw asHttp(e);
    }
    return { ok: true, token_set: true };
  }

  @Delete('readwise')
  async forget() {
    await this.exports.forget();
    return { ok: true, token_set: false };
  }

  /** Sends new highlights to Readwise ({all: true} sends every one again). */
  @Post('readwise/push')
  @HttpCode(200)
  async push(@Body() body: unknown) {
    try {
      return { ok: true, ...(await this.exports.push(obj(body).all === true)) };
    } catch (e) {
      throw asHttp(e);
    }
  }
}
