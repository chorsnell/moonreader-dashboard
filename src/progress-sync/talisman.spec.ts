/**
 * Real device, The Talisman: Moon+ wrote chapter 58, 23806 characters in, "45.8%". The
 * sentence is on KOReader's page 1277 of 1380 (92.5%): the percentage is badly wrong.
 */
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { KoreaderSyncService } from '../koreader-sync/koreader-sync.service';
import type { ActivityLogService } from '../library/activity-log.service';
import type { LibraryService } from '../library/library.service';
import { isBehind, locate, parseLayout } from './layout';
import { LayoutStore } from './layout-store';
import { ProgressStore } from './progress-store';
import { ProgressSyncService } from './progress-sync.service';

const MD5 = '0123456789abcdef0123456789abcdef';
const FILE = 'The Talisman -- Stephen King -- Anna’s Archive.epub';
const MOON = '1774048356902*58@0#23806:45.8%';
const PO = `Apps/Books/.Moon+/Cache/${FILE}.po`;
const PAGE_CHARS = 1500;

// Four one-page front-matter files the contents don't list, then a file for each entry:
// 57 before chapter 58, which starts on page 1262 (91.4%).
const sizes = [1, 1, 1, 1, ...Array.from({ length: 57 }, (_, i) => (i < 56 ? 22 : 25)), 40, 40, 39];
const PAGES = sizes.reduce((s, n) => s + n, 0);
const xp = (fragment: number, p: number) =>
  `/body/DocFragment[${fragment}]/body/p[${p + 1}]/text().0`;
let n = 0;
const pages = sizes.flatMap((size, f) =>
  Array.from({ length: size }, (_, p) => ({
    xp: xp(f + 1, p),
    offset: p * PAGE_CHARS,
    pct: ++n / PAGES,
  })),
);
const layout = parseLayout({
  md5: MD5,
  file: FILE,
  pages,
  toc: sizes.slice(4).map((_, i) => ({ fragment: i + 5, offset: 0 })),
  lengths: sizes.map((size) => size * PAGE_CHARS),
});
const moon = { time: 1, chapter: 58, split: 0, offset: 23806, percent: 45.8 };
/** KOReader's page `p` (from 1) as it syncs it. */
const kobo = (p: number) => ({
  progress: pages[p - 1].xp,
  percentage: Math.floor((p / PAGES) * 10000) / 10000,
});

describe('locating a position whose percentage is wrong', () => {
  it('is the book the user has', () => {
    expect(PAGES).toBe(1380);
  });

  it('goes by chapter and character, and gives the page its own percentage', () => {
    expect(locate(layout, moon)).toMatchObject({
      page: 1276,
      pct: 1277 / 1380,
      method: 'exact',
      mapping: 'toc',
    });
  });

  it('defaults to the contents when both readings hold it and the percentage fits neither', () => {
    // the spine counts the front matter, so its chapter 58 is four files' entries earlier
    const there = locate(layout, moon)!;
    expect(there.readings.spine).toBeLessThan(there.readings.toc!);
    expect(there.furthest).toBe(there.readings.toc);
    expect(there.decisive).toBe(false);
    // a remembered reading stands
    expect(locate(layout, moon, 'spine')!.page).toBe(there.readings.spine);
  });

  it('counts a place at 50% as behind it, whatever Moon+ says the percentage is', () => {
    const behind = (p: number) => isBehind(layout, moon, kobo(p).progress, kobo(p).percentage);
    expect(behind(690)).toBe(true);
    expect(behind(1276)).toBe(true);
    expect(behind(1300)).toBe(false);
  });
});

describe('syncing it', () => {
  let root: string;
  let service: ProgressSyncService;
  let layouts: LayoutStore;
  let log: jest.Mock;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'talisman-'));
    const library = { root, dav: join(root, 'dav') } as unknown as LibraryService;
    layouts = new LayoutStore(library);
    log = jest.fn();
    service = new ProgressSyncService(
      new ProgressStore(library),
      library,
      { sidecars: async () => ({}), linkedFiles: async () => [] } as unknown as KoreaderSyncService,
      layouts,
      { log } as unknown as ActivityLogService,
    );
    await mkdir(dirname(po()), { recursive: true });
    await writeFile(po(), MOON);
    const yesterday = new Date(Date.now() - 86_400_000);
    await utimes(po(), yesterday, yesterday);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const po = () => join(root, 'dav', PO);
  const text = () => readFile(po(), 'utf8');
  const push = (page: number) =>
    service.push({
      document: MD5,
      ...kobo(page),
      device: 'Kobo',
      device_id: 'K1',
      filename: FILE,
    });
  const measured = async () => {
    await layouts.put(layout);
    await service.layoutArrived(layout);
  };
  const offer = { device: 'Moon+ Reader', progress: pages[1276].xp, percentage: 1277 / 1380 };

  it('offers page 1277 at 92.5%, and says how it got there', async () => {
    await layouts.put(layout); // which also says what the file is called
    expect(await service.pull(MD5)).toMatchObject(offer);
    expect(log).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /Moon\+ 58@0#23806:45\.8%, layout yes, toc exact -> page 1277\/1380 \(92\.5%\) \[toc 1277\/1380, spine \d+\/1380\]; gave Moon\+'s/,
      ),
    );
  });

  it('keeps Moon+ when the Kobo, halfway through, was never offered its place', async () => {
    await layouts.put(layout);
    await push(690);
    expect(await text()).toBe(MOON);
    expect(await service.pull(MD5)).toMatchObject(offer);
  });

  it('lets the Kobo take Moon+ back once it has been offered and declined', async () => {
    await layouts.put(layout);
    await push(690);
    await service.pull(MD5);
    await push(691);
    expect(await text()).toMatch(/\*32@0#\d+:50\.1%$/);
  });

  it("doesn't count an offer made by the earlier, percentage-led version", async () => {
    await layouts.put(layout);
    await mkdir(join(root, 'progress-sync'), { recursive: true });
    await writeFile(
      join(root, 'progress-sync', 'moonplus-served.json'),
      JSON.stringify({
        [MD5]: {
          key: PO,
          place: { chapter: 58, split: 0, offset: 23806, percent: 45.8 },
          mtimeMs: Date.now(),
        },
      }),
    );
    await push(690);
    expect(await text()).toBe(MOON);
  });

  it('without a layout neither offers a guess nor writes over Moon+', async () => {
    await push(690); // past Moon+'s "45.8%"
    expect(await text()).toBe(MOON);
    expect(await service.pull(MD5)).toMatchObject({ device: 'Kobo' });
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('no layout'));
    // the layout is all it takes
    await measured();
    expect(await text()).toBe(MOON);
    expect(await service.pull(MD5)).toMatchObject(offer);
  });

  it('writes a position that proves to be ahead once the layout is there to compare', async () => {
    await push(1300);
    expect(await text()).toBe(MOON);
    await measured();
    expect(await text()).toBe('1774048356902*58@0#57000:94.2%');
    expect(await service.pull(MD5)).toMatchObject({ device: 'Kobo' });
  });
});
