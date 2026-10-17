import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../paths';

/** Which build is running: package.json's version and the git commit it was built from. */
export interface BuildInfo {
  version: string | null;
  /** The short commit hash, or null when it isn't known (a Docker build without GIT_COMMIT). */
  commit: string | null;
}

let cached: BuildInfo | null = null;

/**
 * Worked out once. The commit comes from GIT_COMMIT (passed to `docker build` as a build
 * arg, since the image has no .git), else from git itself when running from a checkout.
 */
export function buildInfo(): BuildInfo {
  cached ??= { version: packageVersion(), commit: shortHash(process.env.GIT_COMMIT) ?? gitHead() };
  return cached;
}

function packageVersion(): string | null {
  try {
    const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

function gitHead(): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    return shortHash(out.toString());
  } catch {
    return null;
  }
}

function shortHash(raw: string | undefined): string | null {
  const hash = raw?.trim().toLowerCase();
  return hash && /^[0-9a-f]{7,40}$/.test(hash) ? hash.slice(0, 7) : null;
}
