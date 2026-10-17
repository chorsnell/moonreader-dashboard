/**
 * The page as the browser runs it: web/runtime.js (not the server's stand-in for it) with
 * every script index.html loads, an inert DOM and a fetch that serves the data files given
 * (and, if given, the server's stats bundle). Resolves once the page has loaded its data and
 * worked out its calcs, with what dash.data() then holds for each.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInContext } from 'node:vm';
import { browserContext, inertObject, pageScripts } from '../../src/stats/page-sandbox';
import { WEB_DIR } from '../../src/paths';

export interface PageRun {
  /** calc id -> {status, data} as dash.data(id) gives it. */
  state: Record<string, { status: string; data: unknown }>;
  /** The calcs the page worked out itself (it skips those in the bundle). */
  ran: Set<string>;
  /** What dash.precomputed() says came from the server. */
  precomputed: string[];
}

export async function runPage(
  files: Record<string, unknown>,
  calcIds: string[],
  bundle: Record<string, unknown> | null = null,
): Promise<PageRun> {
  const ready: (() => unknown)[] = [];
  const noop = () => undefined;
  const document = inertObject(noop, {
    addEventListener: (type: string, fn: () => unknown) => {
      if (type === 'DOMContentLoaded') ready.push(fn);
    },
  });
  const response = (body: unknown) =>
    Promise.resolve({
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(body)) as unknown),
    });
  const fetch = (url: string) => {
    const path = String(url).split('?')[0];
    if (path === 'api/config') return response({ has_data: true });
    if (path === 'api/covers') return response({});
    if (path === 'api/stats/page') {
      return response(bundle ? { version: 'test', generated: null, calcs: bundle } : undefined);
    }
    const m = /^data\/([a-z_]+)\.json$/.exec(path);
    return response(m ? files[m[1]] : undefined);
  };
  const quiet = { ...console, log: noop, warn: noop, error: noop, info: noop };
  const context = browserContext(noop, {
    document,
    fetch,
    console: quiet,
    location: inertObject(noop, { search: '', hash: '', pathname: '/' }),
  });
  runInContext(await readFile(join(WEB_DIR, 'vendor', 'd3.min.js'), 'utf8'), context);
  runInContext(await readFile(join(WEB_DIR, 'runtime.js'), 'utf8'), context);
  // note which calcs the page runs itself
  const ran = new Set<string>();
  const dash = runInContext('window.dash', context) as {
    calc: (id: string, o: { fn: (...a: unknown[]) => unknown }) => void;
    data: (id: string) => { status: string; data: unknown };
    precomputed: () => string[];
  };
  const calc = dash.calc;
  dash.calc = (id, o) =>
    calc(id, {
      ...o,
      fn: (...a: unknown[]) => {
        ran.add(id);
        return o.fn(...a);
      },
    });
  for (const s of await pageScripts(WEB_DIR)) {
    if (s === 'runtime.js' || s.startsWith('vendor/')) continue;
    runInContext(await readFile(join(WEB_DIR, s), 'utf8'), context, { filename: s });
  }
  await ready[0](); // runtime.js's load(), the first to listen
  const state = Object.fromEntries(
    calcIds.map((id) => {
      const { status, data } = dash.data(id);
      return [id, { status, data: JSON.parse(JSON.stringify(data ?? null)) as unknown }];
    }),
  );
  return { state, ran, precomputed: dash.precomputed() };
}
