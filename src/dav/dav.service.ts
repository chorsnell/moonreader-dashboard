import { cp, copyFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { basename, dirname, join, relative, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { publicPrefix } from '../common/http/public-prefix';
import { RequestBodyError, saveRequestBody } from '../common/http/request-body';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { StatusService } from '../library/status.service';
import { lockGranted, multistatus, propEntry, proppatchOk, quotePath } from './dav-xml';

/** What to send back. `file` means stream that file as the body. */
export interface DavResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  file?: string;
}

const XML = { 'Content-Type': 'application/xml; charset=utf-8' };
const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };
export const DAV_METHODS =
  'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK';

const text = (status: number, body = ''): DavResponse => ({ status, headers: TEXT, body });

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/**
 * A small WebDAV server over library/dav/, enough for Moon+ Reader's position sync and
 * cloud backup. Backups written here are handed to the inbox; .po files are reading
 * positions, which trigger a rebuild.
 */
@Injectable()
export class DavService {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly status: StatusService,
    private readonly activity: ActivityLogService,
  ) {}

  /** `path` is the request path, decoded, starting with /dav. */
  async handle(req: IncomingMessage, path: string): Promise<DavResponse> {
    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') {
      return { status: 200, headers: { DAV: '1, 2', 'MS-Author-Via': 'DAV', Allow: DAV_METHODS } };
    }
    const full = this.toFile(path);
    if (full === null) return text(400, 'Bad path');
    const prefix = publicPrefix(req.headers, this.config.basePath);

    switch (method) {
      case 'GET':
      case 'HEAD':
        return this.get(full);
      case 'PUT':
        return this.put(req, full);
      case 'MKCOL':
        return this.mkcol(full);
      case 'DELETE':
        return this.delete(full);
      case 'MOVE':
      case 'COPY':
        return this.moveOrCopy(req, full, prefix, method === 'MOVE');
      case 'PROPFIND':
        return this.propfind(full, prefix, String(req.headers.depth ?? '1'));
      case 'PROPPATCH':
        return { status: 207, headers: XML, body: proppatchOk(await this.href(full, prefix)) };
      case 'LOCK': {
        const token = `opaquelocktoken:${Date.now()}`;
        return {
          status: 200,
          headers: { ...XML, 'Lock-Token': `<${token}>` },
          body: lockGranted(token),
        };
      }
      case 'UNLOCK':
        return { status: 204 };
      default:
        return text(405, 'Method not allowed');
    }
  }

  /** /dav/a/b -> library/dav/a/b, or null when the path tries to leave the folder. */
  toFile(path: string): string | null {
    const parts = path.slice('/dav'.length).split('/').filter(Boolean);
    if (parts.some((p) => p === '.' || p === '..' || p.includes('\0') || p.includes('\\'))) {
      return null;
    }
    return parts.length ? join(this.library.dav, ...parts) : this.library.dav;
  }

  private async get(full: string): Promise<DavResponse> {
    const st = await statOrNull(full);
    if (st?.isDirectory()) return text(200, 'Reading dashboard WebDAV folder.\n');
    if (!st?.isFile()) return text(404, 'Not found');
    return { status: 200, file: full };
  }

  private async put(req: IncomingMessage, full: string): Promise<DavResponse> {
    const st = await statOrNull(full);
    if (st?.isDirectory()) {
      req.resume();
      return text(409, 'That is a folder.');
    }
    await mkdir(dirname(full), { recursive: true });
    try {
      await saveRequestBody(req, full);
    } catch (e) {
      if (e instanceof RequestBodyError) return text(400, e.message);
      throw e;
    }
    await this.afterWrite(full, req);
    return { status: st ? 204 : 201 };
  }

  private async mkcol(full: string): Promise<DavResponse> {
    if (await statOrNull(full)) return text(405, 'Already exists');
    await mkdir(full, { recursive: true });
    return { status: 201 };
  }

  private async delete(full: string): Promise<DavResponse> {
    if (!(await statOrNull(full))) return text(404, 'Not found');
    if (full === this.library.dav) return text(403, 'Refusing to delete the root');
    await rm(full, { recursive: true, force: true });
    return { status: 204 };
  }

  private async moveOrCopy(
    req: IncomingMessage,
    full: string,
    prefix: string,
    move: boolean,
  ): Promise<DavResponse> {
    let destPath: string;
    try {
      destPath = decodeURIComponent(
        new URL(String(req.headers.destination ?? ''), 'http://x').pathname,
      );
    } catch {
      return text(400, 'Bad move');
    }
    const basePath = this.config.basePath;
    if (prefix && destPath.startsWith(`${prefix}/`)) destPath = destPath.slice(prefix.length);
    else if (basePath && destPath.startsWith(`${basePath}/`))
      destPath = destPath.slice(basePath.length);
    const dest = destPath.startsWith('/dav') ? this.toFile(destPath) : null;
    if (dest === null) return text(400, 'Bad move');
    const src = await statOrNull(full);
    if (!src) return text(404, 'Bad move');

    const existed = await statOrNull(dest);
    if (existed && String(req.headers.overwrite ?? 'T').toUpperCase() === 'F') {
      return text(412, 'Destination exists');
    }
    await mkdir(dirname(dest), { recursive: true });
    if (existed) await rm(dest, { recursive: true, force: true });
    if (move) await rename(full, dest);
    else if (src.isDirectory()) await cp(full, dest, { recursive: true });
    else await copyFile(full, dest);
    if ((await statOrNull(dest))?.isFile()) await this.afterWrite(dest, req);
    return { status: existed ? 204 : 201 };
  }

  private async propfind(full: string, prefix: string, depth: string): Promise<DavResponse> {
    const st = await statOrNull(full);
    if (!st) return text(404, 'Not found');
    const items: [string, Stats][] = [[full, st]];
    if (st.isDirectory() && depth !== '0') {
      for (const name of (await readdir(full)).sort()) {
        if (name.endsWith('.part')) continue;
        const child = await statOrNull(join(full, name));
        if (child) items.push([join(full, name), child]);
      }
    }
    const responses = await Promise.all(
      items.map(async ([path, s]) => {
        const name = path === this.library.dav ? 'dav' : basename(path);
        return propEntry(await this.href(path, prefix, s), name, s);
      }),
    );
    return { status: 207, headers: XML, body: multistatus(responses) };
  }

  private async href(full: string, prefix: string, st?: Stats | null): Promise<string> {
    const rel = relative(this.library.dav, full).split(sep).join('/');
    let href = `${prefix}/dav/${quotePath(rel)}`;
    if ((st ?? (await statOrNull(full)))?.isDirectory() && !href.endsWith('/')) href += '/';
    return href;
  }

  /** A file arrived: a backup goes to the inbox, a reading position triggers a rebuild. */
  private async afterWrite(full: string, req: IncomingMessage): Promise<void> {
    const rel = relative(this.library.dav, full).split(sep).join('/');
    const lower = full.toLowerCase();
    const device = davDevice(req);
    if (lower.endsWith('.mrpro')) {
      if (await startsWithPK(full)) {
        const name = await this.library.receiveBackup(full, basename(full), 'webdav');
        this.activity.record({
          type: 'sync',
          message: `WebDAV: received backup ${rel} -> inbox/${name}`,
          trigger: 'webdav',
          details: { kind: 'backup', file: rel, inbox: name, device },
        });
      } else {
        this.activity.record({
          type: 'sync',
          message: `WebDAV: ${rel} is not a valid backup, ignored`,
          outcome: 'failed',
          trigger: 'webdav',
          error: 'Not a Moon+ backup (.mrpro is a zip file)',
          details: { kind: 'backup', file: rel, device },
        });
      }
    } else if (lower.endsWith('.po')) {
      this.status.positionSynced();
      this.activity.record({
        type: 'sync',
        message: `WebDAV: reading position ${rel}`,
        trigger: 'webdav',
        details: { kind: 'position', file: rel, book: basename(full).slice(0, -3), device },
      });
      this.library.changed('sync');
    } else {
      this.activity.log(`WebDAV: stored ${rel}`);
    }
  }
}

/** The client's User-Agent, which names the app (and sometimes the device) that synced. */
export function davDevice(req: IncomingMessage): string | null {
  const agent = String(req.headers['user-agent'] ?? '').trim();
  return agent ? agent.slice(0, 160) : null;
}

async function startsWithPK(path: string): Promise<boolean> {
  try {
    const file = await open(path, 'r');
    try {
      const { buffer, bytesRead } = await file.read(Buffer.alloc(2), 0, 2, 0);
      return bytesRead === 2 && buffer.toString('latin1') === 'PK';
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}
