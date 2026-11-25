/**
 * The two ways a reading position is written down, and conversions between them.
 *
 * Moon+ Reader keeps one `<book file>.po` per book in its sync folder, holding a single line:
 *
 *     1502878256645*28@0#15529:12.3%
 *
 * - `1502878256645`: when it was saved, in ms (older versions: seconds). Optional.
 * - `28`: the chapter, counted from 0. For most EPUBs this is the index of the HTML file in
 *   the spine, but Moon+ sometimes splits a file at table-of-contents entries, so it can run
 *   ahead of the spine. The percentage is what tells the two apart.
 * - `0`: the part of a chapter Moon+ split for paging. We always write 0.
 * - `15529`: characters from the start of the chapter to the top of the screen.
 * - `12.3`: how far through the book, in percent.
 *
 * KOReader's progress sync (KOSync) sends an xpointer for reflowable books, e.g.
 * `/body/DocFragment[12]/body/div/p[5]/text().57`, where DocFragment is the spine item,
 * counted from 1, and a percentage as 0..1.
 */

export interface MoonPosition {
  /** When Moon+ saved it, in ms since 1970, or null when the file has no time. */
  time: number | null;
  /** Chapter, from 0. */
  chapter: number;
  /** Moon+'s split within the chapter (usually 0). */
  split: number;
  /** Characters into the chapter. */
  offset: number;
  /** 0..100. */
  percent: number;
}

const MOON_POSITION = /(?:(\d{10,13})\*)?(\d+)@(\d+)#(\d+):(\d+(?:\.\d+)?)%/;

/** Reads a .po file's text, or null when it isn't a position. */
export function parseMoonPosition(text: string): MoonPosition | null {
  const m = MOON_POSITION.exec(text);
  if (!m) return null;
  const percent = Number(m[5]);
  if (!Number.isFinite(percent) || percent > 100) return null;
  return {
    time: m[1] ? Number(m[1]) * (m[1].length === 13 ? 1 : 1000) : null,
    chapter: Number(m[2]),
    split: Number(m[3]),
    offset: Number(m[4]),
    percent,
  };
}

/**
 * The text of a .po file, as Moon+ writes it: time in ms, one decimal place, except that a
 * finished book is "100%".
 */
export function formatMoonPosition(p: MoonPosition): string {
  const time = Math.round(p.time ?? Date.now());
  const fixed = Math.min(100, Math.max(0, p.percent)).toFixed(1);
  const percent = fixed === '100.0' ? '100' : fixed;
  return `${time}*${int(p.chapter)}@${int(p.split)}#${int(p.offset)}:${percent}%`;
}

const int = (n: number) => Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));

/** crengine leaves the index out when there is only one: "/body/DocFragment/body/…". */
const FRAGMENT = /^\/body\/DocFragment(?:\[(\d+)\])?(?=[/.]|$)/;

/** The spine item an xpointer points into, counted from 1, or null when it names none. */
export function xpointerFragment(xpointer: string): number | null {
  const m = FRAGMENT.exec(xpointer.trim());
  return m ? Number(m[1] ?? 1) : null;
}

/** An xpointer to the start of a spine item (counted from 1), which KOReader can go to. */
export function fragmentStart(fragment: number): string {
  return `/body/DocFragment[${Math.max(1, Math.floor(fragment))}]`;
}

/** Moon+'s chapter (from 0) for a spine item (from 1), when the two line up. */
export const chapterOfFragment = (fragment: number) => Math.max(0, fragment - 1);
/** The spine item (from 1) for Moon+'s chapter (from 0), when the two line up. */
export const fragmentOfChapter = (chapter: number) => chapter + 1;

/** A KOSync percentage (0..1) as Moon+'s (0..100), and back. */
export const toPercent = (fraction: number) => Math.min(100, Math.max(0, fraction * 100));
export const toFraction = (percent: number) => Math.min(1, Math.max(0, percent / 100));
