/**
 * The server works out the page's calcs from the same scripts as the browser (BOO-56). These
 * check that for every calc the numbers are identical: the server's against the page's own
 * runtime.js on the demo history and the fake backup, for the admin and for a visitor whose
 * data is filtered; and that a page given the server's bundle ends up exactly where one
 * working everything out itself does.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDemoLibrary, importInto } from '../../src/demo/demo-library';
import { localDate } from '../../src/common/time';
import { WEB_DIR } from '../../src/paths';
import {
  buildContext,
  filterDataFile,
  PRESETS,
  toPrivacySettings,
  type BookFacts,
  type FilterContext,
} from '../../src/privacy/privacy';
import { loadPageCalcs, pageScripts, type PageCalcs } from '../../src/stats/page-sandbox';
import {
  computeStats,
  forPage,
  readInputs,
  survivesJson,
  type Inputs,
} from '../../src/stats/stats';
import { makeBackup } from '../support/fake-backup';
import { runPage } from '../support/page-runtime';

jest.setTimeout(120_000);

let tmp: string;
let page: PageCalcs;
const libs: Record<'demo' | 'fake', string> = { demo: '', fake: '' };

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'server-stats-'));
  page = await loadPageCalcs(WEB_DIR);
  libs.demo = join(tmp, 'demo');
  await mkdir(libs.demo);
  await buildDemoLibrary(libs.demo, 7, { lookUpCovers: false, today: localDate() });
  libs.fake = join(tmp, 'fake');
  await mkdir(join(libs.fake, 'inbox'), { recursive: true });
  await makeBackup(join(libs.fake, 'inbox', 'test.mrpro'));
  await importInto(libs.fake, join(libs.fake, 'inbox', 'test.mrpro'), { lookUpCovers: false });
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const ids = () => [...new Set(page.calcs.map((c) => c.id))];
/** What /data/<name> serves this viewer, read straight from disk (missing: a 404). */
async function served(data: string, ctx: FilterContext | null) {
  const out: Record<string, unknown> = {};
  for (const f of page.files) {
    const raw = await readFile(join(data, f.name), 'utf8').catch(() => null);
    if (raw === null) continue;
    const value = ctx ? filterDataFile(f.name, JSON.parse(raw), ctx) : JSON.parse(raw);
    if (value !== null) out[f.id] = value;
  }
  return out;
}

describe('the page scripts in Node', () => {
  it('load without errors and register every calc the page has', async () => {
    expect(page.failed).toEqual([]);
    const scripts = await pageScripts(WEB_DIR);
    const sources = await Promise.all(scripts.map((f) => readFile(join(WEB_DIR, f), 'utf8')));
    const declared = new Set(
      sources.flatMap((src) => [...src.matchAll(/dash\.calc\('([a-z_0-9]+)'/g)].map((m) => m[1])),
    );
    expect(declared.size).toBeGreaterThanOrEqual(40);
    expect(new Set(ids())).toEqual(declared);
    expect(page.files.map((f) => f.id)).toEqual(
      expect.arrayContaining(['books', 'reads', 'daily', 'highlights', 'prices']),
    );
  });
});

describe.each(['demo', 'fake'] as const)('on the %s data', (which) => {
  async function check(data: string, ctx: FilterContext | null) {
    const server = computeStats(page, await readInputs(data, page.files, ctx));
    const files = await served(data, ctx);
    const browser = await runPage(files, ids());
    for (const id of ids()) {
      const b = browser.state[id];
      if (server.failed.includes(id)) {
        expect([id, b.status]).toEqual([id, 'error']);
      } else if (server.client_only.includes(id)) {
        // left to the page: from a friend's data on demand, so nothing on load
        expect(server.rows[id]).toBeUndefined();
        expect(server.page).not.toContain(id);
      } else if (server.lossy.includes(id)) {
        expect([id, b.status]).toEqual([id, 'ok']); // the page works it out
        expect(server.page).not.toContain(id);
      } else {
        expect([id, b.status]).toEqual([id, 'ok']);
        expect([id, server.rows[id]]).toEqual([id, b.data]);
      }
    }
    // with the server's bundle the page skips those calcs and ends up in the same place
    const bundle = Object.fromEntries(server.page.map((id) => [id, server.rows[id]]));
    const mixed = await runPage(files, ids(), bundle);
    expect(mixed.precomputed.sort()).toEqual([...server.page].sort());
    for (const id of server.page) expect(mixed.ran.has(id)).toBe(false);
    for (const id of ids()) expect([id, mixed.state[id]]).toEqual([id, browser.state[id]]);
    return server;
  }

  it('gives the admin the same numbers as the browser, for every calc', async () => {
    const server = await check(join(libs[which], 'data'), null);
    expect(Object.keys(server.rows).length).toBeGreaterThanOrEqual(which === 'demo' ? 45 : 30);
    // on the demo the server works out every calc; one that needed the viewer's filters or
    // the page would be left to the browser. With very little data (or with the diary
    // hidden) a few averages come out as NaN, which JSON can't carry: the page does those
    // calcs the page works out from a friend's data (dash.calcWith) are left to it
    if (which === 'demo') {
      const offPage = page.calcs.filter((c) => c.inputs.some((i) => i.startsWith('friend_')));
      expect([server.lossy, server.failed]).toEqual([[], []]);
      expect(server.client_only.sort()).toEqual([...new Set(offPage.map((c) => c.id))].sort());
    }
  });

  it('gives a filtered visitor the same numbers as the browser from their files', async () => {
    const data = join(libs[which], 'data');
    const books = JSON.parse(await readFile(join(data, 'books.json'), 'utf8')) as BookFacts[];
    const settings = toPrivacySettings({
      private_books: [books[0].id],
      private_mode: 'anonymise',
    });
    for (const policy of [PRESETS.taste, PRESETS.no_dates]) {
      const ctx = buildContext(policy, settings, books, '2026-10-01');
      await check(data, ctx);
    }
  });
});

describe('what the server leaves to the browser', () => {
  let web: string;
  beforeAll(async () => {
    web = join(tmp, 'web');
    await mkdir(join(web, 'vendor'), { recursive: true });
    await copyFile(join(WEB_DIR, 'vendor', 'd3.min.js'), join(web, 'vendor', 'd3.min.js'));
    await writeFile(
      join(web, 'index.html'),
      '<script src="vendor/d3.min.js"></script><script src="runtime.js"></script>' +
        '<script src="calcs.js"></script>',
    );
    await writeFile(
      join(web, 'calcs.js'),
      `
      dash.calc('count', { inputs: ['books'], fn: (b) => [{ n: b.length }] });
      dash.calc('filtered', { inputs: ['books'], fn: (b) => b.filter(() => !dash.params().x) });
      dash.calc('from_filtered', { inputs: ['filtered'], fn: (r) => [{ n: r.length }] });
      dash.calc('wide', { inputs: ['books'], fn: (b) => [{ w: document.body.clientWidth }] });
      dash.calc('dated', { inputs: ['books'], fn: () => [{ d: new Date(0) }] });
      dash.calc('from_dated', { inputs: ['dated'], fn: (r) => [{ n: r.length }] });
      dash.calc('broken', { inputs: ['books'], fn: () => { throw new Error('no'); } });
      dash.calc('from_broken', { inputs: ['broken'], fn: () => [] });
      dash.calc('needs_missing', { inputs: ['nope'], fn: () => [] });
      dash.calc('with_friend', { inputs: ['books', 'friend_books'], fn: () => [] });
      `,
    );
  });

  it('sends what it can and lists the rest', async () => {
    const p = await loadPageCalcs(web);
    const inputs: Inputs = new Map([
      ['books', [{ id: 'a' }]],
      ['reads', []],
      ['daily', []],
    ]);
    const r = computeStats(p, inputs);
    expect(Object.keys(r.rows).sort()).toEqual(['count', 'dated', 'from_dated']);
    expect(r.page.sort()).toEqual(['count', 'from_dated']);
    // a date is a string in JSON, so the page works that one out itself
    expect(r.lossy).toEqual(['dated']);
    expect(r.rows.dated).toEqual([{ d: '1970-01-01T00:00:00.000Z' }]);
    // the viewer's filters, the page, and anything worked out from them
    // and a friend's data, which only the page has
    expect(r.client_only.sort()).toEqual(['filtered', 'from_filtered', 'wide', 'with_friend']);
    expect(r.failed.sort()).toEqual(['broken', 'from_broken', 'needs_missing']);
  });

  it('only sends values that survive JSON', () => {
    expect(survivesJson([{ a: 1, b: 'x', c: null, d: [true], e: undefined }])).toBe(true);
    expect(survivesJson([{ a: NaN }])).toBe(false);
    expect(survivesJson([{ a: Infinity }])).toBe(false);
    expect(survivesJson([undefined])).toBe(false);
    expect(survivesJson([new Date()])).toBe(false);
    expect(survivesJson([new Map()])).toBe(false);
    expect(survivesJson([() => 1])).toBe(false);
  });

  it('leaves big quick lists for the page to work out', () => {
    expect(forPage(10_000, 0)).toBe(true);
    expect(forPage(200_000, 1)).toBe(false); // the diary: quicker to build than download
    expect(forPage(75_000, 25)).toBe(true); // the forecast: slow to build
  });
});
