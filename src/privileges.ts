import { lchownSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from './config/app.config';

/**
 * The container starts as root only so it can give the library folder to PUID:PGID (who
 * owns the files on the host); then it carries on as that user.
 */
export function dropPrivileges({ library, puid, pgid }: AppConfig): void {
  if (process.getuid?.() !== 0 || !process.setuid || !process.setgid) return;
  mkdirSync(library, { recursive: true });
  const chown = (path: string) => {
    try {
      lchownSync(path, puid, pgid);
    } catch {
      // e.g. a read-only file system; carry on
    }
  };
  chown(library);
  for (const entry of readdirSync(library, { recursive: true, withFileTypes: true })) {
    chown(join(entry.parentPath, entry.name));
  }
  process.setgroups?.([]);
  process.setgid(pgid);
  process.setuid(puid);
  process.env.HOME = '/tmp';
}
