/** Latest wins, echoes and where .po files are written, against a real library folder. */
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { KoreaderSyncService } from '../koreader-sync/koreader-sync.service';
import type { LibraryService } from '../library/library.service';
import { parseLayout } from './layout';
import { LayoutStore } from './layout-store';
import { fileNameDigest } from './moonplus-files';
import { ProgressStore } from './progress-store';
import { parseUpdate, ProgressSyncService, type ProgressUpdate } from './progress-sync.service';

const CACHE = 'Apps/Books/.Moon+/Cache';
const PO = `${CACHE}/Dune.epub.po`;
const DOC = fileNameDigest('Dune.epub');
const PARTIAL = '0123456789abcdef0123456789abcdef';
const page = (fragment: number, p: number) =>
  `/body/DocFragment[${fragment}]/body/p[${p}]/text().0`;
const PAGES = [
  { xp: page(1, 1), offset: 0, pct: 0.1 },
  { xp: page(2, 1), offset: 0, pct: 0.2 },
  { xp: page(2, 9), offset: 1500, pct: 0.3 },
  { xp: page(2, 20), offset: 3100, pct: 0.4 },
  { xp: page(3, 1), offset: 0, pct: 0.6 },
];

let root: string;
let service: ProgressSyncService;
let layouts: LayoutStore;
let sidecars: Record<string, { md5: string; file?: string; title?: string }>;
let linked: Record<string, string[]>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'progress-'));
  sidecars = {};
  linked = {};
  const library = { root, dav: join(root, 'dav') } as unknown as LibraryService;
  layouts = new LayoutStore(library);
  const koreader = {
    sidecars: async () => sidecars,
    linkedFiles: async (md5: string) => linked[md5] ?? [],
  } as unknown as KoreaderSyncService;
  service = new ProgressSyncService(new ProgressStore(library), library, koreader, layouts);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const dav = (rel: string) => join(root, 'dav', rel);
const read = (rel: string) => readFile(dav(rel), 'utf8');

/** A .po as Moon+ syncs it, arriving `ago` ms before now (negative: just after). */
async function moonSyncs(text: string, ago = 0, rel = PO): Promise<void> {
  await mkdir(dirname(dav(rel)), { recursive: true });
  await writeFile(dav(rel), text);
  const when = new Date(Date.now() - ago);
  await utimes(dav(rel), when, when);
}
/** Moon+ syncing a moment after whatever came before. */
const moonSyncsLater = (text: string, rel = PO) => moonSyncs(text, -2000, rel);

const push = (progress: string, percentage: number, over: Partial<ProgressUpdate> = {}) =>
  service.push({ document: DOC, progress, percentage, device: 'Kobo', device_id: 'K1', ...over });

const measure = () => layouts.put(parseLayout({ md5: PARTIAL, file: 'Dune.epub', pages: PAGES }));

const pulled = async (document = DOC) => (await service.pull(document))?.progress;

describe('latest wins', () => {
  beforeEach(async () => {
    await measure();
    await moonSyncs('1700000000000*0@0#0:10.0%', 60_000);
  });

  it("goes by when each arrived, not by Moon+'s stamp, which can be months stale", async () => {
    await push(page(2, 1), 0.2);
    expect(await pulled()).toBe(page(2, 1));
    await moonSyncsLater('1600000000000*2@0#0:60.0%');
    expect(await pulled()).toBe(page(3, 1));
  });

  it('ignores a device pushing the same place again, which it does on every close', async () => {
    await push(page(2, 1), 0.2);
    await moonSyncsLater('1700000000000*2@0#0:60.0%');
    await push(page(2, 1), 0.2); // opened and closed without turning a page
    expect(await pulled()).toBe(page(3, 1));
    expect(await read(PO)).toBe('1700000000000*2@0#0:60.0%');
  });

  it('still ignores it after another device has pushed', async () => {
    await push(page(2, 1), 0.2);
    await push(page(3, 1), 0.6, { device: 'Kindle', device_id: 'K2' });
    await push(page(2, 1), 0.2);
    expect(await pulled()).toBe(page(3, 1));
  });

  it('takes a real move back from the same device', async () => {
    await push(page(2, 9), 0.3);
    await push(page(2, 1), 0.2);
    expect(await pulled()).toBe(page(2, 1));
    expect(await read(PO)).toMatch(/\*1@0#0:20\.0%$/);
  });
});

describe('echoes', () => {
  beforeEach(measure);

  it("doesn't take its own .po for Moon+'s, even restamped or an earlier one sent back", async () => {
    await moonSyncs('1700000000000*0@0#0:10.0%', 60_000);
    await push(page(2, 9), 0.3);
    const first = await read(PO);
    await push(page(2, 20), 0.4);
    for (const text of [first, first.replace(/^\d+/, '1800000000000')]) {
      await moonSyncsLater(text);
      expect(await service.moonFor(DOC)).toBeNull();
      expect(await pulled()).toBe(page(2, 20));
    }
  });

  it("keeps Moon+'s own place when KOReader only went where Moon+ is", async () => {
    // Moon+ is part-way down the page that starts 1500 characters in
    const moon = '1700000000000*1@0#2000:31.0%';
    await moonSyncs(moon);
    expect(await pulled()).toBe(page(2, 9));
    await push(page(2, 9), 0.3); // KOReader jumped there and closed
    expect(await read(PO)).toBe(moon);
    await push(page(2, 20), 0.4); // then read on
    expect(await read(PO)).toMatch(/\*1@0#3100:40\.0%$/);
  });

  it("without a layout, never drags Moon+ back to the start of the chapter it's in", async () => {
    await rm(join(root, 'progress-sync'), { recursive: true });
    const moon = '1700000000000*4@0#9000:55.0%';
    await moonSyncs(moon, 60_000);
    await push('/body/DocFragment[5]', 0.5);
    expect(await read(PO)).toBe(moon);
    await push('/body/DocFragment[6]', 0.6);
    expect(await read(PO)).toMatch(/\*5@0#0:60\.0%$/);
  });
});

describe('writing for Moon+', () => {
  beforeEach(measure);

  it('writes the exact paragraph, with a new ETag and a later Last-Modified', async () => {
    await moonSyncs('1700000000000*0@0#0:10.0%');
    const before = await stat(dav(PO));
    await push('/body/DocFragment[2]/body/p[9]/text().57', 0.3);
    expect(await read(PO)).toMatch(/^\d{13}\*1@0#1557:30\.0%$/);
    const after = await stat(dav(PO));
    expect(Math.floor(after.mtimeMs / 1000)).toBeGreaterThan(Math.floor(before.mtimeMs / 1000));
  });

  it("carries on from an earlier version's record of what it wrote", async () => {
    await mkdir(join(root, 'progress-sync'), { recursive: true });
    await writeFile(
      join(root, 'progress-sync', 'moonplus-written.json'),
      JSON.stringify({ [PO]: { chapter: 1, offset: 0 } }),
    );
    await moonSyncs('1700000000000*0@0#0:10.0%', 60_000);
    await push(page(2, 9), 0.3);
    expect(await read(PO)).toMatch(/\*1@0#1500:30\.0%$/);
  });

  it('leaves alone a .po it cannot read', async () => {
    await moonSyncs('something else', 60_000);
    await push(page(2, 9), 0.3);
    expect(await read(PO)).toBe('something else');
  });

  it("starts a new one in Moon+'s cache folder, named from KOReader's metadata", async () => {
    await moonSyncs('1*0@0#0:1%', 0, 'other/a.epub.po');
    await moonSyncs('1*0@0#0:1%', 0, 'other/b.epub.po');
    await moonSyncs('1*0@0#0:1%', 0, `${CACHE}/c.epub.po`);
    await push(page(2, 9), 0.3, { document: 'f'.repeat(32), filename: 'Emma.epub' });
    expect(await read(`${CACHE}/Emma.epub.po`)).toMatch(/\*1@0#0:30\.0%$/);
  });

  it('finds the .po of the book the file is linked to', async () => {
    sidecars[PARTIAL] = { md5: PARTIAL, file: 'dune_kobo.epub' };
    linked[PARTIAL] = ['Dune - Frank Herbert.epub'];
    const rel = `${CACHE}/Dune - Frank Herbert.epub.po`;
    await moonSyncs('1700000000000*2@0#0:60.0%', 60_000, rel);
    expect(await pulled(PARTIAL)).toBe(page(3, 1));
    await push(page(2, 9), 0.3, { document: PARTIAL });
    expect(await read(rel)).toMatch(/\*1@0#1500:30\.0%$/);
  });

  it('never writes over a file matched by title alone', async () => {
    sidecars[PARTIAL] = { md5: PARTIAL, file: 'dune_kobo.epub', title: 'Dune' };
    const rel = `${CACHE}/Dune - Frank Herbert.epub.po`;
    const moon = '1700000000000*2@0#0:60.0%';
    await moonSyncs(moon, 60_000, rel);
    expect(await pulled(PARTIAL)).toBe(page(3, 1));
    await push(page(2, 9), 0.3, { document: PARTIAL });
    expect(await read(rel)).toBe(moon);
    expect(await read(`${CACHE}/dune_kobo.epub.po`)).toMatch(/30\.0%$/);
  });
});

describe("Moon+'s chapters and stamp", () => {
  // a cover and a title page the contents don't list, then two chapters of ten pages
  const sizes = [1, 1, 10, 10];
  const at = (fragment: number, p: number) => page(fragment, p + 1);
  let n = 0;
  const novel = parseLayout({
    md5: PARTIAL,
    file: 'Dune.epub',
    pages: sizes.flatMap((size, f) =>
      Array.from({ length: size }, (_, p) => ({
        xp: at(f + 1, p),
        offset: p * 1000,
        pct: ++n / 22,
      })),
    ),
    toc: [
      { fragment: 3, offset: 0 },
      { fragment: 4, offset: 0 },
    ],
    lengths: [1000, 1000, 10000],
  });
  const early = '1700000000000*0@0#0:1.0%';

  it("writes the contents' chapter and keeps Moon+'s first number", async () => {
    await layouts.put(novel);
    await moonSyncs(early, 60_000);
    await push(at(3, 4), 7 / 22);
    expect(await read(PO)).toBe('1700000000000*1@0#4000:31.8%');
  });

  it('writes the spine item once a Moon+ position showed this book goes by the spine', async () => {
    await layouts.put(novel);
    await moonSyncs('1700000000000*3@0#4000:74.0%', 60_000);
    await push(at(3, 4), 7 / 22);
    expect(await read(PO)).toBe('1700000000000*2@0#4000:31.8%');
  });

  it("gives a new file the first number Moon+'s others have", async () => {
    await layouts.put(novel);
    await moonSyncs(early, 0, `${CACHE}/other.epub.po`);
    await push(at(3, 4), 7 / 22);
    expect(await read(PO)).toBe('1700000000000*1@0#4000:31.8%');
  });

  it('rewrites the position when the layout arrives after it', async () => {
    await moonSyncs(early, 60_000);
    await push(at(3, 4), 7 / 22);
    expect(await read(PO)).toBe('1700000000000*2@0#0:31.8%');
    await layouts.put(novel);
    await service.layoutArrived(novel);
    expect(await read(PO)).toBe('1700000000000*1@0#4000:31.8%');
  });

  it('leaves a position Moon+ saved since', async () => {
    await moonSyncs(early, 60_000);
    await push(at(3, 4), 7 / 22);
    const moon = '1700000000000*2@0#100:60.0%';
    await moonSyncsLater(moon);
    await layouts.put(novel);
    await service.layoutArrived(novel);
    expect(await read(PO)).toBe(moon);
  });
});

describe('what KOReader sends', () => {
  it('takes metadata for the file name and title', () => {
    expect(
      parseUpdate({
        document: 'abc',
        progress: '/body',
        percentage: 0.5,
        device: 'K',
        device_id: 'x',
        metadata: { filename: 'Dune.epub', title: 'Dune', authors: 'Frank Herbert' },
      }),
    ).toMatchObject({ filename: 'Dune.epub', title: 'Dune' });
  });

  it('is not confused by a document named like an object property', async () => {
    expect(await service.pull('constructor')).toBeNull();
    await push(page(1, 1), 0.1, { document: '__proto__' });
    expect(await service.pull('constructor')).toBeNull();
  });
});
