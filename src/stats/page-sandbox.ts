/**
 * Runs the page's own scripts in Node, so the server works out the page's calcs (dash.calc in
 * web/calcs.js and web/features/*.js) from the same code as the browser. The scripts load as
 * they would in the page, after d3, with a stand-in for `dash` instead of runtime.js and an
 * inert DOM: anything they touch on the page (document, location, observers…) absorbs every
 * call and does nothing, so the drawing code loads but never draws.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { withFeatures } from '../web/features';

export interface CalcDef {
  id: string;
  title?: string;
  description?: string;
  inputs: string[];
  fn: (...args: unknown[]) => unknown;
}

/** A data file the page loads: books, reads and daily, plus any a feature adds with dash.file. */
export interface DataFileDef {
  id: string;
  /** Its name under data/, e.g. books.json. */
  name: string;
  /** Loads as [] when it's missing. */
  optional: boolean;
}

/** The calcs and data files the page's scripts registered. */
export interface PageCalcs {
  calcs: CalcDef[];
  files: DataFileDef[];
  /** Scripts that failed to load (their calcs, if any, are left to the browser). */
  failed: { script: string; error: string }[];
  /** Changes when any script does. */
  signature: string;
  /**
   * Called with the calc being run (or null after): while one runs, anything it reads
   * besides its inputs (the DOM, dash.params, dash.data…) is noted here.
   */
  watch(id: string | null): Set<string>;
}

const DATA_URL = /^data\/([a-z_]+\.json)$/;

/** The scripts index.html loads, in order, with the feature scripts in place. */
export async function pageScripts(webDir: string): Promise<string[]> {
  const page = await withFeatures(await readFile(join(webDir, 'index.html'), 'utf8'), webDir);
  return [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
}

/** A signature of the page's scripts (names and modification times), to notice edits. */
export async function scriptsSignature(webDir: string): Promise<string> {
  const scripts = await pageScripts(webDir);
  const times = await Promise.all(
    scripts.map((s) =>
      stat(join(webDir, s)).then(
        (st) => `${s}@${st.mtimeMs}`,
        () => `${s}@0`,
      ),
    ),
  );
  return times.join('|');
}

/**
 * Something on the page that absorbs every use: each property of it is itself, and calling
 * or constructing it gives itself too. `own` gives some properties real values.
 */
export function inertObject(
  touched: (what: string) => void,
  own: Record<string, unknown> = {},
): unknown {
  const inert: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined; // not a promise
      if (typeof k === 'string' && Object.hasOwn(own, k)) return own[k];
      touched(`dom:${String(k)}`);
      return inert;
    },
    set: () => true,
    apply: () => inert,
    construct: () => inert as object,
  });
  return inert;
}

/**
 * A browser-like global for the page's scripts: `window` is the global itself, the DOM is
 * inert, timers never fire and fetch never answers. `touched` hears every inert access.
 */
export function browserContext(
  touched: (what: string) => void,
  globals: Record<string, unknown> = {},
): Context {
  const noop = () => undefined;
  const inert = inertObject(touched);
  const context = createContext({
    console,
    document: inert,
    location: inert,
    history: inert,
    navigator: inert,
    localStorage: inert,
    sessionStorage: inert,
    matchMedia: () => inert,
    getComputedStyle: () => inert,
    getSelection: () => inert,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    scrollTo: noop,
    requestAnimationFrame: noop,
    cancelAnimationFrame: noop,
    setTimeout: noop,
    clearTimeout: noop,
    setInterval: noop,
    clearInterval: noop,
    fetch: () => new Promise(noop),
    CustomEvent: inert,
    Event: inert,
    Image: inert,
    ResizeObserver: inert,
    MutationObserver: inert,
    IntersectionObserver: inert,
    HTMLElement: inert,
    Element: inert,
    Node: inert,
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1,
    URL,
    URLSearchParams,
    performance,
    ...globals,
  });
  runInContext('window = globalThis; self = globalThis;', context);
  return context;
}

/** Loads the page's scripts (from index.html) and returns the calcs they register. */
export async function loadPageCalcs(webDir: string): Promise<PageCalcs> {
  const scripts = await pageScripts(webDir);
  const signature = await scriptsSignature(webDir);
  const calcs: CalcDef[] = [];
  const files = new Map<string, DataFileDef>(
    ['books', 'reads', 'daily'].map((id) => [id, { id, name: `${id}.json`, optional: false }]),
  );
  let current: Set<string> | null = null;
  const touched = (what: string) => current?.add(what);
  const dash = {
    file: (id: string, url: string, o: { optional?: boolean } = {}) => {
      const m = DATA_URL.exec(String(url));
      if (m) files.set(id, { id, name: m[1], optional: Boolean(o.optional) });
    },
    calc: (id: string, o: Omit<CalcDef, 'id'>) => calcs.push({ ...o, id }),
    // another calc's function over other inputs, as runtime.js does
    reuse: (id: string, from: string, inputs: string[]) => {
      const base = calcs.find((c) => c.id === from);
      if (!base) throw new Error(`dash.reuse: no calc ${from}`);
      calcs.push({ ...base, id, inputs });
    },
    // the rest is what a calc must not use: it depends on the viewer or the page
    data: (id: string) => (touched(`dash.data:${id}`), { status: 'missing', data: [] }),
    params: () => (touched('dash.params'), {}),
    cover: () => (touched('dash.cover'), null),
    needs: () => new Set(),
    onData: () => undefined,
    setParams: () => undefined,
    resetParams: () => undefined,
    setLink: () => undefined,
    reload: () => Promise.resolve(),
    colors: Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`),
  };
  const context = browserContext(touched, { dash });
  const failed: PageCalcs['failed'] = [];
  runInContext(await readFile(join(webDir, 'vendor', 'd3.min.js'), 'utf8'), context);
  for (const s of scripts) {
    if (s === 'runtime.js' || s.startsWith('vendor/')) continue;
    try {
      runInContext(await readFile(join(webDir, s), 'utf8'), context, { filename: s });
    } catch (e) {
      failed.push({ script: s, error: String(e) });
    }
  }
  return {
    calcs,
    files: [...files.values()],
    failed,
    signature,
    watch(id) {
      current = id === null ? null : new Set();
      return current ?? new Set();
    },
  };
}
