/**
 * Works out the page's calcs on the server, exactly as the page's runtime.js would: inputs
 * first (the data files, filtered for the viewer), then each calc in the order the scripts
 * registered them, each from the results of the ones before.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { filterDataFile, type FilterContext } from '../privacy/privacy';
import type { DataFileDef, PageCalcs } from './page-sandbox';

/**
 * Each data file's contents (usually rows, but any JSON), or undefined when it can't be had
 * (the page then can't work out the calcs that use it).
 */
export type Inputs = Map<string, unknown>;

export interface StatsResult {
  /** calc id -> rows (as JSON), for every calc the server could work out. */
  rows: Record<string, unknown>;
  /**
   * Calcs left to the browser: they read something besides their inputs (the viewer's
   * filters, the page), or use such a calc.
   */
  client_only: string[];
  /**
   * Calcs whose values don't survive JSON as they are (NaN, dates, maps): they're in rows
   * as JSON has them (NaN as null), for other tools, but the page works them out itself.
   */
  lossy: string[];
  /** Calcs that threw, or whose inputs were missing. */
  failed: string[];
  /** The calcs worth sending to the page in its one bundle (see forPage). */
  page: string[];
}

/** The data files as /data/<name> would serve them to this viewer (ctx null: the admin). */
export async function readInputs(
  dataDir: string,
  files: DataFileDef[],
  ctx: FilterContext | null,
): Promise<Inputs> {
  const out: Inputs = new Map();
  for (const f of files) {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(join(dataDir, f.name), 'utf8')) as unknown;
      // null: not this viewer's to see (a 404 for the page)
      if (ctx) value = filterDataFile(f.name, value, ctx) ?? undefined;
    } catch {
      value = undefined;
    }
    // as in the page: an optional file it can't have loads as []
    out.set(f.id, value === undefined && f.optional ? [] : value);
  }
  return out;
}

/** True when JSON.parse(JSON.stringify(v)) gives back the same thing. */
export function survivesJson(v: unknown): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.every((x) => x !== undefined && survivesJson(x));
  // a plain object (from the sandbox, so not this realm's Object)
  const proto = Object.getPrototypeOf(v) as { constructor?: { name?: string } } | null;
  if (proto !== null && proto.constructor?.name !== 'Object') return false;
  if (typeof (v as { toJSON?: unknown }).toJSON === 'function') return false;
  // an undefined field is dropped, which reads the same
  return Object.values(v).every((x) => x === undefined || survivesJson(x));
}

/** Runs every calc the page registered on these inputs. */
export function computeStats(page: PageCalcs, inputs: Inputs): StatsResult {
  const state = new Map<string, unknown>();
  for (const [id, value] of inputs) if (value !== undefined) state.set(id, value);
  const rows: Record<string, unknown> = {};
  const clientOnly = new Set<string>();
  const failed = new Set<string>();
  const lossy = new Set<string>();
  // calcs that depend on the viewer or the page, and so does anything worked out from them
  const tainted = new Set<string>();
  const ms = new Map<string, number>();
  const offPage = new Set<string>();
  for (const c of page.calcs) {
    // a later calc with the same id replaces the earlier one, as in the page
    state.delete(c.id);
    delete rows[c.id];
    clientOnly.delete(c.id);
    lossy.delete(c.id);
    failed.delete(c.id);
    tainted.delete(c.id);
    offPage.delete(c.id);
    const missing = c.inputs.filter((i) => !state.has(i));
    if (missing.length) {
      // a friend's data (friend_books…), which the page passes in through dash.calcWith:
      // such calcs are the page's to work out
      if (missing.every((i) => i.startsWith('friend_') || offPage.has(i))) {
        offPage.add(c.id);
        clientOnly.add(c.id);
      } else failed.add(c.id);
      continue;
    }
    const touched = page.watch(c.id);
    const started = performance.now();
    let value: unknown;
    try {
      value = c.fn(...c.inputs.map((i) => state.get(i)));
    } catch {
      failed.add(c.id);
      continue;
    } finally {
      page.watch(null);
    }
    ms.set(c.id, performance.now() - started);
    state.set(c.id, value);
    if (touched.size || c.inputs.some((i) => tainted.has(i))) {
      tainted.add(c.id);
      clientOnly.add(c.id);
    } else {
      if (!survivesJson(value)) lossy.add(c.id);
      rows[c.id] = value;
    }
  }
  // as JSON once they're all done (a later calc may add to an earlier one's rows, and the
  // page sees them afterwards too): plain objects of this realm, no shared references
  const out: Record<string, unknown> = {};
  const sent: string[] = [];
  for (const [id, value] of Object.entries(rows)) {
    const json = JSON.stringify(value);
    out[id] = JSON.parse(json);
    if (!lossy.has(id) && forPage(json.length, ms.get(id) ?? 0)) sent.push(id);
  }
  return {
    rows: out,
    client_only: [...clientOnly],
    lossy: [...lossy],
    failed: [...failed],
    page: sent,
  };
}

/**
 * Whether a calc is worth sending to the page rather than working out there: small results
 * always are; big ones only if they take a while to work out. A long list that takes a
 * moment to build (the diary, a heatmap's days) is quicker to build on a phone than to
 * download: about 32 KB of JSON per millisecond here is where they break even (a phone
 * works it out about four times slower; gzip shrinks it about eight times on a 4G link).
 */
export function forPage(bytes: number, ms: number): boolean {
  return bytes <= 16_000 || bytes / Math.max(ms, 0.05) <= 32_000;
}

/** {version, generated, calcs: {id: rows}}: the shape of /api/stats/all and /api/stats/page. */
export function bundleJson(
  version: string,
  generated: string | null,
  rows: Record<string, unknown>,
  ids = Object.keys(rows),
): string {
  const calcs = Object.fromEntries(ids.map((id) => [id, rows[id]]));
  return JSON.stringify({ version, generated, calcs });
}
