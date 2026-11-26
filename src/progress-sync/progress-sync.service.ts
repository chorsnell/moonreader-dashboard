import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { findFiles, mtimeMs } from '../common/files';
import { oneLine } from '../common/log-text';
import { KoreaderSyncService } from '../koreader-sync/koreader-sync.service';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import {
  furtherInChapter,
  isBehind,
  type Layout,
  type Located,
  locate,
  type Mapping,
  moonPlace,
  pageOf,
  samePlace,
} from './layout';
import { LayoutStore } from './layout-store';
import {
  type DocumentHint,
  fileNameDigest,
  isReflowable,
  ownPoFile,
  type PoFile,
  poForDocument,
} from './moonplus-files';
import {
  chapterOfFragment,
  formatMoonPosition,
  type MoonPosition,
  moonStamp,
  parseMoonPosition,
  toPercent,
  xpointerFragment,
} from './positions';
import { type Held, type KosyncProgress, ProgressStore, type Sent } from './progress-store';
import { isWritten, placeOf, writtenKey } from './written';

/** What a device sends with PUT /syncs/progress. */
export interface ProgressUpdate {
  document: string;
  progress: string;
  percentage: number;
  device: string;
  device_id: string;
  /** From KOReader's "Send document metadata". */
  filename?: string;
  title?: string;
}

export class ProgressSyncError extends Error {}

const MAX_TEXT = 512;
/** Deeply nested books have long xpointers. */
const MAX_XPOINTER = 4096;
/** Devices remembered per document, to spot a repeated push. */
const MAX_DEVICES = 10;
/** A position is a few dozen characters. */
const PO_READ_LIMIT = 4096;
/** How positions from Moon+ are labelled on KOReader's "sync to device…?" prompt. */
export const MOONPLUS_DEVICE = 'Moon+ Reader';
export const MOONPLUS_DEVICE_ID = 'moonplus';

/** Checks a PUT body the way koreader-sync-server does, or throws ProgressSyncError. */
export function parseUpdate(body: unknown): ProgressUpdate {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = (v: unknown, max = MAX_TEXT) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';
  const document = text(b.document);
  if (!document || !/^[\w.:-]+$/.test(document)) {
    throw new ProgressSyncError('Field "document" not provided.');
  }
  const progress =
    typeof b.progress === 'number' ? String(b.progress) : text(b.progress, MAX_XPOINTER);
  const percentage = typeof b.percentage === 'string' ? Number(b.percentage) : b.percentage;
  if (!progress || typeof percentage !== 'number' || !Number.isFinite(percentage)) {
    throw new ProgressSyncError('Fields "progress" and "percentage" are required.');
  }
  const meta = (b.metadata && typeof b.metadata === 'object' ? b.metadata : {}) as Record<
    string,
    unknown
  >;
  const filename = text(meta.filename);
  const title = text(meta.title);
  return {
    document,
    progress,
    percentage: Math.min(1, Math.max(0, percentage)),
    device: text(b.device),
    device_id: text(b.device_id),
    ...(filename ? { filename } : {}),
    ...(title ? { title } : {}),
  };
}

/**
 * A Moon+ position as KOSync progress: the page it's on and, since KOReader decides forward
 * from backward by it, KOReader's own percentage for that page, not Moon+'s. `arrivedMs` is
 * when the .po file reached the server.
 */
export function moonToKosync(there: Located, arrivedMs: number): KosyncProgress {
  return {
    progress: there.xp,
    percentage: there.pct,
    device: MOONPLUS_DEVICE,
    device_id: MOONPLUS_DEVICE_ID,
    timestamp: Math.floor(arrivedMs / 1000),
  };
}

/** A line for update.log saying what a pull made of Moon+'s position. */
function describe(moon: MoonPosition, layout: Layout | null, there: Located | null): string {
  const at = `Moon+ ${moon.chapter}@${moon.split}#${moon.offset}:${moon.percent}%`;
  if (!layout || !there) return `${at}, no layout`;
  const page = (i: number) => `${i + 1}/${layout.pages.length}`;
  const readings = Object.entries(there.readings).map(([m, i]) => `${m} ${page(i)}`);
  return (
    `${at}, layout yes, ${there.mapping ?? 'no mapping'} ${there.method} -> page ` +
    `${page(there.page)} (${(there.pct * 100).toFixed(1)}%)` +
    (readings.length ? ` [${readings.join(', ')}]` : '')
  );
}

/** What writing a position for Moon+ came to: why Moon+'s was kept, and a line for the log. */
interface WriteResult {
  held?: Held;
  note: string;
}

const failure = (e: unknown) =>
  `error: ${oneLine(e instanceof Error ? e.message : String(e), 300)}`;

/** Whether a KOSync position is a page number (PDFs, comics) rather than an xpointer. */
const isPageNumber = (progress: string) => /^\d+$/.test(progress.trim());

/**
 * A KOReader position as Moon+'s, with KOReader's percentage. The chapter, split and
 * characters in come from the book's layout, when the plugin sent one; without it, the start
 * of the chapter its spine item is.
 */
export function kosyncToMoon(
  progress: string,
  percentage: number,
  nowMs: number,
  layout: Layout | null = null,
  mapping: Mapping | null = null,
): MoonPosition | null {
  const fragment = xpointerFragment(progress);
  if (fragment === null) return null;
  const place = (layout && moonPlace(layout, progress, percentage, mapping)) ?? {
    chapter: chapterOfFragment(fragment),
    split: 0,
    offset: 0,
  };
  return { time: nowMs, ...place, percent: toPercent(percentage) };
}

/**
 * Reading positions for KOReader's progress sync (KOSync). What KOReader devices send is kept
 * as it came. A device asking for a book gets the newest position from KOReader or from the
 * .po file Moon+ synced for it over WebDAV, whichever reached the server last. KOReader's
 * positions are written back into that .po file, so Moon+ opens the book there; but only
 * take Moon+ backwards once a device has been offered where Moon+ was. All of it needs the
 * book's page layout: without one, Moon+'s position is neither offered nor written over.
 */
@Injectable()
export class ProgressSyncService {
  private readonly log = new Logger(ProgressSyncService.name);
  /** One push at a time, so two can't cross between a .po file and what's remembered of it. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: ProgressStore,
    private readonly library: LibraryService,
    private readonly koreader: KoreaderSyncService,
    private readonly layouts: LayoutStore,
    private readonly activity: ActivityLogService,
  ) {}

  /** Saves a device's position. Returns the server's timestamp for it, in seconds. */
  push(update: ProgressUpdate): Promise<number> {
    return this.inTurn(() => this.pushNow(update));
  }

  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Writes the book's latest KOReader position again, now that its layout says where that is.
   * A book first opened offline pushes before its layout arrives, which leaves Moon+ at the
   * start of the chapter. Not when Moon+ has moved since.
   */
  layoutArrived(layout: Layout): Promise<void> {
    const documents = [layout.md5, ...(layout.file ? [fileNameDigest(layout.file)] : [])];
    return this.inTurn(async () => {
      const stored = (await Promise.all(documents.map((d) => this.store.get(d))))
        .flatMap((p, i) => (p ? [{ ...p, document: documents[i] }] : []))
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
      const say = (what: string) =>
        this.activity.log(
          `Progress layout ${layout.md5} "${oneLine(layout.file ?? '')}": ` +
            `${layout.pages.length} pages received; ${what}`,
        );
      if (!stored) return say('no KOReader position to write');
      // one found behind Moon+ is not to be written, even now Moon+'s has been offered since
      if (stored.held && stored.held !== 'unmeasured') {
        return say('not written: the last push is behind Moon+ and was not offered');
      }
      try {
        const since = stored.at ?? stored.timestamp * 1000;
        const { held, note } = await this.writeForMoonplus(stored, since);
        say(`last push ${note}`);
        if (stored.held) {
          // measured now: either written (or not needed), or behind
          const { document, held: _, ...record } = stored;
          await this.store.put(document, { ...record, ...(held ? { held } : {}) });
        }
      } catch (e) {
        say(failure(e));
        this.log.warn(`Couldn't write the Moon+ position for ${stored.document}: ${String(e)}`);
      }
    });
  }

  private async pushNow(update: ProgressUpdate): Promise<number> {
    const { document, ...rest } = update;
    const stored = await this.store.get(document);
    const device = update.device_id || update.device;
    const last = stored?.sent?.find((s) => s.device_id === device);
    const say = await this.pushLine(update);
    // KOReader pushes on closing a book and going to sleep whether or not you've moved. The
    // same place from the same device is not news, and mustn't beat what was read since.
    if (last && last.progress === update.progress && last.percentage === update.percentage) {
      say('not written: repeat of the same place');
      return stored!.timestamp;
    }
    const at = Date.now();
    const timestamp = Math.floor(at / 1000);
    const others = (stored?.sent ?? []).filter((s) => s.device_id !== device);
    const position: KosyncProgress = {
      // metadata only comes while the setting is on; what was learnt still holds
      ...(stored?.filename ? { filename: stored.filename } : {}),
      ...(stored?.title ? { title: stored.title } : {}),
      ...rest,
      timestamp,
      at,
      sent: others,
    };
    await this.store.put(document, position);
    const sent: Sent = {
      device_id: device,
      progress: update.progress,
      percentage: update.percentage,
    };
    try {
      const { held, note } = await this.writeForMoonplus(update);
      say(note);
      // only now, so a failed write is tried again when the device repeats itself
      await this.store.put(document, {
        ...position,
        ...(held ? { held } : {}),
        sent: [...others, sent].slice(-MAX_DEVICES),
      });
    } catch (e) {
      // KOReader's position is saved; Moon+ just doesn't get this one
      say(failure(e));
      this.log.warn(`Couldn't write the Moon+ position for ${document}: ${String(e)}`);
    }
    return timestamp;
  }

  /** Starts a push's line for update.log; the returned function ends it with the outcome. */
  private async pushLine(update: ProgressUpdate): Promise<(outcome: string) => void> {
    let on = '';
    try {
      const layout = await this.layouts.get(update.document);
      const page = layout && pageOf(layout, update.progress, update.percentage);
      if (typeof page === 'number') on = `, page ${page + 1}/${layout!.pages.length}`;
    } catch {
      // a line without the page is better than a push that fails for its log
    }
    const at =
      `Progress push ${update.document} from "${oneLine(update.device, 60)}" ` +
      `${(update.percentage * 100).toFixed(1)}%${on}`;
    return (outcome) => this.activity.log(`${at}: ${outcome}`);
  }

  /** How Moon+'s chapters fit the book, learning from one of its positions if given. */
  private async mappingFor(
    layout: Layout | null,
    moon: MoonPosition | null = null,
  ): Promise<Mapping | null> {
    if (!layout) return null;
    const known = await this.store.mapping(layout.md5);
    const found = moon && locate(layout, moon, known);
    if (!found?.decisive || !found.mapping || found.mapping === known) return known;
    await this.store.fitted(layout.md5, found.mapping);
    return found.mapping;
  }

  /**
   * Writes a KOReader position into the book's .po file: the one Moon+ synced, or a new one
   * named after the device's file, next to Moon+'s other .po files. With `since`, a Moon+
   * position that arrived after it is left alone. The result says what happened, and `held`
   * why Moon+'s own position was kept for the next pull to offer: the new one is behind it, or
   * can't be compared with it.
   */
  private async writeForMoonplus(
    update: Pick<ProgressUpdate, 'document' | 'progress' | 'percentage'>,
    since: number | null = null,
  ): Promise<WriteResult> {
    const kept = (why: string, held?: Held): WriteResult => ({
      note: `not written: ${why}`,
      ...(held ? { held } : {}),
    });
    if (isPageNumber(update.progress)) return kept('paged book');
    if (xpointerFragment(update.progress) === null) return kept('not an EPUB position');
    const layout = await this.layouts.get(update.document);
    const files = await this.poFiles();
    const hint = await this.hint(update.document);
    const existing = ownPoFile(update.document, hint, files);
    const path = existing?.path ?? newPoPath(hint.file ?? null, files);
    if (!path) {
      const why = !hint.file
        ? 'the file name is unknown'
        : !files.length
          ? 'Moon+ has synced no .po yet'
          : `none for "${oneLine(hint.file)}"`;
      return kept(`no .po path (${why})`);
    }
    const key = writtenKey(this.library.dav, path);
    const before = await stat(path).catch(() => null);
    const text = before ? (await readFile(path, 'utf8')).slice(0, PO_READ_LIMIT) : '';
    const found = parseMoonPosition(text);
    const old = `"${oneLine(text)}"`;
    // something that isn't a position we understand is left alone
    if (!found && text.trim()) return kept(`unreadable .po ${key} ${old}`);
    const moons = found && !isWritten(await this.store.writtenFor(key), found) ? found : null;
    if (moons && since !== null && before!.mtimeMs > since) {
      return kept(`Moon+ saved ${key} since, ${old}`);
    }
    // there's no knowing which of two places is further on without the book's layout
    if (moons && !layout) {
      return kept(`no layout to compare with Moon+'s ${key} ${old}`, 'unmeasured');
    }
    const known = await this.mappingFor(layout, moons);
    // write the way Moon+'s own position was read
    const mapping = known ?? (layout && moons && locate(layout, moons)?.mapping) ?? null;
    let position = kosyncToMoon(update.progress, update.percentage, Date.now(), layout, mapping);
    if (!position) return kept('not an EPUB position');
    if (moons && layout) {
      // KOReader went where Moon+ is (or never left): keep Moon+'s exact place
      if (samePlace(layout, moons, update.progress, position, known)) {
        return kept(`same place as Moon+ in ${key} ${old}`);
      }
      if (isBehind(layout, moons, update.progress, update.percentage, known)) {
        const served = await this.store.served(update.document);
        const offered =
          served?.v === 2 &&
          served.key === key &&
          (isWritten([served.place], moons) || served.mtimeMs >= before!.mtimeMs);
        if (!offered) return kept(`behind Moon+ and not offered, ${key} ${old}`, 'behind');
      }
    }
    if (!layout && found && found.chapter === position.chapter) {
      position = { ...position, ...furtherInChapter(found, position) };
    }
    // writing what's already there would only look like news to Moon+
    if (found && isWritten([placeOf(position)], found)) {
      return kept(`already there, ${key} ${old}`);
    }
    // remembered before the file appears, so nothing can read it as Moon+'s
    await this.store.wrote(key, placeOf(position));
    await mkdir(dirname(path), { recursive: true });
    // not ".part", which a WebDAV upload of the same file uses
    const tmp = `${path}.dash.part`;
    try {
      // Moon+'s own first number is kept; a new file gets the one most of its files have
      const stamp = before ? moonStamp(text) : commonStamp(files);
      const line = formatMoonPosition(position, stamp);
      await writeFile(tmp, line);
      if (before) {
        // WebDAV's Last-Modified counts in whole seconds: make sure Moon+ sees it change
        const next = (Math.floor(before.mtimeMs / 1000) + 1) * 1000;
        const time = new Date(Math.max(Date.now(), next));
        await utimes(tmp, time, time);
      }
      await rename(tmp, path);
      const was = !before ? '(new file)' : `${old} (${moons ? "Moon+'s" : "the dashboard's"})`;
      return { note: `written ${key}: ${was} -> "${line}"` };
    } finally {
      await rm(tmp, { force: true });
    }
  }

  /** The newest position for a document, or null when there is none. */
  async pull(document: string): Promise<KosyncProgress | null> {
    const kosync = await this.store.get(document);
    const say = (what: string, answer: KosyncProgress | null) => {
      const gave = !answer ? 'nothing' : answer === kosync ? "KOReader's" : "Moon+'s";
      this.activity.log(`Progress pull ${document}: ${what}; gave ${gave}`);
      return answer;
    };
    if (kosync && isPageNumber(kosync.progress)) return say('a paged book', kosync);
    const moon = await this.moonFor(document);
    if (!moon) return say('no Moon+ position', kosync);
    const layout = await this.layouts.get(document);
    const mapping = await this.mappingFor(layout, moon.position);
    const there = layout && locate(layout, moon.position, mapping);
    const what = describe(moon.position, layout, there);
    const older = kosync && moon.po.mtimeMs <= (kosync.at ?? kosync.timestamp * 1000);
    if (older && !kosync.held) return say(`${what}, older than KOReader's`, kosync);
    // without the layout any page would be a guess; it's offered once the layout is here
    if (!there) return say(what, kosync);
    // a page picked by percentage alone hasn't shown anyone where Moon+ is
    if (there.method !== 'percent') {
      await this.store.serve(document, {
        v: 2,
        key: writtenKey(this.library.dav, moon.po.path),
        place: placeOf(moon.position),
        mtimeMs: moon.po.mtimeMs,
      });
    }
    return say(what, moonToKosync(there, moon.po.mtimeMs));
  }

  /** The Moon+ position for a KOSync document, when its .po file can be found. */
  async moonFor(document: string): Promise<{ po: PoFile; position: MoonPosition } | null> {
    const po = poForDocument(document, await this.hint(document), await this.poFiles());
    const position = po && parseMoonPosition(po.text);
    if (!po || !position) return null;
    // the dashboard's own write, not Moon+ having moved
    const ours = await this.store.writtenFor(writtenKey(this.library.dav, po.path));
    return isWritten(ours, position) ? null : { po, position };
  }

  /**
   * What's known about this document's file: from KOReader's metadata, the plugin's book
   * sidecars and page layout, and the dashboard book it's linked to. The document id is
   * either the file's partial MD5 or the MD5 of its name.
   */
  private async hint(document: string): Promise<DocumentHint> {
    const sidecars = await this.koreader.sidecars();
    const sidecar = Object.hasOwn(sidecars, document)
      ? sidecars[document]
      : Object.values(sidecars).find((s) => s.file && fileNameDigest(s.file) === document);
    const stored = await this.store.get(document);
    const layout = await this.layouts.get(document);
    return {
      file: stored?.filename ?? sidecar?.file ?? layout?.file ?? null,
      title: sidecar?.title ?? stored?.title ?? null,
      linked: await this.koreader.linkedFiles(sidecar?.md5 ?? layout?.md5 ?? document),
    };
  }

  /** Every .po file in the WebDAV folder. */
  async poFiles(): Promise<PoFile[]> {
    const out: PoFile[] = [];
    for (const path of await findFiles(this.library.dav, '.po')) {
      try {
        const text = (await readFile(path, 'utf8')).slice(0, PO_READ_LIMIT);
        out.push({
          path,
          bookFile: basename(path).slice(0, -3),
          text,
          mtimeMs: await mtimeMs(path),
        });
      } catch {
        // removed while we were looking
      }
    }
    return out;
  }
}

/** The first number most .po files start with, or null when none has one. */
function commonStamp(files: PoFile[]): string | null {
  const counts = new Map<string, number>();
  for (const f of files) {
    const stamp = moonStamp(f.text);
    if (stamp) counts.set(stamp, (counts.get(stamp) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Where to write a .po file for a book Moon+ hasn't synced, named after the device's book
 * file: in Moon+'s own cache folder (.Moon+/Cache) when one has .po files, otherwise the
 * folder holding most of them. Null when Moon+ has never synced.
 */
export function newPoPath(bookFile: string | null, files: PoFile[]): string | null {
  if (!bookFile || !isReflowable(bookFile) || !files.length) return null;
  const counts = new Map<string, number>();
  for (const f of files) counts.set(dirname(f.path), (counts.get(dirname(f.path)) ?? 0) + 1);
  const cache = (folder: string) =>
    Number(basename(folder) === 'Cache' && basename(dirname(folder)) === '.Moon+');
  const [folder] = [...counts].sort((a, b) => cache(b[0]) - cache(a[0]) || b[1] - a[1])[0];
  return join(folder, `${basename(bookFile)}.po`);
}
