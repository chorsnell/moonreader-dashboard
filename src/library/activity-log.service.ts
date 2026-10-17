import { appendFileSync, renameSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { localDateTime, logTimestamp } from '../common/time';

/** What an activity entry is about. */
export const ACTIVITY_TYPES = [
  'sync',
  'rebuild',
  'upload',
  'import',
  'request',
  'cover',
  'metadata',
  'prune',
  'settings',
  'friends',
  'notify',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type Outcome = 'ok' | 'failed';

/** What someone records; time is added. */
export interface ActivityInput {
  type: ActivityType;
  /** One line for people, also written to update.log. */
  message: string;
  outcome?: Outcome;
  /** What started it: upload, webdav, sync, inbox, catalogue, admin, startup… */
  trigger?: string;
  duration_ms?: number;
  error?: string;
  details?: Record<string, unknown>;
}

/** One line of activity.jsonl. */
export interface ActivityEntry extends ActivityInput {
  /** Local time, YYYY-MM-DDTHH:MM:SS, like meta.json's generated. */
  time: string;
  outcome: Outcome;
}

/** activity.jsonl moves to activity.1.jsonl (replacing it) when it grows past this. */
export const ACTIVITY_MAX_BYTES = 2 * 1024 * 1024;

/**
 * update.log: what happened on each rebuild, upload and sync, for people to read when
 * something isn't picked up. Every line also goes to the console.
 *
 * activity.jsonl: the same events as JSON lines (type, time, trigger, duration, outcome,
 * error, details), which the admin page's Sync & logs section reads.
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger('Library');
  private readonly file: string;
  readonly jsonl: string;
  readonly previousJsonl: string;

  constructor(@Inject(appConfig.KEY) config: AppConfigType) {
    this.file = join(config.library, 'update.log');
    this.jsonl = join(config.library, 'activity.jsonl');
    this.previousJsonl = join(config.library, 'activity.1.jsonl');
  }

  get textLog(): string {
    return this.file;
  }

  log(message: string): void {
    this.logger.log(message);
    try {
      // synchronous, so lines from overlapping jobs stay whole and in order
      appendFileSync(this.file, `${logTimestamp()} ${message}\n`, 'utf8');
    } catch {
      // the library may not be writable yet; the console still has it
    }
  }

  /** Records an event in activity.jsonl, and its message in update.log. */
  record(input: ActivityInput): ActivityEntry {
    const entry: ActivityEntry = { time: localDateTime(), outcome: 'ok', ...input };
    if (entry.error) entry.error = entry.error.slice(0, 2000);
    this.log(
      entry.outcome === 'failed' && entry.error
        ? `${entry.message}: ${entry.error}`
        : entry.message,
    );
    try {
      const size = statSync(this.jsonl, { throwIfNoEntry: false })?.size ?? 0;
      if (size > ACTIVITY_MAX_BYTES) renameSync(this.jsonl, this.previousJsonl);
      appendFileSync(this.jsonl, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // as above
    }
    return entry;
  }

  /** Every entry kept, oldest first. Lines that aren't valid entries are skipped. */
  async entries(): Promise<ActivityEntry[]> {
    const out: ActivityEntry[] = [];
    for (const file of [this.previousJsonl, this.jsonl]) {
      let text = '';
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as ActivityEntry;
          if (e && typeof e.time === 'string' && typeof e.type === 'string') out.push(e);
        } catch {
          // a line cut short by a crash
        }
      }
    }
    return out;
  }
}
