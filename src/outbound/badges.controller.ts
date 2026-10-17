import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller, Get, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccessSettingsService } from '../access/access-settings.service';
import { CoverStore } from '../covers/cover-store.service';
import { heatmap, readingCard, yearBadge, type Theme } from './badges';
import { OutboundService } from './outbound.service';

/** How long browsers and image proxies (GitHub's camo) may keep a badge. */
const MAX_AGE = 1800;
/** Covers bigger than this aren't embedded (the card then has no cover). */
const MAX_COVER_BYTES = 400_000;

const theme = (v: unknown): Theme => (v === 'dark' ? 'dark' : 'light');
const heading = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : undefined;

/**
 * Embeddable SVG badges (BOO-75): /badge/reading.svg, /badge/year.svg and
 * /badge/heatmap.svg. Always the public's view, whoever asks, and only for a public
 * dashboard: behind a read password there is nothing the public may see, so they 404.
 */
@Controller('badge')
export class BadgesController {
  constructor(
    private readonly outbound: OutboundService,
    private readonly settings: AccessSettingsService,
    private readonly covers: CoverStore,
  ) {}

  @Get(':name')
  async badge(
    @Param('name') name: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if ((await this.settings.load()).access !== 'public') throw new NotFoundException();
    const svg = await this.draw(name, query);
    if (svg === null) throw new NotFoundException();
    const etag = `"${createHash('sha256').update(svg).digest('base64url').slice(0, 22)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', `public, max-age=${MAX_AGE}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // an SVG opened on its own runs nothing
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    );
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.type('image/svg+xml; charset=utf-8').send(svg);
  }

  private async draw(name: string, q: Record<string, unknown>): Promise<string | null> {
    const who = await this.outbound.as('public');
    const t = theme(q.theme);
    const head = heading(q.title);
    if (name === 'reading.svg') {
      const now = await this.outbound.now(who);
      const first = now.reading?.[0];
      const cover = first?.cover ? await this.coverData(first.id) : null;
      return readingCard({ now, cover, theme: t, heading: head });
    }
    if (name === 'year.svg') {
      const [now, set] = await Promise.all([this.outbound.now(who), this.outbound.set(who)]);
      const kpis = Array.isArray(set.rows.kpis)
        ? (set.rows.kpis as { metric: string; value: unknown }[])
        : [];
      const h = kpis.find((k) => k.metric === 'hours_ytd')?.value;
      // without the day-by-day log the public has no hours to count
      const hours = who.viewer.policy?.diary && typeof h === 'number' ? h : null;
      const style = q.style === 'card' ? 'card' : 'badge';
      return yearBadge({ now, hours, theme: t, style, heading: head });
    }
    if (name === 'heatmap.svg') {
      const policy = who.viewer.policy;
      if (!policy?.diary) return null;
      const [now, set] = await Promise.all([this.outbound.now(who), this.outbound.set(who)]);
      const w = Number(q.weeks);
      const weeks = Number.isInteger(w) && w >= 4 && w <= 53 ? w : 26;
      // daily.json drops to weeks when streaks are hidden (privacy.ts effectiveDates)
      const dates = policy.dates === 'day' && !policy.streaks ? 'week' : policy.dates;
      return heatmap({
        daily: set.inputs.get('daily'),
        end: now.today,
        dates,
        weeks,
        theme: t,
        heading: head,
      });
    }
    return null;
  }

  /** A cover the public may see, as a data: URI to embed. */
  private async coverData(bookId: string): Promise<string | null> {
    const file = (await this.covers.existing()).get(bookId);
    if (!file) return null;
    const data = await readFile(join(this.covers.dir, file)).catch(() => null);
    if (!data || data.length > MAX_COVER_BYTES) return null;
    const type = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${type};base64,${data.toString('base64')}`;
  }
}
