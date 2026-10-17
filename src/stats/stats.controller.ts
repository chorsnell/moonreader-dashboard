import { Controller, Get, NotFoundException, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReaderGuard } from '../access/reader.guard';
import { PrivacyService } from '../privacy/privacy.service';
import { StatsService, type Bundle, type StatsSet } from './stats.service';
import { authorSummary, yearSummary } from './summaries';

/**
 * The page's stats, worked out on the server: for the page itself (one bundle), and for
 * friends' installations and other tools (one calc at a time, a year, an author). Who may
 * ask is as for /data: everyone when the dashboard is public, otherwise people signed in.
 * Each viewer gets numbers worked out from only what they may see (see docs/api.md).
 */
@Controller('api')
@UseGuards(ReaderGuard)
export class StatsController {
  constructor(
    private readonly stats: StatsService,
    private readonly privacy: PrivacyService,
  ) {}

  /** What's available: every calc, which ones the server works out, and the data version. */
  @Get('stats')
  async index(@Req() req: Request, @Res() res: Response): Promise<void> {
    const set = await this.forRequest(req, res);
    const server = new Set(Object.keys(set.rows));
    res.json({
      version: set.version,
      generated: set.generated,
      calcs: set.calcs.map((c) => ({ ...c, server: server.has(c.id) })),
      page: set.page,
      client_only: set.client_only,
      lossy: set.lossy,
      failed: set.failed,
    });
  }

  /** Every calc the server worked out, as {version, generated, calcs: {id: rows}}. */
  @Get('stats/all')
  async all(@Req() req: Request, @Res() res: Response): Promise<void> {
    send(req, res, (await this.forRequest(req, res)).bundles.all);
  }

  /**
   * What the page loads: the same, less the big calcs that are quicker to work out in the
   * browser than to download. The page works out whatever isn't here itself.
   */
  @Get('stats/page')
  async page(@Req() req: Request, @Res() res: Response): Promise<void> {
    send(req, res, (await this.forRequest(req, res)).bundles.page);
  }

  /** One year: its totals, its year-in-review row and the reads finished in it. */
  @Get('stats/year/:year')
  async year(@Param('year') year: string, @Req() req: Request, @Res() res: Response) {
    const set = await this.forRequest(req, res);
    const summary = /^\d{4}$/.test(year) ? yearSummary(set, Number(year)) : null;
    if (!summary) throw new NotFoundException();
    res.json(summary);
  }

  /** One calc's rows. */
  @Get('stats/:calc')
  async calc(@Param('calc') id: string, @Req() req: Request, @Res() res: Response) {
    const set = await this.forRequest(req, res);
    if (!Object.hasOwn(set.rows, id)) throw new NotFoundException();
    res.json(set.rows[id]);
  }

  /** One author: their books and reads, with totals. */
  @Get('author/:name')
  async author(@Param('name') name: string, @Req() req: Request, @Res() res: Response) {
    const set = await this.forRequest(req, res);
    const summary = authorSummary(set, name);
    if (!summary) throw new NotFoundException();
    res.json(summary);
  }

  private async forRequest(req: Request, res: Response): Promise<StatsSet> {
    const set = await this.stats.forViewer(await this.privacy.viewer(req));
    res.setHeader('Vary', 'Cookie, X-Upload-Token');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Stats-Version', set.version);
    return set;
  }
}

/** A bundle, gzipped when the client takes it, or 304 when it already has this version. */
function send(req: Request, res: Response, { json, gzip, etag }: Bundle): void {
  res.setHeader('ETag', etag);
  res.append('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type('application/json');
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.setHeader('Content-Encoding', 'gzip');
    res.send(gzip);
  } else {
    res.send(json);
  }
}
