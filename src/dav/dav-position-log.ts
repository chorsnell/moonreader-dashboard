import { open, readdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Injectable } from '@nestjs/common';
import { oneLine } from '../common/log-text';
import { ActivityLogService } from '../library/activity-log.service';

/** An identical read within this long is counted rather than logged again. */
export const REPEAT_QUIET_MS = 60_000;
/** The same for listings of Moon+'s folder, which a client may ask for before every book. */
export const LISTING_QUIET_MS = 10 * 60_000;
const MAX_REMEMBERED = 500;

const READS = new Set(['GET', 'HEAD', 'PROPFIND']);
const LOGGED = new Set([...READS, 'PUT', 'DELETE', 'MOVE', 'COPY']);
const isPo = (path: string) => path.toLowerCase().endsWith('.po');
const isMoonCache = (path: string) => /\/\.Moon\+\/Cache\/?$/i.test(path);

/** A .po file's line, in quotes, or what's there instead of one. */
async function content(file: string): Promise<string> {
  try {
    const handle = await open(file, 'r');
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(200), 0, 200, 0);
      return `"${oneLine(buffer.toString('utf8', 0, bytesRead))}"`;
    } finally {
      await handle.close();
    }
  } catch {
    return '(no file)';
  }
}

/** The path of a MOVE or COPY's Destination, without its server or any login in it. */
function destination(req: IncomingMessage): string | null {
  try {
    const url = new URL(String(req.headers.destination ?? ''), 'http://x');
    return req.headers.destination ? decodeURIComponent(url.pathname) : null;
  } catch {
    return null;
  }
}

/** What a request asked on condition of. Only these headers are ever logged. */
function conditions(req: IncomingMessage): string[] {
  return ['if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since']
    .filter((name) => req.headers[name] !== undefined)
    .map((name) => `${name} ${oneLine(String(req.headers[name]), 80)}`);
}

/**
 * Lines in update.log for what WebDAV clients do with .po files (reading positions), to see
 * what Moon+ asks for and what it's given. Never logs credentials or their headers.
 */
@Injectable()
export class DavPositionLog {
  private readonly seen = new Map<string, { at: number; again: number }>();

  constructor(private readonly activity: ActivityLogService) {}

  /**
   * Call before handling a request, with its decoded path and the file it names. The returned
   * function is called once handled, before the response is sent; the line is written when the
   * response is done, so it has the final status (a 304 is only decided on sending).
   */
  async watch(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    file: string | null,
  ): Promise<() => Promise<void>> {
    const none = async () => undefined;
    const method = req.method ?? 'GET';
    if (!LOGGED.has(method) || file === null) return none;
    const to = method === 'MOVE' || method === 'COPY' ? destination(req) : null;
    const listing = method === 'PROPFIND' && isMoonCache(path);
    if (!listing && !isPo(path) && !(to && isPo(to))) return none;

    const agent = oneLine(String(req.headers['user-agent'] ?? ''), 160) || 'unknown';
    if (listing) {
      const names = await readdir(file).catch(() => [] as string[]);
      const depth = oneLine(String(req.headers.depth ?? '1'), 10);
      const line = `WebDAV PROPFIND folder ${oneLine(path, 300)} depth ${depth}`;
      return async () =>
        this.whenDone(res, (status) => {
          const what = `${line} -> ${status}, ${names.filter(isPo).length} .po files`;
          this.write(`${what} | agent "${agent}"`, LISTING_QUIET_MS);
        });
    }

    // what a read is answered with, and what a delete or move takes away, is what's there now
    const before = method === 'PUT' ? null : await content(file);
    return async () => {
      const line = before ?? (await content(file));
      const st = await stat(file).catch(() => null);
      this.whenDone(res, (status) => {
        const note =
          status === 304
            ? ' (not modified: the client keeps its copy)'
            : status === 412
              ? ' (precondition failed)'
              : '';
        const etag = res.getHeader('etag');
        const parts = [
          `WebDAV ${method} ${oneLine(path, 300)}${to ? ` to ${oneLine(to, 300)}` : ''} -> ${status}${note}`,
          // a refused upload wasn't saved: this is what stayed
          method === 'PUT' && status >= 300 ? `kept ${line}` : line,
          `agent "${agent}"`,
          ...(etag ? [`etag ${String(etag)}`] : []),
          ...(st?.isFile() ? [`modified ${st.mtime.toISOString()}`] : []),
          ...conditions(req),
        ];
        this.write(parts.join(' | '), READS.has(method) ? REPEAT_QUIET_MS : 0);
      });
    };
  }

  private whenDone(res: ServerResponse, then: (status: number) => void): void {
    res.once('close', () => then(res.statusCode));
  }

  private write(line: string, quietMs: number): void {
    if (!quietMs) return this.activity.log(line);
    const last = this.seen.get(line);
    const now = Date.now();
    if (last && now - last.at < quietMs) {
      last.again++;
      return;
    }
    if (this.seen.size >= MAX_REMEMBERED) this.seen.clear();
    this.seen.set(line, { at: now, again: 0 });
    this.activity.log(last?.again ? `${line} (and ${last.again} more like it before)` : line);
  }
}
