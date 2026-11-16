import { fragmentOfChapter, type MoonPosition, xpointerFragment } from './positions';

/**
 * Where each page of a book starts, as the KOReader plugin measured it on the device: the
 * page's xpointer, how many characters into its spine item that is (what Moon+ counts), and
 * how far through the book (0..1). It is what turns Moon+'s "characters into chapter N" into
 * the page KOReader should open, and KOReader's xpointer into Moon+'s character count.
 */
export interface LayoutPage {
  xp: string;
  /** Characters from the start of the page's spine item. */
  offset: number;
  /** 0..1. */
  pct: number;
}

export interface Layout {
  md5: string;
  file: string | null;
  pages: (LayoutPage & { fragment: number })[];
}

export class LayoutError extends Error {}

/** A book this long is beyond what the plugin measures; anything longer isn't a layout. */
export const MAX_LAYOUT_PAGES = 20_000;
/**
 * A Moon+ chapter is trusted to be the spine item of the same number when the page it lands
 * on is within this much of Moon+'s own percentage. Further off, Moon+ has split chapters
 * differently, and the percentage is used instead.
 */
export const PCT_TOLERANCE = 0.05;

/** Checks what the plugin sent, or throws LayoutError. */
export function parseLayout(body: unknown): Layout {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const md5 = typeof b.md5 === 'string' ? b.md5.trim() : '';
  if (!/^[0-9a-f]{32}$/i.test(md5)) throw new LayoutError('Expected the book\'s "md5".');
  if (!Array.isArray(b.pages) || !b.pages.length || b.pages.length > MAX_LAYOUT_PAGES) {
    throw new LayoutError(`Expected "pages": 1 to ${MAX_LAYOUT_PAGES} of them.`);
  }
  const pages: Layout['pages'] = [];
  for (const raw of b.pages as unknown[]) {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const xp = typeof p.xp === 'string' && p.xp.length <= 1024 ? p.xp : '';
    const fragment = xp ? xpointerFragment(xp) : null;
    const offset = Number(p.offset);
    const pct = Number(p.pct);
    if (fragment === null || !Number.isFinite(offset) || !Number.isFinite(pct)) continue;
    pages.push({
      xp,
      fragment,
      offset: Math.max(0, Math.floor(offset)),
      pct: Math.min(1, Math.max(0, pct)),
    });
  }
  if (!pages.length) throw new LayoutError('None of the pages has an xpointer.');
  const file = typeof b.file === 'string' && b.file.trim() ? b.file.trim().slice(0, 512) : null;
  return { md5: md5.toLowerCase(), file, pages };
}

/** The last page of `pages` for which `before` holds, or the first page when none does. */
function lastWhere<T>(pages: T[], before: (p: T) => boolean): T | undefined {
  let found: T | undefined;
  for (const p of pages) if (before(p)) found = p;
  return found ?? pages[0];
}

/**
 * The page KOReader should open for a Moon+ position: the page of its chapter holding its
 * character, when that agrees with Moon+'s percentage; otherwise the page at that percentage.
 */
export function moonToXpointer(layout: Layout, position: MoonPosition): string | null {
  const target = position.percent / 100;
  const fragment = fragmentOfChapter(position.chapter);
  const chapter = layout.pages.filter((p) => p.fragment === fragment);
  const page = chapter.length ? lastWhere(chapter, (p) => p.offset <= position.offset) : null;
  if (page && Math.abs(page.pct - target) <= PCT_TOLERANCE) return page.xp;
  return lastWhere(layout.pages, (p) => p.pct <= target)?.xp ?? null;
}

/**
 * How many characters into its spine item a KOReader position is: exact when it's the start
 * of a page the plugin measured (KOReader syncs the top of the page), otherwise the page of
 * that spine item at KOReader's percentage.
 */
export function xpointerOffset(layout: Layout, xp: string, percentage: number): number {
  const exact = layout.pages.find((p) => p.xp === xp);
  if (exact) return exact.offset;
  const fragment = xpointerFragment(xp);
  const chapter = layout.pages.filter((p) => p.fragment === fragment);
  if (!chapter.length) return 0;
  return lastWhere(chapter, (p) => p.pct <= percentage)?.offset ?? 0;
}
