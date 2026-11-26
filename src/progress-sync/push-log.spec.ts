/** Every push and layout leaves one line in update.log saying what came of it. */
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { KoreaderSyncService } from '../koreader-sync/koreader-sync.service';
import type { ActivityLogService } from '../library/activity-log.service';
import type { LibraryService } from '../library/library.service';
import { parseLayout } from './layout';
import { LayoutStore } from './layout-store';
import { fileNameDigest } from './moonplus-files';
import { ProgressStore } from './progress-store';
import { ProgressSyncService, type ProgressUpdate } from './progress-sync.service';

const PO = 'Apps/Books/.Moon+/Cache/Dune.epub.po';
const DOC = fileNameDigest('Dune.epub');
const MD5 = '0123456789abcdef0123456789abcdef';
// ten one-page files, so Moon+'s chapter n is spine item n + 1 and page n + 1
const xp = (page: number) => `/body/DocFragment[${page}]/body/p[1]/text().0`;
const LAYOUT = parseLayout({
  md5: MD5,
  file: 'Dune.epub',
  pages: Array.from({ length: 10 }, (_, i) => ({ xp: xp(i + 1), offset: 0, pct: (i + 1) / 10 })),
  lengths: Array.from({ length: 10 }, () => 3000),
});
const MOON = '1700000000000*5@0#1200:40.0%';

let root: string;
let service: ProgressSyncService;
let layouts: LayoutStore;
let lines: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pushlog-'));
  lines = [];
  const library = { root, dav: join(root, 'dav') } as unknown as LibraryService;
  layouts = new LayoutStore(library);
  service = new ProgressSyncService(
    new ProgressStore(library),
    library,
    { sidecars: async () => ({}), linkedFiles: async () => [] } as unknown as KoreaderSyncService,
    layouts,
    { log: (line: string) => lines.push(line) } as unknown as ActivityLogService,
  );
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function moonSyncs(text: string, rel = PO): Promise<void> {
  const path = join(root, 'dav', rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  const yesterday = new Date(Date.now() - 86_400_000);
  await utimes(path, yesterday, yesterday);
}
const push = (page: number, over: Partial<ProgressUpdate> = {}) =>
  service.push({
    document: DOC,
    progress: xp(page),
    percentage: page / 10,
    device: 'Kobo',
    device_id: 'K1',
    ...over,
  });
const last = () => lines.at(-1)!;

describe('a push', () => {
  beforeEach(() => layouts.put(LAYOUT));

  it('says what it wrote, from what to what', async () => {
    await moonSyncs(MOON);
    await push(8);
    expect(lines).toEqual([
      `Progress push ${DOC} from "Kobo" 80.0%, page 8/10: written ${PO}: ` +
        `"${MOON}" (Moon+'s) -> "1700000000000*7@0#0:80.0%"`,
    ]);
    await push(9);
    expect(last()).toContain(`"1700000000000*7@0#0:80.0%" (the dashboard's) -> `);
  });

  it('says when it starts a file', async () => {
    await moonSyncs(MOON, 'Apps/Books/.Moon+/Cache/Emma.epub.po');
    await push(3);
    expect(last()).toContain(`written ${PO}: (new file) -> "1700000000000*2@0#0:30.0%"`);
  });

  it.each<[string, () => Promise<unknown>, string]>([
    [
      'a repeat',
      async () => {
        await push(8);
        await push(8);
      },
      'not written: repeat of the same place',
    ],
    ['a paged book', () => push(3, { progress: '42' }), 'not written: paged book'],
    ['another format', () => push(3, { progress: '/FictionBook' }), 'not an EPUB position'],
    ['no .po at all', () => push(3), 'no .po path (Moon+ has synced no .po yet)'],
    [
      'an unreadable .po',
      async () => {
        await moonSyncs('some\nthing else');
        await push(3);
      },
      `not written: unreadable .po ${PO} "some thing else"`,
    ],
    [
      "Moon+'s page",
      async () => {
        await moonSyncs(MOON);
        await push(6);
      },
      `not written: same place as Moon+ in ${PO} "${MOON}"`,
    ],
    [
      'behind Moon+',
      async () => {
        await moonSyncs(MOON);
        await push(2);
      },
      `not written: behind Moon+ and not offered, ${PO} "${MOON}"`,
    ],
    [
      'already there',
      async () => {
        await push(8, { filename: 'Dune.epub' });
        await moonSyncs(MOON, 'x.po');
        await push(8, { percentage: 0.8001 });
        await push(8, { percentage: 0.8002 });
      },
      `not written: already there, Dune.epub.po`,
    ],
    [
      'a failure',
      async () => {
        await moonSyncs(MOON, 'Apps/Books/.Moon+/Cache/Emma.epub.po');
        await mkdir(join(root, 'dav', `${PO}.dash.part`), { recursive: true });
        await push(3);
      },
      ': error: ',
    ],
  ])('says why nothing was written: %s', async (_, act, outcome) => {
    await act();
    expect(last()).toContain(outcome);
  });

  it('says when there is no layout to compare with', async () => {
    await rm(join(root, 'progress-sync'), { recursive: true });
    await moonSyncs(MOON);
    await push(8);
    expect(last()).toBe(
      `Progress push ${DOC} from "Kobo" 80.0%: not written: ` +
        `no layout to compare with Moon+'s ${PO} "${MOON}"`,
    );
  });

  it('keeps a device name to its own line', async () => {
    await push(3, { device: 'Kobo\nProgress push forged' });
    expect(lines).toHaveLength(1);
    expect(last()).not.toContain('\n');
  });
});

describe('a layout', () => {
  const arrive = async () => {
    await layouts.put(LAYOUT);
    await service.layoutArrived(LAYOUT);
  };

  it('says it arrived, and what it then wrote', async () => {
    await arrive();
    expect(last()).toBe(
      `Progress layout ${MD5} "Dune.epub": 10 pages received; no KOReader position to write`,
    );
    await rm(join(root, 'progress-sync'), { recursive: true });
    await moonSyncs(MOON);
    await push(8);
    await arrive();
    expect(last()).toContain(`10 pages received; last push written ${PO}: "${MOON}"`);
  });

  it('says when the last push stays behind', async () => {
    await layouts.put(LAYOUT);
    await moonSyncs(MOON);
    await push(2);
    await arrive();
    expect(last()).toContain('not written: the last push is behind Moon+');
  });
});
