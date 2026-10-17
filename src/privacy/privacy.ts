/**
 * What visitors who aren't the admin may see, and the filtering that enforces it on the data
 * files the page reads. The admin always gets the files untouched; everyone else gets a copy
 * filtered by the policy for their role (public, or signed in with the read password).
 */

export type DateGranularity = 'day' | 'week' | 'month';
export type ViewerRole = 'public' | 'reader';
export const VIEWER_ROLES: ViewerRole[] = ['public', 'reader'];

/** One role's policy. true means shown. */
export interface Policy {
  /** How precisely dates are shown: exact days, or coarsened to the week or month. */
  dates: DateGranularity;
  /** Day-by-day data: the diary, heatmaps and the reading timeline. */
  diary: boolean;
  /** What you're reading now and when you last read. */
  current: boolean;
  /** Streaks and quiet spells (they need exact days). */
  streaks: boolean;
  /** Prices and spending, once the dashboard has them. */
  money: boolean;
  /** Highlights and notes. */
  highlights: boolean;
}

export type Category = 'exact_dates' | 'diary' | 'current' | 'streaks' | 'money' | 'highlights';
export const CATEGORIES: Category[] = [
  'exact_dates',
  'diary',
  'current',
  'streaks',
  'money',
  'highlights',
];

export interface PrivacySettings {
  public: Policy;
  reader: Policy;
  /** Book ids only the admin sees in full. */
  private_books: string[];
  /** Genres (or subgenres) whose books only the admin sees in full. */
  private_genres: string[];
  /** Leave private books out, or show them as "A private book". */
  private_mode: 'hide' | 'anonymise';
}

export const PRESETS: Record<'everything' | 'no_dates' | 'taste', Policy> = {
  everything: {
    dates: 'day',
    diary: true,
    current: true,
    streaks: true,
    money: true,
    highlights: true,
  },
  /** Everything but exact dates: weeks instead of days, so no diary or streaks. */
  no_dates: {
    dates: 'week',
    diary: false,
    current: true,
    streaks: false,
    money: true,
    highlights: true,
  },
  /** Taste only: what you read and think of it, nothing about your routine. */
  taste: {
    dates: 'month',
    diary: false,
    current: false,
    streaks: false,
    money: false,
    highlights: false,
  },
};

/** Before the admin chooses: everything as before, except highlights for the public. */
export const DEFAULT_PRIVACY: PrivacySettings = {
  public: { ...PRESETS.everything, highlights: false },
  reader: { ...PRESETS.everything },
  private_books: [],
  private_genres: [],
  private_mode: 'hide',
};

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function toPolicy(raw: unknown, fallback: Policy): Policy {
  const o = asObject(raw);
  const flag = (k: keyof Policy) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : fallback[k]);
  const dates = ['day', 'week', 'month'].includes(o.dates as string)
    ? (o.dates as DateGranularity)
    : fallback.dates;
  return {
    dates,
    diary: flag('diary') as boolean,
    current: flag('current') as boolean,
    streaks: flag('streaks') as boolean,
    money: flag('money') as boolean,
    highlights: flag('highlights') as boolean,
  };
}

const strings = (v: unknown, max = 2000): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim()))]
        .map((x) => x.slice(0, 300))
        .slice(0, max)
    : [];

/** Reads privacy settings from settings.json (or a request body), filling in what's missing. */
export function toPrivacySettings(raw: unknown): PrivacySettings {
  const o = asObject(raw);
  return {
    public: toPolicy(o.public, DEFAULT_PRIVACY.public),
    reader: toPolicy(o.reader, DEFAULT_PRIVACY.reader),
    private_books: strings(o.private_books),
    private_genres: strings(o.private_genres, 200),
    private_mode: o.private_mode === 'anonymise' ? 'anonymise' : 'hide',
  };
}

/** The categories a policy hides, for the page to leave out the cards that need them. */
export function hiddenCategories(p: Policy): Category[] {
  const out: Category[] = [];
  if (p.dates !== 'day') out.push('exact_dates');
  if (!p.diary) out.push('diary');
  if (!p.current) out.push('current');
  if (!p.streaks) out.push('streaks');
  if (!p.money) out.push('money');
  if (!p.highlights) out.push('highlights');
  return out;
}

// ---------- filtering ----------

/** A book the way the filter needs it (a row of books.json). */
export interface BookFacts {
  id: string;
  genre?: string | null;
  subgenre?: string | null;
  status?: string | null;
  last_read?: string | null;
}

/** Everything the filter needs to know, worked out once per request. */
export interface FilterContext {
  policy: Policy;
  /** Private book id -> what to show instead ('' when they're left out). */
  private: Map<string, string>;
  /** Books being read now (shown as not current when the policy hides that). */
  current: Set<string>;
  /** Reading on or after this day counts as current. */
  recentFrom: string;
}

/** Books opened in this many days before the data was built count as being read now. */
export const CURRENT_DAYS = 90;
export const PRIVATE_TITLE = 'A private book';
export const PRIVATE_GENRE = 'Private';

const DAY_MS = 86_400_000;

export function buildContext(
  policy: Policy,
  settings: PrivacySettings,
  books: BookFacts[],
  asOf: string,
): FilterContext {
  const genres = new Set(settings.private_genres.map((g) => g.toLowerCase()));
  const ids = new Set(settings.private_books);
  // every book marked private, also ones not in the reading data (a priced book never opened)
  const byGenre = books
    .filter(
      (b) =>
        (b.genre && genres.has(b.genre.toLowerCase())) ||
        (b.subgenre && genres.has(b.subgenre.toLowerCase())),
    )
    .map((b) => b.id);
  const privateIds = [...new Set([...ids, ...byGenre])].sort();
  const anonymise = settings.private_mode === 'anonymise';
  const priv = new Map(privateIds.map((id, i) => [id, anonymise ? `private-${i + 1}` : '']));
  const recentFrom = new Date(Date.parse(asOf.slice(0, 10)) - CURRENT_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const current = new Set(
    books
      .filter((b) => b.status === 'in_progress' && (b.last_read ?? '') >= recentFrom)
      .map((b) => b.id),
  );
  return { policy, private: priv, current, recentFrom };
}

/** A YYYY-MM-DD date (with or without a time) as the first day of its week (Monday) or month. */
export function coarsenDate(value: string, to: DateGranularity): string {
  const day = value.slice(0, 10);
  if (to === 'day') return value;
  if (to === 'month') return `${day.slice(0, 7)}-01`;
  const t = Date.parse(day);
  if (Number.isNaN(t)) return value;
  const weekday = (new Date(t).getUTCDay() + 6) % 7; // Monday 0
  return new Date(t - weekday * DAY_MS).toISOString().slice(0, 10);
}

const DATE_KEYS = new Set([
  'date',
  'start',
  'end',
  'first_read',
  'last_read',
  'generated',
  'synced',
  'finish',
  'finished_on',
]);
const TIME_KEYS = new Set(['time']);
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}/;
const DROP = Symbol('drop');

const HIGHLIGHT_FILE = /^highlights?(_[a-z_]+)?\.json$/;
const MONEY_FILE = /^(prices|money|spending|purchases)(_[a-z_]+)?\.json$/;

/** Files never served to anyone but the admin. */
export const ADMIN_ONLY_FILES = new Set(['reading_history.json']);

function effectiveDates(name: string, p: Policy): DateGranularity {
  // streaks can be counted from exact days, so hiding them means no exact days in daily.json
  if (name === 'daily.json' && !p.streaks && p.dates === 'day') return 'week';
  return p.dates;
}

/**
 * The copy of a data file a visitor gets: null when the file isn't theirs to see at all.
 * Private books are left out or anonymised everywhere a row names one (book_id, or id in
 * books.json); dates are coarsened in every field that holds one; files of a hidden
 * category are served empty.
 */
export function filterDataFile(name: string, data: unknown, ctx: FilterContext): unknown {
  const p = ctx.policy;
  if (ADMIN_ONLY_FILES.has(name)) return null;
  const highlights = HIGHLIGHT_FILE.test(name);
  if (highlights && !p.highlights) return [];
  if (MONEY_FILE.test(name) && !p.money) return [];
  if (name === 'daily.json' && !p.diary) return [];
  const dates = effectiveDates(name, p);
  const isBooks = name === 'books.json';

  const walk = (value: unknown, depth: number): unknown => {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const v of value) {
        const w = walk(v, depth + 1);
        if (w !== DROP) out.push(w);
      }
      return out;
    }
    if (!value || typeof value !== 'object') return value;
    const o = value as Record<string, unknown>;
    const bookId =
      typeof o.book_id === 'string'
        ? o.book_id
        : isBooks && depth === 1 && typeof o.id === 'string'
          ? o.id
          : null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (DATE_KEYS.has(k) && typeof v === 'string' && DATE_VALUE.test(v)) {
        out[k] = coarsenDate(v, dates);
      } else if (TIME_KEYS.has(k) && dates !== 'day') {
        out[k] = null;
      } else {
        out[k] = walk(v, depth + 1);
      }
    }
    if (bookId !== null) {
      const alias = ctx.private.get(bookId);
      // a private book left out, and a highlight's text gives the book away
      if (alias === '' || (alias && highlights)) return DROP;
      if (!p.current && ctx.current.has(bookId)) {
        if (isBooks) Object.assign(out, { status: 'unknown', progress: null });
        else {
          const when = String(o.date ?? o.end ?? o.start ?? '');
          if (o.finished !== true && when >= ctx.recentFrom) return DROP;
        }
      }
      if (isBooks && !p.current) out.last_read = null;
      if (alias) Object.assign(out, anonymised(out, bookId, alias, isBooks));
    }
    return out;
  };

  const filtered = walk(data, 0);
  if (name === 'daily.json' && dates !== 'day' && Array.isArray(filtered)) {
    return mergeDays(filtered as Record<string, unknown>[]);
  }
  return filtered;
}

/** What an anonymised row keeps: how it was read, not what it is. */
const ANON_KEEP = new Set([
  'id',
  'book_id',
  'read_id',
  'title',
  'author',
  'series',
  'series_no',
  'genre',
  'subgenre',
  'status',
  'progress',
  'prev_progress',
  'hours',
  'minutes',
  'words',
  'times_read',
  'read_no',
  'first_read',
  'last_read',
  'start',
  'end',
  'date',
  'days_read',
  'finished',
  // what it cost (prices.json), so the totals still add up
  'price',
  'list_price',
  'paid',
  'paid_currency',
  'acquisition',
]);

function anonymised(
  row: Record<string, unknown>,
  bookId: string,
  alias: string,
  isBooks: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // anything else that could name the book (ISBNs, work ids, year, pages, the author's
  // country…) is emptied: only the reading itself is kept
  for (const k of Object.keys(row)) if (!ANON_KEEP.has(k)) out[k] = null;
  if (isBooks) out.id = alias;
  if ('book_id' in row) out.book_id = alias;
  if (typeof row.read_id === 'string') out.read_id = row.read_id.replace(bookId, alias);
  if ('title' in row) out.title = PRIVATE_TITLE;
  if ('author' in row) out.author = '';
  if ('series' in row) out.series = null;
  if ('series_no' in row) out.series_no = null;
  if ('genre' in row) out.genre = PRIVATE_GENRE;
  if ('subgenre' in row) out.subgenre = PRIVATE_GENRE;
  return out;
}

/** After coarsening, one row per book per week or month: minutes and words added up. */
function mergeDays(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const by = new Map<string, Record<string, unknown>>();
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  for (const r of rows) {
    const key = `${String(r.date)}|${String(r.book_id)}`;
    const had = by.get(key);
    if (!had) {
      by.set(key, { ...r });
      continue;
    }
    for (const k of ['minutes', 'words']) {
      const a = num(had[k]);
      const b = num(r[k]);
      had[k] = a === null && b === null ? null : (a ?? 0) + (b ?? 0);
    }
    const a = num(had.progress);
    const b = num(r.progress);
    had.progress = a === null ? b : b === null ? a : Math.max(a, b);
  }
  return [...by.values()];
}

/** The page's cover list without private books' covers. */
export function filterCovers(
  covers: Record<string, string>,
  ctx: FilterContext,
): Record<string, string> {
  return Object.fromEntries(Object.entries(covers).filter(([id]) => !ctx.private.has(id)));
}
