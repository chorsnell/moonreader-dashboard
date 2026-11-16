import { Injectable } from '@nestjs/common';
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

/** Checks a PUT body the way koreader-sync-server does, or throws ProgressSyncError. */
export function parseUpdate(body: unknown): ProgressUpdate {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');
  const document = text(b.document);
  if (!document || !/^[\w.:-]+$/.test(document))
    throw new ProgressSyncError('Field "document" not provided.');
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
 * Reading positions for KOReader's progress sync (KOSync): what the devices send is kept as
 * it came, and the newest position for a book is what they get back.
 */
@Injectable()
export class ProgressSyncService {
  constructor(private readonly store: ProgressStore) {}

  /** Saves a device's position. Returns the server's timestamp for it, in seconds. */
  async push(update: ProgressUpdate): Promise<number> {
    const timestamp = Math.floor(Date.now() / 1000);
    const { document, ...rest } = update;
    await this.store.put(document, { ...rest, timestamp });
    return timestamp;
  }

  /** The newest position for a document, or null when there is none. */
  async pull(document: string): Promise<KosyncProgress | null> {
    return this.store.get(document);
  }
}
