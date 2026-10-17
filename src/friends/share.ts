/**
 * Share bundles: your reading data as friends get it, in one JSON document. You export one
 * from the admin page (or a follower's installation pulls it, src/federation), and a friend
 * uploads it into their dashboard, where it's kept in library/friends/<slug>/ as the same
 * books/reads/daily files the page reads for you.
 *
 * Everything in a bundle has already been through the friends privacy policy; reading one
 * in, every row is checked again, since it comes from someone else.
 */

export const BUNDLE_FORMAT = 'moonreader-dashboard/share';
export const BUNDLE_VERSION = 1;

/** The data files a bundle can carry, in the order they're written. */
export const BUNDLE_PARTS = ['books', 'reads', 'daily', 'highlights'] as const;
export type BundlePart = (typeof BUNDLE_PARTS)[number];

/** Stats a person can put on friends' leaderboards; each one is opted into on its own. */
export const LEADERBOARD_STATS = ['books', 'hours', 'words', 'streak', 'speed', 'days'] as const;
export type LeaderboardStat = (typeof LEADERBOARD_STATS)[number];

export interface BundleProfile {
  /** The name they share under. */
  name: string;
  /** When their data was built (rounded like the rest of their dates). */
  generated: string | null;
  /** The leaderboard stats they opted into. */
  leaderboards: LeaderboardStat[];
}

export type Row = Record<string, string | number | boolean | null>;

export interface ShareBundle {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  profile: BundleProfile;
  /** What their friends policy hid, so views can say why something is missing. */
  privacy: { hidden: string[]; dates: 'day' | 'week' | 'month' };
  books: Row[];
  reads: Row[];
  daily: Row[];
  highlights?: Row[];
}

/** The most rows of each part a bundle may bring in. */
export const MAX_ROWS: Record<BundlePart, number> = {
  books: 20_000,
  reads: 50_000,
  daily: 400_000,
  highlights: 50_000,
};
const MAX_KEYS = 40;
const MAX_TEXT = 2000;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** Fields a row of each part must have, as non-empty strings. */
const REQUIRED: Record<BundlePart, string[]> = {
  books: ['id', 'title'],
  reads: ['book_id', 'start'],
  daily: ['book_id', 'date'],
  highlights: ['book_id'],
};

export class BundleError extends Error {}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** A row with only plain values: short strings, finite numbers, booleans and nulls. */
export function cleanRow(raw: unknown): Row | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Row = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY.test(k) || n >= MAX_KEYS) continue;
    if (typeof v === 'string') out[k] = v.slice(0, MAX_TEXT);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean' || v === null) out[k] = v;
    else continue;
    n++;
  }
  return out;
}

function cleanRows(part: BundlePart, raw: unknown): Row[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new BundleError(`"${part}" should be a list.`);
  if (raw.length > MAX_ROWS[part]) {
    throw new BundleError(`Too many ${part} (${MAX_ROWS[part].toLocaleString('en-GB')} at most).`);
  }
  const need = REQUIRED[part];
  const out: Row[] = [];
  for (const r of raw) {
    const row = cleanRow(r);
    if (row && need.every((k) => typeof row[k] === 'string' && row[k] !== '')) out.push(row);
  }
  return out;
}

export function cleanName(v: unknown, fallback = 'A friend'): string {
  const name = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return name || fallback;
}

export function cleanStats(v: unknown): LeaderboardStat[] {
  return Array.isArray(v) ? LEADERBOARD_STATS.filter((s) => v.includes(s)) : [];
}

/** Reads a bundle someone sent, checking every part; throws a BundleError saying what's wrong. */
export function parseBundle(raw: unknown): ShareBundle {
  const o = asObject(raw);
  if (o.format !== BUNDLE_FORMAT) {
    throw new BundleError("That isn't a reading dashboard share file.");
  }
  if (o.version !== BUNDLE_VERSION) {
    throw new BundleError('That share file is from a newer version of the dashboard.');
  }
  const profile = asObject(o.profile);
  const privacy = asObject(o.privacy);
  const dates = privacy.dates === 'week' || privacy.dates === 'month' ? privacy.dates : 'day';
  const generated = typeof profile.generated === 'string' ? profile.generated.slice(0, 30) : null;
  const bundle: ShareBundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    profile: {
      name: cleanName(profile.name),
      generated,
      leaderboards: cleanStats(profile.leaderboards),
    },
    privacy: {
      hidden: Array.isArray(privacy.hidden)
        ? privacy.hidden.filter((h): h is string => typeof h === 'string').slice(0, 20)
        : [],
      dates,
    },
    books: cleanRows('books', o.books),
    reads: cleanRows('reads', o.reads),
    daily: cleanRows('daily', o.daily),
  };
  if (o.highlights !== undefined) bundle.highlights = cleanRows('highlights', o.highlights);
  if (!bundle.books.length) throw new BundleError('That share file has no books in it.');
  return bundle;
}

/** A name as a folder name: lower case letters, digits and dashes. */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'friend';
}

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
