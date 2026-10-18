/**
 * Reading challenges (BOO-80): goals beyond the yearly count, set by the admin and kept in
 * settings.json under "challenges". Pure functions: the defaults and the checks on what the
 * admin page sends. The page works out progress from these (web/features/challenges.js).
 */

export const CHALLENGE_KINDS = [
  'countries',
  'decades',
  'series',
  'women',
  'streak',
  'genres',
] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];
export type ChallengePeriod = 'year' | 'all';

export interface Challenge {
  /** Stable id, a-z 0-9 and dashes. */
  id: string;
  kind: ChallengeKind;
  title: string;
  /** How many (countries, series, genres, days in a row) or the % for women. Unused for decades. */
  target: number;
  /** The backup's calendar year, or every year. */
  period: ChallengePeriod;
  /** decades only: the first and last decade, e.g. 1800 and 1920. */
  from?: number;
  to?: number;
}

export const DEFAULT_CHALLENGES: Challenge[] = [
  {
    id: 'countries',
    kind: 'countries',
    title: 'Authors from 10 countries',
    target: 10,
    period: 'year',
  },
  {
    id: 'decades',
    kind: 'decades',
    title: 'A book from every decade, 1800–1920s',
    target: 13,
    period: 'all',
    from: 1800,
    to: 1920,
  },
  { id: 'series', kind: 'series', title: 'Finish 3 series', target: 3, period: 'year' },
  { id: 'women', kind: 'women', title: '50% women authors', target: 50, period: 'year' },
  { id: 'streak', kind: 'streak', title: 'A 30-day streak', target: 30, period: 'year' },
];

export const MAX_CHALLENGES = 20;

export class ChallengeError extends Error {}

const LIMITS: Record<ChallengeKind, [number, number]> = {
  countries: [1, 200],
  decades: [1, 200],
  series: [1, 500],
  women: [1, 100],
  streak: [2, 3660],
  genres: [1, 100],
};

/**
 * Checks and tidies a list of challenges from the admin page; throws ChallengeError with a
 * message for the admin on anything it can't use.
 */
export function toChallenges(raw: unknown): Challenge[] {
  if (!Array.isArray(raw)) throw new ChallengeError('Send a list of challenges.');
  if (raw.length > MAX_CHALLENGES) {
    throw new ChallengeError(`That's more than ${MAX_CHALLENGES} challenges.`);
  }
  const ids = new Set<string>();
  return raw.map((v, i) => {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const n = `Challenge ${i + 1}`;
    const kind = o.kind as ChallengeKind;
    if (!CHALLENGE_KINDS.includes(kind)) throw new ChallengeError(`${n}: pick what it counts.`);
    const title = String(o.title ?? '')
      .trim()
      .slice(0, 80);
    if (!title) throw new ChallengeError(`${n}: give it a name.`);
    const period: ChallengePeriod = o.period === 'all' ? 'all' : 'year';
    let id = String(o.id ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (!id) id = kind;
    for (let k = 2; ids.has(id); k++) id = `${id.replace(/-\d+$/, '')}-${k}`;
    ids.add(id);
    if (kind === 'decades') {
      const from = Math.floor(Number(o.from) / 10) * 10;
      const to = Math.floor(Number(o.to) / 10) * 10;
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < -800 || to > 2100 || to < from) {
        throw new ChallengeError(`${n}: the decades must run from an earlier year to a later one.`);
      }
      if ((to - from) / 10 + 1 > LIMITS.decades[1])
        throw new ChallengeError(`${n}: that's too many decades.`);
      return { id, kind, title, target: (to - from) / 10 + 1, period, from, to };
    }
    const target = Math.round(Number(o.target));
    const [lo, hi] = LIMITS[kind];
    if (!Number.isFinite(target) || target < lo || target > hi) {
      throw new ChallengeError(`${n}: the target must be between ${lo} and ${hi}.`);
    }
    return { id, kind, title, target, period };
  });
}

/** settings.json's "challenges" section, leniently: the defaults when missing or unusable. */
export function readChallenges(section: unknown): { challenges: Challenge[]; custom: boolean } {
  if (section === undefined) return { challenges: DEFAULT_CHALLENGES, custom: false };
  try {
    return { challenges: toChallenges(section), custom: true };
  } catch {
    return { challenges: DEFAULT_CHALLENGES, custom: false };
  }
}
