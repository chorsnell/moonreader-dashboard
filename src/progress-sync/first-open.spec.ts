/** QA (#128): a first Kobo push must not overwrite a newer Moon+ position. */
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { KoreaderSyncService } from '../koreader-sync/koreader-sync.service';
import type { ActivityLogService } from '../library/activity-log.service';
import type { LibraryService } from '../library/library.service';
import { parseLayout } from './layout';
import { LayoutStore } from './layout-store';
import { ProgressStore } from './progress-store';
import { ProgressSyncService } from './progress-sync.service';

const PO = 'Apps/Books/.Moon+/Cache/Dune.epub.po';
const PARTIAL = '0123456789abcdef0123456789abcdef';
const MOON = '1700000000000*5@0#1200:40.0%';
let root: string;
let service: ProgressSyncService;
let path: string;
let layouts: LayoutStore;
// the plugin's layout, which says where chapter 5 is
const LAYOUT = parseLayout({
  md5: PARTIAL,
  file: 'Dune.epub',
  pages: Array.from({ length: 10 }, (_, f) => ({
    xp: `/body/DocFragment[${f + 1}]/body/p[1]/text().0`,
    offset: 0,
    pct: (f + 1) / 10,
  })),
  lengths: Array.from({ length: 10 }, () => 3000),
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'qa128-'));
  const library = { root, dav: join(root, 'dav') } as unknown as LibraryService;
  const koreader = {
    sidecars: async () => ({}),
    linkedFiles: async () => [],
  } as unknown as KoreaderSyncService;
  service = new ProgressSyncService(
    new ProgressStore(library),
    library,
    koreader,
    (layouts = new LayoutStore(library)),
    { log: () => undefined } as unknown as ActivityLogService,
  );
  path = join(root, 'dav', PO);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, MOON);
  const yesterday = new Date(Date.now() - 86_400_000);
  await utimes(path, yesterday, yesterday);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const push = (fragment: number, percentage: number) =>
  service.push({
    document: PARTIAL,
    progress: `/body/DocFragment[${fragment}]/body/p[1]/text().0`,
    percentage,
    device: 'Kobo',
    device_id: 'K1',
    filename: 'Dune.epub',
  });

it('first open on the Kobo does not overwrite Moon+ 40%', async () => {
  expect(await service.pull(PARTIAL)).toBeNull();
  await push(1, 0.001);
  expect(await readFile(path, 'utf8')).toBe(MOON);
  await layouts.put(LAYOUT);
  // and now that the file is known, KOReader is offered Moon+'s place
  expect(await service.pull(PARTIAL)).toMatchObject({ device: 'Moon+ Reader', percentage: 0.6 }); // KOReader's own for chapter 5's page
});

it('writes the earlier place once the Kobo was offered 40% and read on instead', async () => {
  await layouts.put(LAYOUT);
  await push(1, 0.001);
  await service.pull(PARTIAL);
  await push(2, 0.2);
  expect(await readFile(path, 'utf8')).toMatch(/\*1@0#0:20\.0%$/);
});
