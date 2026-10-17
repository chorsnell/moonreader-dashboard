import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AccessSettingsService } from '../access/access-settings.service';
import { localDate } from '../common/time';
import { LIBRARY_REBUILT } from '../library/library.events';
import { LibraryService } from '../library/library.service';
import { WEB_DIR } from '../paths';
import { filterDataFile, VIEWER_ROLES, type ViewerRole } from '../privacy/privacy';
import { PrivacyService, type Viewer } from '../privacy/privacy.service';
import { loadPageCalcs, scriptsSignature, type PageCalcs } from './page-sandbox';
import { bundleJson, computeStats, readInputs, type Inputs, type StatsResult } from './stats';

/** Whose numbers: the admin's (everything), or what a visitor role may see. */
export type StatsAudience = 'admin' | ViewerRole;

export interface CalcInfo {
  id: string;
  title: string | null;
  description: string | null;
  inputs: string[];
}

/** One audience's results, worked out once per data, settings and scripts version. */
export interface StatsSet extends StatsResult {
  audience: StatsAudience;
  /** Changes whenever the results could. */
  version: string;
  /** When the data was built (rounded as the audience's dates are). */
  generated: string | null;
  calcs: CalcInfo[];
  /** The data files as the audience gets them, for the summaries built from them. */
  inputs: Inputs;
  /** GET /api/stats/all (every calc) and /api/stats/page (what the page loads), ready to send. */
  bundles: Record<'all' | 'page', Bundle>;
}

export interface Bundle {
  json: Buffer;
  gzip: Buffer;
  etag: string;
}

/**
 * The page's calcs, worked out on the server for each audience from the data that audience
 * may see, kept in memory and worked out again when the data, the privacy settings or the
 * page's scripts change. Warmed after every rebuild, so the first visitor doesn't wait.
 */
@Injectable()
export class StatsService implements OnApplicationBootstrap {
  private readonly log = new Logger(StatsService.name);
  private page: { signature: string; calcs: Promise<PageCalcs> } | null = null;
  private readonly cache = new Map<StatsAudience, { version: string; set: Promise<StatsSet> }>();

  constructor(
    private readonly library: LibraryService,
    private readonly settings: AccessSettingsService,
    private readonly privacy: PrivacyService,
  ) {}

  onApplicationBootstrap(): void {
    void this.warm();
  }

  /** Works everything out for every audience, ready for the first request. */
  @OnEvent(LIBRARY_REBUILT)
  async warm(): Promise<void> {
    try {
      if (!(await this.library.hasData())) return;
      for (const a of ['admin', ...VIEWER_ROLES] as StatsAudience[]) await this.get(a);
    } catch (e) {
      this.log.warn(`could not work out the stats: ${String(e)}`);
    }
  }

  /** Who a viewer's numbers are for: the admin previewing as a visitor gets the visitor's. */
  audience(viewer: Viewer): StatsAudience {
    return viewer.policy ? (viewer.preview ?? (viewer.role as ViewerRole)) : 'admin';
  }

  forViewer(viewer: Viewer): Promise<StatsSet> {
    return this.get(this.audience(viewer));
  }

  async get(audience: StatsAudience): Promise<StatsSet> {
    const page = await this.pageCalcs();
    const version = await this.version(audience, page);
    const had = this.cache.get(audience);
    if (had?.version === version) return had.set;
    const set = this.compute(audience, page, version);
    this.cache.set(audience, { version, set });
    set.catch(() => this.cache.get(audience)?.set === set && this.cache.delete(audience));
    return set;
  }

  /** The page's scripts, loaded again when one changes. */
  private async pageCalcs(): Promise<PageCalcs> {
    const signature = await scriptsSignature(WEB_DIR);
    if (this.page?.signature !== signature) {
      const calcs = loadPageCalcs(WEB_DIR);
      this.page = { signature, calcs };
      calcs.catch(() => this.page?.calcs === calcs && (this.page = null));
    }
    return this.page.calcs;
  }

  private async version(audience: StatsAudience, page: PageCalcs): Promise<string> {
    const names = [...page.files.map((f) => f.name), 'meta.json'];
    const files = await Promise.all(
      names.map((n) =>
        stat(join(this.library.data, n)).then(
          (s) => `${n}:${s.mtimeMs}:${s.size}`,
          () => `${n}:-`,
        ),
      ),
    );
    const { privacy } = await this.settings.load();
    const who = audience === 'admin' ? '' : JSON.stringify(privacy);
    return createHash('sha256')
      .update([audience, page.signature, localDate(), who, ...files].join('\n'))
      .digest('base64url')
      .slice(0, 22);
  }

  private async compute(
    audience: StatsAudience,
    page: PageCalcs,
    version: string,
  ): Promise<StatsSet> {
    const { privacy } = await this.settings.load();
    const viewer: Viewer =
      audience === 'admin'
        ? { role: 'admin', preview: null, policy: null }
        : { role: audience, preview: null, policy: privacy[audience] };
    const ctx = await this.privacy.context(viewer);
    const inputs = await readInputs(this.library.data, page.files, ctx);
    const started = Date.now();
    const result = computeStats(page, inputs);
    const meta = await this.library.meta();
    const shown = (ctx ? filterDataFile('meta.json', meta, ctx) : meta) as Record<string, unknown>;
    const generated = typeof shown.generated === 'string' ? shown.generated : null;
    const bundle = (name: string, ids?: string[]): Bundle => {
      const json = Buffer.from(bundleJson(version, generated, result.rows, ids));
      return { json, gzip: gzipSync(json), etag: `"${version}-${name}"` };
    };
    this.log.debug(
      `${audience}: ${Object.keys(result.rows).length} calcs in ${Date.now() - started} ms`,
    );
    return {
      ...result,
      audience,
      version,
      generated,
      inputs,
      calcs: page.calcs
        .filter((c, i, all) => all.findLastIndex((d) => d.id === c.id) === i)
        .map((c) => ({
          id: c.id,
          title: c.title ?? null,
          description: c.description ?? null,
          inputs: [...c.inputs],
        })),
      bundles: { all: bundle('all'), page: bundle('page', result.page) },
    };
  }
}
