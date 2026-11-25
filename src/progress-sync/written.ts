import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { MoonPosition } from './positions';

/**
 * What the dashboard has written into .po files, so its own positions are never taken for
 * Moon+'s. Kept apart from the services so the rebuild can read it too.
 */

/** The place a written .po names. Moon+ sending it back, even restamped, hasn't moved. */
export type WrittenPlace = Pick<MoonPosition, 'chapter' | 'split' | 'offset' | 'percent'>;

/** Keyed by the .po file's path under dav/, with "/" separators. Oldest write first. */
export type Written = Record<string, WrittenPlace[]>;

export const writtenPath = (libraryRoot: string) =>
  join(libraryRoot, 'progress-sync', 'moonplus-written.json');

export const writtenKey = (davRoot: string, poPath: string) =>
  relative(davRoot, poPath).split(sep).join('/');

export async function readWritten(libraryRoot: string): Promise<Written> {
  try {
    const raw: unknown = JSON.parse(await readFile(writtenPath(libraryRoot), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Written) : {};
  } catch {
    return {};
  }
}

/** The place as it reads back from a .po file, which holds one decimal of the percentage. */
export const placeOf = (p: MoonPosition): WrittenPlace => ({
  chapter: p.chapter,
  split: p.split,
  offset: p.offset,
  percent: Number(p.percent.toFixed(1)),
});

export function isWritten(places: unknown, p: MoonPosition): boolean {
  const here = placeOf(p);
  return (
    Array.isArray(places) &&
    (places as WrittenPlace[]).some(
      (w) =>
        w.chapter === here.chapter &&
        w.split === here.split &&
        w.offset === here.offset &&
        w.percent === here.percent,
    )
  );
}
