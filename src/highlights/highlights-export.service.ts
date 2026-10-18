import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { appConfig, type AppConfigType } from '../config/app.config';
import { localDateTime } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import {
  type BookHighlights,
  type BookRow,
  groupByBook,
  type HighlightRow,
  markdownZip,
  pushKey,
  readwiseCsv,
  readwiseHighlights,
} from './export';

/** settings.json's "readwise" section. Only ever read by admin-only endpoints. */
interface ReadwiseSettings {
  token: string;
}

/** library/readwise-pushed.json: what has been sent to Readwise, so a push sends only what's new. */
interface PushedRecord {
  /** pushKey → when it was sent. */
  pushed: Record<string, string>;
  last: { time: string; sent: number; skipped: number } | null;
}

export class ReadwiseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Highlights per request: Readwise takes a list; keep each request small. */
const BATCH = 100;

/**
 * Highlights export (BOO-82): Markdown for Obsidian or Logseq, a CSV for Readwise's import,
 * and pushing straight to Readwise with the admin's token. The admin's own export, so it
 * has every book, private ones too.
 */
@Injectable()
export class HighlightsExportService {
  private readonly pushedFile: string;

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly settings: AccessSettingsService,
    private readonly library: LibraryService,
    private readonly activity: ActivityLogService,
  ) {
    this.pushedFile = join(library.root, 'readwise-pushed.json');
  }

  private async load<T>(name: string): Promise<T[]> {
    try {
      const v = JSON.parse(await readFile(join(this.library.data, name), 'utf8')) as unknown;
      return Array.isArray(v) ? (v as T[]) : [];
    } catch {
      return [];
    }
  }

  async groups(): Promise<BookHighlights[]> {
    return groupByBook(
      await this.load<BookRow>('books.json'),
      await this.load<HighlightRow>('highlights.json'),
    );
  }

  async summary() {
    const groups = await this.groups();
    const token = await this.token();
    const rec = await this.pushed();
    const all = readwiseHighlights(groups);
    return {
      books: groups.length,
      highlights: all.length,
      readwise: {
        token_set: !!token,
        pushed: all.filter((h) => rec.pushed[pushKey(h)]).length,
        last: rec.last,
      },
    };
  }

  async markdown(): Promise<Buffer> {
    return markdownZip(await this.groups(), localDateTime().slice(0, 10));
  }

  async csv(): Promise<string> {
    return readwiseCsv(await this.groups());
  }

  // ---------- Readwise ----------

  private async token(): Promise<string | null> {
    const raw = (await this.settings.section('readwise')) as Partial<ReadwiseSettings> | undefined;
    return raw && typeof raw.token === 'string' && raw.token ? raw.token : null;
  }

  private async call(path: string, token: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.config.readwiseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Token ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new ReadwiseError(`Couldn't reach Readwise: ${(e as Error).message}`, 502);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ReadwiseError(
        'Readwise turned the token down. Check it at readwise.io/access_token.',
        400,
      );
    }
    if (res.status === 429) {
      const wait = res.headers.get('retry-after');
      throw new ReadwiseError(
        `Readwise asked to slow down${wait ? `; try again in ${wait} seconds` : ''}. What was sent so far is kept.`,
        429,
      );
    }
    if (!res.ok) throw new ReadwiseError(`Readwise answered ${res.status}.`, 502);
    return res;
  }

  /** Checks the token with Readwise, then keeps it in settings.json (never sent back to the page). */
  async setToken(token: string): Promise<void> {
    await this.call('/api/v2/auth/', token);
    await this.settings.saveSection('readwise', { token } satisfies ReadwiseSettings);
    await this.activity.record({
      type: 'settings',
      message: 'Connected Readwise',
      trigger: 'admin',
    });
  }

  async forget(): Promise<void> {
    await this.settings.saveSection('readwise', undefined);
    await this.activity.record({
      type: 'settings',
      message: 'Disconnected Readwise',
      trigger: 'admin',
    });
  }

  private async pushed(): Promise<PushedRecord> {
    try {
      const v = JSON.parse(await readFile(this.pushedFile, 'utf8')) as Partial<PushedRecord>;
      return { pushed: v.pushed ?? {}, last: v.last ?? null };
    } catch {
      return { pushed: {}, last: null };
    }
  }

  private async savePushed(rec: PushedRecord): Promise<void> {
    await writeFile(this.pushedFile + '.part', JSON.stringify(rec));
    await rename(this.pushedFile + '.part', this.pushedFile);
  }

  /**
   * Sends highlights to Readwise: only those not sent before, or all of them with `all`
   * (Readwise itself dedupes on text, title and author, so a resend updates rather than
   * duplicates). The record is saved after each batch, so a failure part way keeps what went.
   */
  async push(all = false): Promise<{ sent: number; skipped: number; total: number }> {
    const token = await this.token();
    if (!token) throw new ReadwiseError('Add your Readwise token first.', 400);
    const rec = await this.pushed();
    const highlights = readwiseHighlights(await this.groups());
    const todo = all ? highlights : highlights.filter((h) => !rec.pushed[pushKey(h)]);
    const started = Date.now();
    let sent = 0;
    try {
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        await this.call('/api/v2/highlights/', token, { highlights: batch });
        const now = localDateTime();
        for (const h of batch) rec.pushed[pushKey(h)] = now;
        sent += batch.length;
        await this.savePushed(rec);
      }
    } catch (e) {
      rec.last = { time: localDateTime(), sent, skipped: highlights.length - todo.length };
      await this.savePushed(rec);
      await this.activity.record({
        type: 'export',
        message: `Readwise push stopped after ${sent} of ${todo.length} highlights`,
        outcome: 'failed',
        trigger: 'admin',
        error: (e as Error).message,
        duration_ms: Date.now() - started,
      });
      throw e;
    }
    const skipped = highlights.length - todo.length;
    rec.last = { time: localDateTime(), sent, skipped };
    await this.savePushed(rec);
    await this.activity.record({
      type: 'export',
      message: sent ? `Sent ${sent} highlights to Readwise` : 'Nothing new to send to Readwise',
      trigger: 'admin',
      duration_ms: Date.now() - started,
      details: { sent, skipped },
    });
    return { sent, skipped, total: highlights.length };
  }
}
