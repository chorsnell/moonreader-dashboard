import { type MoonPosition, xpointerFragment } from './positions';

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

/** Where a table of contents entry points: a spine item and the characters into it. */
export interface TocEntry {
  fragment: number;
  offset: number;
}

export interface Layout {
  md5: string;
  file: string | null;
  pages: (LayoutPage & { fragment: number })[];
  /** The book's table of contents. Absent in layouts from older plugins. */
  toc?: TocEntry[];
  /** Characters in each spine item, the first one first, for chapters spanning several. */
  lengths?: number[];
}

/**
 * How Moon+'s chapters relate to the book. "toc": a chapter starts at each table of contents
 * entry, and anything not listed belongs to the chapter before. "spine": one per spine item.
 */
export type Mapping = 'toc' | 'spine';

export class LayoutError extends Error {}

/** A book this long is beyond what the plugin measures; anything longer isn't a layout. */
export const MAX_LAYOUT_PAGES = 20_000;
/**
 * How near a page must be to Moon+'s own percentage for the percentage to count as a hint.
 * It's only ever a hint: Moon+ usually agrees with KOReader to a few points, but has been seen
 * 47 points out (The Talisman), while its chapter and character were right.
 */
export const PCT_TOLERANCE = 0.04;
/** How much closer the spine must come to beat the contents, when the percentage fits both. */
export const BETTER_BY = 0.015;
/**
 * Moon+ cuts a chapter with over 100,000 characters of HTML into parts ("splits") and counts
 * from the start of the part. About this many of them are text.
 */
export const PART_CHARS = 80_000;
/** An offset this far past a chapter's end doesn't belong to that chapter. */
const SLACK_CHARS = 2000;
const MAX_TOC = 5000;
const MAX_FRAGMENTS = 5000;

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
  const count = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const toc = (Array.isArray(b.toc) ? (b.toc as unknown[]).slice(0, MAX_TOC) : []).flatMap(
    (raw) => {
      const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const fragment = count(t.fragment);
      return fragment >= 1 && fragment <= MAX_FRAGMENTS
        ? [{ fragment, offset: count(t.offset) }]
        : [];
    },
  );
  const lengths = Array.isArray(b.lengths)
    ? (b.lengths as unknown[]).slice(0, MAX_FRAGMENTS).map(count)
    : [];
  return {
    md5: md5.toLowerCase(),
    file,
    pages,
    ...(toc.length ? { toc } : {}),
    ...(lengths.length ? { lengths } : {}),
  };
}

/** The last page of `pages` for which `before` holds, or the first page when none does. */
function lastWhere<T>(pages: T[], before: (p: T) => boolean): T | undefined {
  let found: T | undefined;
  for (const p of pages) if (before(p)) found = p;
  return found ?? pages[0];
}

/** KOReader rounds the percentage it syncs down to 4 places (Math.roundPercent). */
const ROUNDING = 1e-4;

/** An xpointer's node, and how many characters into its text it points. */
function textPoint(xp: string): { node: string; at: number } {
  const m = /^(.*)\.(\d+)$/.exec(xp);
  return m ? { node: m[1], at: Number(m[2]) } : { node: xp, at: 0 };
}

/**
 * How many characters into its spine item a KOReader position is: exact when it's the start
 * of a page the plugin measured (KOReader syncs the top of the page), or in the same text as
 * one; otherwise the page of that spine item at KOReader's percentage.
 */
export function xpointerOffset(layout: Layout, xp: string, percentage: number): number {
  const exact = layout.pages.find((p) => p.xp === xp);
  if (exact) return exact.offset;
  const want = textPoint(xp);
  const near = layout.pages.find((p) => textPoint(p.xp).node === want.node);
  if (near) return Math.max(0, near.offset + want.at - textPoint(near.xp).at);
  const fragment = xpointerFragment(xp);
  const chapter = layout.pages.filter((p) => p.fragment === fragment);
  if (!chapter.length) return 0;
  return lastWhere(chapter, (p) => p.pct <= percentage + ROUNDING)?.offset ?? 0;
}

/** A layout's spine items laid end to end, so a place is one number of characters. */
interface Ruler {
  at: (point: TocEntry) => number;
  /** Each page's place. */
  pages: number[];
  total: number;
  fragments: number;
}

function ruler(layout: Layout): Ruler {
  const steps: number[] = [];
  const last = new Map<number, number>();
  let fragments = layout.lengths?.length ?? 0;
  layout.pages.forEach((p, i) => {
    const before = layout.pages[i - 1];
    if (before?.fragment === p.fragment && p.offset > before.offset) {
      steps.push(p.offset - before.offset);
    }
    last.set(p.fragment, Math.max(p.offset, last.get(p.fragment) ?? 0));
    fragments = Math.max(fragments, p.fragment);
  });
  steps.sort((a, b) => a - b);
  const page = steps[Math.floor(steps.length / 2)] ?? 1500;
  // a length the plugin didn't send is its last page's place and a typical page more
  const length = (f: number) => layout.lengths?.[f - 1] ?? (last.has(f) ? last.get(f)! + page : 0);
  const bases = [0, 0];
  for (let f = 1; f <= fragments; f++) bases.push(bases[f] + length(f) + 1);
  const at = (p: TocEntry) => (bases[p.fragment] ?? bases[fragments + 1]) + p.offset;
  return { at, pages: layout.pages.map(at), total: bases[fragments + 1], fragments };
}

/** Where each of Moon+'s chapters would start, or null when the mapping can't be made. */
function chapterStarts(layout: Layout, r: Ruler, mapping: Mapping): number[] | null {
  if (mapping === 'spine') {
    return Array.from({ length: r.fragments }, (_, i) => r.at({ fragment: i + 1, offset: 0 }));
  }
  if (!layout.toc) return null;
  // what comes before the first entry (cover, title page) is chapter 0
  const starts = [...new Set([0, ...layout.toc.map(r.at)])]
    .filter((s) => s < r.total)
    .sort((a, b) => a - b);
  // a contents list naming (almost) nothing says nothing about chapters
  return starts.length < 2 && r.fragments > 2 ? null : starts;
}

/** The index of the last of `places` at or before `at` (they're in order), or 0. */
function indexAt(places: number[], at: number): number {
  let found = 0;
  for (let i = 0; i < places.length && places[i] <= at; i++) found = i;
  return found;
}

export interface Located {
  xp: string;
  /** The page's place in the layout, from 0. */
  page: number;
  /** KOReader's own percentage for that page, 0..1. */
  pct: number;
  /**
   * exact: Moon+'s chapter and character; chapter: its chapter, which is too short to hold
   * the character; percent: no reading of the book has that chapter.
   */
  method: 'exact' | 'chapter' | 'percent';
  mapping?: Mapping;
  /** Worth remembering for the book. */
  decisive: boolean;
  /** The last page Moon+ could be on: what a position has to reach not to be behind it. */
  furthest: number;
  /** The page each mapping's reading gives, for the log. */
  readings: Partial<Record<Mapping, number>>;
}

interface Reading {
  mapping: Mapping;
  start: number;
  first: number;
  last: number;
  page: number;
  holds: boolean;
  /** Whether Moon+'s percentage is about right for the page, and how far out it is. */
  plausible: boolean;
  distance: number;
}

/**
 * The page KOReader should open for a Moon+ position. Moon+'s chapter, split and character
 * say where; its percentage can be badly wrong and only helps to choose between readings.
 *
 * The chapter is read both ways (table of contents and spine). A reading whose chapter is
 * long enough to hold the character wins. When both are, the remembered one stands; with no
 * history the percentage chooses if it's about right for either, and otherwise the contents.
 * Only when neither reading has such a chapter does the percentage pick the page.
 */
export function locate(
  layout: Layout,
  position: MoonPosition,
  preferred: Mapping | null = null,
): Located | null {
  if (!layout.pages.length) return null;
  const r = ruler(layout);
  const target = position.percent / 100;
  const step = 1 / layout.pages.length;
  // a page's pct is page / pages, so it covers the step up to there
  const distance = (i: number) =>
    Math.max(0, layout.pages[i].pct - step - target, target - layout.pages[i].pct);
  let byPercent = 0;
  layout.pages.forEach((p, i) => {
    if (p.pct <= target) byPercent = i;
  });

  const into = position.split * PART_CHARS + position.offset;
  const order: Mapping[] = preferred === 'spine' ? ['spine', 'toc'] : ['toc', 'spine'];
  const readings: Reading[] = [];
  // where each mapping the layout can make puts the chapter, if it has that many
  const starts = new Map<Mapping, number | undefined>();
  for (const mapping of order) {
    const chapters = chapterStarts(layout, r, mapping);
    if (!chapters) continue;
    const start = chapters[position.chapter];
    starts.set(mapping, start);
    if (start === undefined) continue;
    const end = chapters[position.chapter + 1] ?? r.total;
    const first = indexAt(r.pages, start);
    const last = Math.max(first, indexAt(r.pages, end - 1));
    const page = indexAt(r.pages, Math.min(start + into, end - 1));
    const holds = start + into <= end + SLACK_CHARS;
    const off = distance(page);
    const plausible = off <= PCT_TOLERANCE;
    readings.push({ mapping, start, first, last, page, holds, plausible, distance: off });
  }

  const pages = Object.fromEntries(readings.map((c) => [c.mapping, c.page]));
  const found = (
    page: number,
    method: Located['method'],
    mapping: Mapping | undefined,
    decisive = false,
    furthest = page,
  ): Located => ({
    xp: layout.pages[page].xp,
    page,
    pct: layout.pages[page].pct,
    method,
    ...(mapping ? { mapping } : {}),
    decisive,
    furthest,
    readings: pages,
  });

  const [first, other] = readings.filter((c) => c.holds);
  if (first && !other) {
    // decisive when the other mapping names somewhere else (or nowhere) and so doesn't fit
    const disagreed = [...starts].some(([m, s]) => m !== first.mapping && s !== first.start);
    return found(first.page, 'exact', first.mapping, disagreed);
  }
  if (first) {
    if (preferred) return found(first.page, 'exact', first.mapping);
    const closer =
      other.plausible && (!first.plausible || other.distance < first.distance - BETTER_BY);
    const chosen = closer ? other : first;
    const hinted = first.plausible || other.plausible;
    const decisive = first.plausible !== other.plausible && first.start !== other.start;
    // a guess: either could be where Moon+ is
    const furthest = hinted ? chosen.page : Math.max(first.page, other.page);
    return found(chosen.page, 'exact', chosen.mapping, decisive, furthest);
  }
  const [short] = readings;
  if (short) {
    const hinted = byPercent >= short.first && byPercent <= short.last;
    const page = hinted ? byPercent : short.page;
    return found(page, 'chapter', short.mapping, false, short.last);
  }
  return found(byPercent, 'percent', undefined, false, layout.pages.length - 1);
}

export const moonToXpointer = (
  layout: Layout,
  position: MoonPosition,
  preferred: Mapping | null = null,
): string | null => locate(layout, position, preferred)?.xp ?? null;

/**
 * A KOReader position in Moon+'s terms: its chapter by the mapping that fitted this book (the
 * table of contents when none has yet), the split of a long chapter, and the characters in.
 */
export function moonPlace(
  layout: Layout,
  xp: string,
  percentage: number,
  preferred: Mapping | null = null,
): Pick<MoonPosition, 'chapter' | 'split' | 'offset'> | null {
  const fragment = xpointerFragment(xp);
  if (fragment === null) return null;
  const r = ruler(layout);
  const here = r.at({ fragment, offset: xpointerOffset(layout, xp, percentage) });
  const chapters =
    chapterStarts(layout, r, preferred ?? 'toc') ?? chapterStarts(layout, r, 'spine')!;
  // a spine item past what the layout knows: all that can be said is which one
  if (fragment > r.fragments) return { chapter: fragment - 1, split: 0, offset: 0 };
  const chapter = indexAt(chapters, here);
  const into = here - chapters[chapter];
  const long = (chapters[chapter + 1] ?? r.total) - chapters[chapter] > PART_CHARS;
  const split = long ? Math.floor(into / PART_CHARS) : 0;
  return { chapter, split, offset: into - split * PART_CHARS };
}

/**
 * Whether Moon+'s position is already on the page KOReader is on, so writing KOReader's over
 * it would only lose Moon+'s own place within the page.
 */
export function samePlace(
  layout: Layout,
  moon: MoonPosition,
  xp: string,
  mine: MoonPosition,
  preferred: Mapping | null = null,
): boolean {
  const there = moonToXpointer(layout, moon, preferred);
  if (there === xp) return true;
  const fragment = xpointerFragment(xp);
  if (fragment === null) return false;
  const r = ruler(layout);
  const here = r.at({ fragment, offset: xpointerOffset(layout, xp, mine.percent / 100) });
  return there === layout.pages[indexAt(r.pages, here)].xp;
}

/**
 * Whether a KOReader position is behind Moon+'s, going by the pages they're on and never by
 * Moon+'s percentage. When Moon+'s place can't be found, it counts as behind.
 */
export function isBehind(
  layout: Layout,
  moon: MoonPosition,
  xp: string,
  percentage: number,
  preferred: Mapping | null = null,
): boolean {
  const there = locate(layout, moon, preferred);
  const fragment = xpointerFragment(xp);
  if (!there || there.method === 'percent' || fragment === null) return true;
  const r = ruler(layout);
  const here = r.at({ fragment, offset: xpointerOffset(layout, xp, percentage) });
  return indexAt(r.pages, here) < there.furthest;
}

/**
 * Characters assumed for each percent of a book when there's no layout to count them. That of
 * a short book, so a guess falls short of the real place rather than past it.
 */
export const CHARS_PER_PERCENT = 2000;

/**
 * Without a layout, how far into the chapter KOReader has got, reckoned on from the
 * dashboard's own last write in that chapter (never from Moon+'s, whose percentage may be on
 * another scale altogether). Null when it isn't further on.
 */
export function furtherInChapter(
  from: MoonPosition,
  mine: MoonPosition,
): Pick<MoonPosition, 'split' | 'offset'> | null {
  const ahead = mine.percent - from.percent;
  if (mine.chapter !== from.chapter || ahead <= 0) return null;
  return { split: from.split, offset: from.offset + Math.round(ahead * CHARS_PER_PERCENT) };
}
