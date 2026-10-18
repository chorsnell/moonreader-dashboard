/**
 * The heavy part of working out one audience's stats, the same whether it runs on the main
 * thread or in the stats worker (stats-worker.ts): load the page's scripts (again when one
 * changes), read the data files as the audience is served them, run every calc and build the
 * bundles the API sends. What it gives back is plain data (strings and bytes), cheap to pass
 * between threads; the main thread parses a calc's rows only when something asks for them.
 */
import { gzipSync } from 'node:zlib';
import type { FilterContext } from '../privacy/privacy';
import { loadPageCalcs, scriptsSignature, type DataFileDef, type PageCalcs } from './page-sandbox';
import { bundleJson, computeStats, readInputs, type StatsResult } from './stats';

export interface CalcInfo {
  id: string;
  title: string | null;
  description: string | null;
  inputs: string[];
}

/** What the page's scripts load, to tell when the results could change. */
export interface PageInfo {
  signature: string;
  files: DataFileDef[];
}

export interface StatsJob {
  webDir: string;
  dataDir: string;
  /** How to filter the data files for this audience (null: the admin, unfiltered). */
  ctx: FilterContext | null;
  version: string;
  generated: string | null;
}

export interface StatsJobResult extends Omit<StatsResult, 'rows'> {
  /** calc id -> its rows as JSON. */
  rows: Record<string, string>;
  /** data file id -> its contents (as the audience gets them) as JSON, or null when missing. */
  inputs: [string, string | null][];
  calcs: CalcInfo[];
  /** GET /api/stats/all and /api/stats/page: the JSON and it gzipped. */
  bundles: Record<'all' | 'page', { json: Uint8Array; gzip: Uint8Array }>;
  /** How long the calcs took, in ms. */
  ms: number;
}

let loaded: { signature: string; calcs: Promise<PageCalcs> } | null = null;

/** The page's scripts, loaded again when one changes. */
export async function pageCalcs(webDir: string): Promise<PageCalcs> {
  const signature = await scriptsSignature(webDir);
  if (loaded?.signature !== signature) {
    const calcs = loadPageCalcs(webDir);
    const mine = { signature, calcs };
    loaded = mine;
    calcs.catch(() => loaded === mine && (loaded = null));
  }
  return loaded.calcs;
}

export async function describePage(webDir: string): Promise<PageInfo> {
  const page = await pageCalcs(webDir);
  return { signature: page.signature, files: page.files };
}

export async function runStatsJob(job: StatsJob): Promise<StatsJobResult> {
  const page = await pageCalcs(job.webDir);
  const inputs = await readInputs(job.dataDir, page.files, job.ctx);
  const started = performance.now();
  const result = computeStats(page, inputs);
  const ms = performance.now() - started;
  const bundle = (ids?: string[]) => {
    const json = Buffer.from(bundleJson(job.version, job.generated, result.rows, ids));
    return { json, gzip: gzipSync(json) };
  };
  return {
    client_only: result.client_only,
    lossy: result.lossy,
    failed: result.failed,
    page: result.page,
    rows: Object.fromEntries(Object.entries(result.rows).map(([k, v]) => [k, JSON.stringify(v)])),
    inputs: [...inputs].map(([k, v]) => [k, v === undefined ? null : JSON.stringify(v)]),
    calcs: page.calcs
      .filter((c, i, all) => all.findLastIndex((d) => d.id === c.id) === i)
      .map((c) => ({
        id: c.id,
        title: c.title ?? null,
        description: c.description ?? null,
        inputs: [...c.inputs],
      })),
    bundles: { all: bundle(), page: bundle(result.page) },
    ms,
  };
}
