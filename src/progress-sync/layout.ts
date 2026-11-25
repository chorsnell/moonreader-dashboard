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
 * How far a page may be from Moon+'s own percentage and still be believed. Moon+ works its
 * percentage out from its own layout, up to about 3.5 points from KOReader's.
 */
export const PCT_TOLERANCE = 0.04;
/** How much closer the spine must come to beat the contents, for a book with no history. */
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Located {
  xp: string;
  /** exact: by Moon+'s characters; chapter: right chapter, by percentage; percent: neither. */
  method: 'exact' | 'chapter' | 'percent';
  mapping?: Mapping;
  /** Only this mapping fits, so it's worth remembering for the book. */
  decisive: boolean;
}

interface Candidate {
  mapping: Mapping;
  start: number;
  page: number;
  distance: number;
}

/**
 * The page KOReader should open for a Moon+ position. Moon+'s chapter is read both ways
 * (table of contents and spine) and its percentage says which fits. A reading is exact when
 * the chapter is long enough to hold the character and its page agrees with the percentage.
 * Failing that, the page at the percentage within a plausible chapter, and failing that, in
 * the book.
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

  const order: Mapping[] = preferred === 'spine' ? ['spine', 'toc'] : ['toc', 'spine'];
  const exact: Candidate[] = [];
  const rough: Candidate[] = [];
  // where each reading the layout can make puts the chapter, if it has that many
  const readings = new Map<Mapping, number | undefined>();
  for (const mapping of order) {
    const chapters = chapterStarts(layout, r, mapping);
    if (!chapters) continue;
    const start = chapters[position.chapter];
    readings.set(mapping, start);
    if (start === undefined) continue;
    const end = chapters![position.chapter + 1] ?? r.total;
    const first = indexAt(r.pages, start);
    const lastPage = Math.max(first, indexAt(r.pages, end - 1));
    const plausible =
      target >= layout.pages[first].pct - step - PCT_TOLERANCE &&
      target <= layout.pages[lastPage].pct + PCT_TOLERANCE;
    if (!plausible) continue;
    const into = position.split * PART_CHARS + position.offset;
    const page = indexAt(r.pages, Math.min(start + into, end - 1));
    if (start + into <= end + SLACK_CHARS && distance(page) <= PCT_TOLERANCE) {
      exact.push({ mapping, start, page, distance: distance(page) });
    } else {
      const near = clamp(byPercent, first, lastPage);
      rough.push({ mapping, start, page: near, distance: distance(near) });
    }
  }

  const found = (c: Candidate, method: Located['method'], decisive: boolean): Located => ({
    xp: layout.pages[c.page].xp,
    method,
    mapping: c.mapping,
    decisive,
  });
  if (exact.length) {
    const [first, other] = exact;
    if (other) {
      // what fitted before stands; otherwise the contents, unless the spine is clearly closer
      const closer = !preferred && other.distance < first.distance - BETTER_BY;
      return found(closer ? other : first, 'exact', false);
    }
    // decisive when the other reading names somewhere else (or nowhere) and so doesn't fit
    const disagreed = [...readings].some(([m, s]) => m !== first.mapping && s !== first.start);
    return found(first, 'exact', disagreed);
  }
  if (rough.length) return found(rough[0], 'chapter', false);
  return { xp: layout.pages[byPercent].xp, method: 'percent', decisive: false };
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
 * it would only lose Moon+'s own place within the page. Without a layout all that can be
 * written is the start of the chapter, which is never better within the same chapter.
 */
export function samePlace(
  layout: Layout | null,
  moon: MoonPosition,
  xp: string,
  mine: MoonPosition,
  preferred: Mapping | null = null,
): boolean {
  if (!layout) return moon.chapter === mine.chapter;
  const there = moonToXpointer(layout, moon, preferred);
  if (there === xp) return true;
  const fragment = xpointerFragment(xp);
  if (fragment === null) return false;
  const r = ruler(layout);
  const here = r.at({ fragment, offset: xpointerOffset(layout, xp, mine.percent / 100) });
  return there === layout.pages[indexAt(r.pages, here)].xp;
}
