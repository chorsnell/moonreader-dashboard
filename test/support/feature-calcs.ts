/**
 * Runs web scripts' dash.calc functions in Node: loads the scripts into a sandbox with a
 * stand-in `dash` and `rh` (drawing calls do nothing), then computes a calc from the inputs
 * given, working out any calc inputs from the other calcs the scripts registered.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { WEB_DIR } from '../../src/paths';

type Calc = { inputs: string[]; fn: (...args: unknown[]) => unknown };

export function loadCalcs(...scripts: string[]) {
  const calcs = new Map<string, Calc>();
  const noop = () => undefined;
  const rh = new Proxy({}, { get: () => noop });
  const dash = {
    calc: (id: string, o: Calc) => calcs.set(id, o),
    file: noop,
    data: () => ({ status: 'missing', data: [] }),
    onData: noop,
    colors: [],
  };
  const context = createContext({ dash, rh, console, matchMedia: () => ({ matches: false }) });
  for (const s of scripts) runInContext(readFileSync(join(WEB_DIR, s), 'utf8'), context);

  return function run<T = Record<string, unknown>>(id: string, data: Record<string, unknown>): T[] {
    const memo = new Map<string, unknown>(Object.entries(data));
    const get = (k: string): unknown => {
      if (memo.has(k)) return memo.get(k);
      const c = calcs.get(k);
      if (!c) throw new Error(`no input ${k}`);
      const v = c.fn(...c.inputs.map(get));
      memo.set(k, v);
      return v;
    };
    // round-trip through JSON so arrays from the sandbox compare equal in Jest
    return JSON.parse(JSON.stringify(get(id))) as T[];
  };
}
