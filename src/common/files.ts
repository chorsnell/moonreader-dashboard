import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Every file under `dir` (recursively) whose name ends in `suffix`, ignoring case. */
export async function findFiles(dir: string, suffix: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  const want = suffix.toLowerCase();
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(want))
    .map((e) => join(e.parentPath, e.name));
}

/** The modification time in ms, or 0 when the file isn't there. */
export async function mtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Sorts paths newest first, by modification time. */
export async function newestFirst(paths: string[]): Promise<string[]> {
  const withTimes = await Promise.all(paths.map(async (p) => ({ p, t: await mtimeMs(p) })));
  return withTimes.sort((a, b) => b.t - a.t).map((x) => x.p);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
