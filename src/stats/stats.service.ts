import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AccessSettingsService } from '../access/access-settings.service';
import { localDate } from '../common/time';
import { appConfig, type AppConfigType } from '../config/app.config';
import { LIBRARY_REBUILT } from '../library/library.events';
import { LibraryService } from '../library/library.service';
import { WEB_DIR } from '../paths';
import { filterDataFile, VIEWER_ROLES, type ViewerRole } from '../privacy/privacy';
import { PrivacyService, type Viewer } from '../privacy/privacy.service';
import { scriptsSignature } from './page-sandbox';
import type { Inputs, StatsResult } from './stats';
import type { CalcInfo, PageInfo } from './stats-job';
import { StatsRunner } from './stats-runner';

export type { CalcInfo } from './stats-job';

/** Whose numbers: the admin's (everything), or what a visitor role may see. */
export type StatsAudience = 'admin' | ViewerRole;

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

/** Each calc's rows, parsed from JSON the first time they're read (most requests want a bundle). */
export function lazyRows(json: Record<string, string>): Record<string, unknown> {
  const rows: Record<string, unknown> = {};
  for (const [id, text] of Object.entries(json)) {
    Object.defineProperty(rows, id, {
      enumerable: true,
      configurable: true,
      get: () => {
        const value = JSON.parse(text) as unknown;
        Object.defineProperty(rows, id, { value, enumerable: true, writable: false });
        return value;
      },
    });
  }
  return rows;
}

/** The data files, each parsed from JSON the first time it's read (null: missing). */
export function lazyInputs(json: [string, string | null][]): Inputs {
  const texts = new Map(json);
  const parsed = new Map<string, unknown>();
  const inputs = new Map<string, unknown>(json.map(([id]) => [id, undefined]));
  inputs.get = (id: string) => {
    if (!parsed.has(id)) {
      const text = texts.get(id);
      parsed.set(id, text == null ? undefined : JSON.parse(text));
    }
    return parsed.get(id);
  };
  return inputs;
}

const toBuffer = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

/**
 * The page's calcs, worked out on the server for each audience from the data that audience
 * may see, kept in memory and worked out again when the data, the privacy settings or the
 * page's scripts change. Warmed after every rebuild, so the first visitor doesn't wait. The
 * calcs themselves run in a worker thread (StatsRunner), so other requests aren't held up.
 */
@Injectable()
export class StatsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(StatsService.name);
  private page: { signature: string; info: Promise<PageInfo> } | null = null;
  private readonly cache = new Map<StatsAudience, { version: string; set: Promise<StatsSet> }>();
  /** Works the calcs out in a worker thread (or on this one, with STATS_WORKER=off). */
  readonly runner: StatsRunner;

  constructor(
    private readonly library: LibraryService,
    private readonly settings: AccessSettingsService,
    private readonly privacy: PrivacyService,
    @Inject(appConfig.KEY) config: AppConfigType,
  ) {
    this.runner = new StatsRunner({ worker: config.statsWorker });
  }

  onApplicationBootstrap(): void {
    void this.warm();
  }

  async onModuleDestroy(): Promise<void> {
    await this.runner.close();
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
    const page = await this.pageInfo();
    const version = await this.version(audience, page);
    const had = this.cache.get(audience);
    if (had?.version === version) return had.set;
    const set = this.compute(audience, version);
    this.cache.set(audience, { version, set });
    set.catch(() => this.cache.get(audience)?.set === set && this.cache.delete(audience));
    return set;
  }

  /**
   * The data files the page's scripts load (for the version). The runner loads the scripts,
   * and is asked again only when one of them changes.
   */
  private async pageInfo(): Promise<PageInfo> {
    const signature = await scriptsSignature(WEB_DIR);
    if (this.page?.signature !== signature) {
      const info = this.runner.describe(WEB_DIR);
      const mine = { signature, info };
      this.page = mine;
      info.catch(() => this.page === mine && (this.page = null));
    }
    return this.page.info;
  }

  private async version(audience: StatsAudience, page: PageInfo): Promise<string> {
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

  private async compute(audience: StatsAudience, version: string): Promise<StatsSet> {
    const { privacy } = await this.settings.load();
    const viewer: Viewer =
      audience === 'admin'
        ? { role: 'admin', preview: null, policy: null }
        : { role: audience, preview: null, policy: privacy[audience] };
    const ctx = await this.privacy.context(viewer);
    const meta = await this.library.meta();
    const shown = (ctx ? filterDataFile('meta.json', meta, ctx) : meta) as Record<string, unknown>;
    const generated = typeof shown.generated === 'string' ? shown.generated : null;
    const started = Date.now();
    const r = await this.runner.run({
      webDir: WEB_DIR,
      dataDir: this.library.data,
      ctx,
      version,
      generated,
    });
    this.log.debug(
      `${audience}: ${Object.keys(r.rows).length} calcs in ${Math.round(r.ms)} ms ` +
        `(${Date.now() - started} ms in all${this.runner.usingWorker ? ', in the worker' : ''})`,
    );
    const bundle = (name: 'all' | 'page'): Bundle => ({
      json: toBuffer(r.bundles[name].json),
      gzip: toBuffer(r.bundles[name].gzip),
      etag: `"${version}-${name}"`,
    });
    return {
      rows: lazyRows(r.rows),
      client_only: r.client_only,
      lossy: r.lossy,
      failed: r.failed,
      page: r.page,
      audience,
      version,
      generated,
      inputs: lazyInputs(r.inputs),
      calcs: r.calcs,
      bundles: { all: bundle('all'), page: bundle('page') },
    };
  }
}
