import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly } from '../access/admin.guard';
import { RequestBodyError, saveRequestBody } from '../common/http/request-body';
import { LayoutError, parseLayout } from './layout';
import { LayoutStore } from './layout-store';

/** A long book's layout is a few hundred kB. */
const MAX_LAYOUT_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/koreader/layout: where each page of a book starts, from the KOReader plugin
 * (koreader/API.md), so reading positions convert exactly between KOReader and Moon+.
 */
@Controller('api/koreader')
@AdminOnly({ denied: 'Only the admin can do this.', off: 'Set UPLOAD_TOKEN to sync KOReader.' })
export class LayoutController {
  constructor(private readonly layouts: LayoutStore) {}

  @Post('layout')
  @HttpCode(200)
  async layout(@Req() req: Request) {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
      req.resume();
      throw new BadRequestException({ error: 'Send the body as application/json.' });
    }
    const tmp = await mkdtemp(join(tmpdir(), 'layout-'));
    try {
      const path = join(tmp, 'body');
      try {
        await saveRequestBody(req, path, { maxBytes: MAX_LAYOUT_BYTES });
      } catch (e) {
        if (e instanceof RequestBodyError) throw new BadRequestException({ error: e.message });
        throw e;
      }
      let layout;
      try {
        layout = parseLayout(JSON.parse(await readFile(path, 'utf8')));
      } catch (e) {
        if (e instanceof LayoutError) throw new BadRequestException({ error: e.message });
        if (e instanceof SyntaxError) {
          throw new BadRequestException({ error: 'The body is not valid JSON.' });
        }
        throw e;
      }
      await this.layouts.put(layout);
      return { ok: true, pages: layout.pages.length };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}
