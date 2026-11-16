import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Injectable } from '@nestjs/common';
import { findFiles, mtimeMs } from '../common/files';
import { KoreaderSyncService } from '../koreader-sync/koreader-sync.service';
import { LibraryService } from '../library/library.service';
import { type DocumentHint, type PoFile, poForDocument } from './moonplus-files';
import {
  fragmentOfChapter,
  fragmentStart,
  type MoonPosition,
  parseMoonPosition,
  toFraction,
} from './positions';
import { type KosyncProgress, ProgressStore } from './progress-store';

/** What a device sends with PUT /syncs/progress. */
export interface ProgressUpdate {
  document: string;
  progress: string;
  percentage: number;
  device: string;
  device_id: string;
}

export class ProgressSyncError extends Error {}

const MAX_TEXT = 512;
/** A position is a few dozen characters. */
const PO_READ_LIMIT = 4096;
/** How positions from Moon+ are labelled on KOReader's "sync to device…?" prompt. */
export const MOONPLUS_DEVICE = 'Moon+ Reader';
export const MOONPLUS_DEVICE_ID = 'moonplus';

/** Checks a PUT body the way koreader-sync-server does, or throws ProgressSyncError. */
export function parseUpdate(body: unknown): ProgressUpdate {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');
  const document = text(b.document);
  if (!document || !/^[\w.:-]+$/.test(document)) {
    throw new ProgressSyncError('Field "document" not provided.');
  }
  const progress = typeof b.progress === 'number' ? String(b.progress) : text(b.progress);
  const percentage = typeof b.percentage === 'string' ? Number(b.percentage) : b.percentage;
  if (!progress || typeof percentage !== 'number' || !Number.isFinite(percentage)) {
    throw new ProgressSyncError('Fields "progress" and "percentage" are required.');
  }
  return {
    document,
    progress,
    percentage: Math.min(1, Math.max(0, percentage)),
    device: text(b.device),
    device_id: text(b.device_id),
  };
}

/**
 * A Moon+ position as KOSync progress: the start of its chapter (the spine item it names),
 * with Moon+'s own percentage. `arrivedMs` is when the .po file reached the server.
 */
export function moonToKosync(position: MoonPosition, arrivedMs: number): KosyncProgress {
  return {
    progress: fragmentStart(fragmentOfChapter(position.chapter)),
    percentage: toFraction(position.percent),
    device: MOONPLUS_DEVICE,
    device_id: MOONPLUS_DEVICE_ID,
    timestamp: Math.floor(arrivedMs / 1000),
  };
}

/** Whether a KOSync position is a page number (PDFs, comics) rather than an xpointer. */
const isPageNumber = (progress: string) => /^\d+$/.test(progress.trim());

/**
 * Reading positions for KOReader's progress sync (KOSync). What KOReader devices send is kept
 * as it came. A device asking for a book gets the newest position from KOReader or from the
 * .po file Moon+ synced for it over WebDAV, whichever reached the server last.
 */
@Injectable()
export class ProgressSyncService {
  constructor(
    private readonly store: ProgressStore,
    private readonly library: LibraryService,
    private readonly koreader: KoreaderSyncService,
  ) {}

  /** Saves a device's position. Returns the server's timestamp for it, in seconds. */
  async push(update: ProgressUpdate): Promise<number> {
    const timestamp = Math.floor(Date.now() / 1000);
    const { document, ...rest } = update;
    await this.store.put(document, { ...rest, timestamp });
    return timestamp;
  }

  /** The newest position for a document, or null when there is none. */
  async pull(document: string): Promise<KosyncProgress | null> {
    const kosync = await this.store.get(document);
    if (kosync && isPageNumber(kosync.progress)) return kosync;
    const moon = await this.moonFor(document);
    if (!moon) return kosync;
    const converted = moonToKosync(moon.position, moon.po.mtimeMs);
    return !kosync || converted.timestamp > kosync.timestamp ? converted : kosync;
  }

  /** The Moon+ position for a KOSync document, when its .po file can be found. */
  async moonFor(document: string): Promise<{ po: PoFile; position: MoonPosition } | null> {
    const po = poForDocument(document, await this.hint(document), await this.poFiles());
    const position = po && parseMoonPosition(po.text);
    return po && position ? { po, position } : null;
  }

  /** What the KOReader plugin told the dashboard about this document's file. */
  private async hint(document: string): Promise<DocumentHint | null> {
    const sidecar = (await this.koreader.sidecars())[document];
    return sidecar ? { file: sidecar.file, title: sidecar.title } : null;
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
