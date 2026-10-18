import { createHash } from 'node:crypto';
import { daysBetween } from '../common/time';

/**
 * Daily highlight review (BOO-83): a few old highlights resurfaced each day, spaced out the
 * way flashcards are. Pure functions; the state lives in library/highlight-review.json.
 */

/** The fields of data/highlights.json the review uses. */
export interface ReviewHighlight {
  id: number;
  book_id: string;
  date: string | null;
  text: string;
  note: string | null;
  kind: string;
  progress?: number | null;
}

export interface ReviewBook {
  id: string;
  title: string;
  author: string;
  genre?: string | null;
}

/** How one highlight is scheduled. */
export interface Card {
  /** Days until it comes round again after the last review. */
  interval: number;
  /** YYYY-MM-DD it's next due. */
  due: string;
  /** "never": the owner never wants to see it again. */
  never?: boolean;
  reviews: number;
  last: string | null;
}

export interface ReviewSettings {
  /** Highlights a day. */
  per_day: number;
  /** Send today's highlights through notifications (BOO-72) each morning. */
  notify: boolean;
  /** From this hour (local time, 0–23), the morning send goes out. */
  hour: number;
}

export interface ReviewState {
  settings: ReviewSettings;
  /** Key → schedule; highlights never reviewed have none. */
  cards: Record<string, Card>;
  /** Today's pick, kept so it doesn't change during the day. */
  today: { date: string; keys: string[] } | null;
  /** The day the morning send last went. */
  sent: string | null;
}

export const DEFAULT_SETTINGS: ReviewSettings = { per_day: 5, notify: false, hour: 8 };
export const EMPTY_STATE: ReviewState = {
  settings: DEFAULT_SETTINGS,
  cards: {},
  today: null,
  sent: null,
};

/** A highlight comes up for the first time once it's this many days old. */
export const MIN_AGE_DAYS = 30;
export const MAX_PER_DAY = 20;
export const ACTIONS = ['keep', 'less', 'never', 'reset'] as const;
export type Action = (typeof ACTIONS)[number];

/** [first interval, multiplier] per answer. */
const STEP: Record<'keep' | 'less', [number, number]> = { keep: [7, 2], less: [30, 4] };
/** Intervals stop growing here (about three years). */
const MAX_INTERVAL = 1000;

/**
 * A highlight's lasting key: its book and its text. Highlight ids are renumbered when the
 * data is rebuilt (imported ones come after Moon+'s), so they can't be used.
 */
export function reviewKey(h: Pick<ReviewHighlight, 'book_id' | 'text' | 'note'>): string {
  const what = (h.text || h.note || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${h.book_id}\u0000${what}`).digest('hex').slice(0, 20);
}

export function addDays(date: string, days: number): string {
  const d = new Date(Date.parse(date + 'T00:00:00Z') + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** A number from a string, the same every time. */
const hash = (s: string) => {
  let x = 2166136261;
  for (const c of s) x = Math.imul(x ^ c.codePointAt(0)!, 16777619);
  return x >>> 0;
};

/** The highlights that can be reviewed: highlights and notes in books still in the library, one per key. */
export function reviewable(
  highlights: ReviewHighlight[],
  books: ReviewBook[],
): Map<string, ReviewHighlight> {
  const ids = new Set(books.map((b) => b.id));
  const out = new Map<string, ReviewHighlight>();
  for (const h of highlights) {
    if (h.kind === 'bookmark' || !ids.has(h.book_id) || !(h.text || h.note)) continue;
    const k = reviewKey(h);
    // a passage highlighted again on a re-read: keep the first
    if (!out.has(k)) out.set(k, h);
  }
  return out;
}

/** When a highlight is due: its schedule, or MIN_AGE_DAYS after it was made. */
function dueOf(h: ReviewHighlight, card: Card | undefined): string | null {
  if (card) return card.never ? null : card.due;
  return h.date ? addDays(h.date, MIN_AGE_DAYS) : '0000-01-01';
}

/**
 * Today's highlights: the most overdue first (ties shuffled by the day), one per book
 * while there are enough books.
 */
export function pickToday(
  pool: Map<string, ReviewHighlight>,
  cards: Record<string, Card>,
  today: string,
  n: number,
): string[] {
  const due = [...pool]
    .map(([key, h]) => ({ key, h, due: dueOf(h, cards[key]) }))
    .filter((x): x is { key: string; h: ReviewHighlight; due: string } => !!x.due && x.due <= today)
    .sort(
      (a, b) => a.due.localeCompare(b.due) || hash(`${today}#${a.key}`) - hash(`${today}#${b.key}`),
    );
  const picked: string[] = [];
  const books = new Set<string>();
  for (const x of due) {
    if (picked.length >= n) break;
    if (books.has(x.h.book_id)) continue;
    picked.push(x.key);
    books.add(x.h.book_id);
  }
  for (const x of due) {
    if (picked.length >= n) break;
    if (!picked.includes(x.key)) picked.push(x.key);
  }
  return picked;
}

/** Today's pick, made once a day and kept; keys no longer in the pool drop out. */
export function today(
  state: ReviewState,
  pool: Map<string, ReviewHighlight>,
  date: string,
): { state: ReviewState; keys: string[] } {
  if (state.today?.date === date) {
    return { state, keys: state.today.keys.filter((k) => pool.has(k)) };
  }
  const keys = pickToday(pool, state.cards, date, state.settings.per_day);
  return { state: { ...state, today: { date, keys } }, keys };
}

/** The schedule after an answer. */
export function answer(card: Card | undefined, action: Action, date: string): Card | undefined {
  if (action === 'reset') return undefined;
  const reviews = (card?.reviews ?? 0) + 1;
  if (action === 'never') {
    return {
      interval: card?.interval ?? 0,
      due: card?.due ?? date,
      never: true,
      reviews,
      last: date,
    };
  }
  const [first, times] = STEP[action];
  const interval = Math.min(
    MAX_INTERVAL,
    card && !card.never && card.interval > 0
      ? Math.max(first, Math.round(card.interval * times))
      : first,
  );
  return { interval, due: addDays(date, interval), reviews, last: date };
}

export function toSettings(raw: unknown, base: ReviewSettings = DEFAULT_SETTINGS): ReviewSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const int = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d;
  return {
    per_day: int(o.per_day, 1, MAX_PER_DAY, base.per_day),
    notify: typeof o.notify === 'boolean' ? o.notify : base.notify,
    hour: int(o.hour, 0, 23, base.hour),
  };
}

export function toState(raw: unknown): ReviewState {
  if (!raw || typeof raw !== 'object') return EMPTY_STATE;
  const o = raw as Partial<ReviewState>;
  const cards: Record<string, Card> = {};
  for (const [k, c] of Object.entries(o.cards ?? {})) {
    if (c && typeof c.due === 'string' && typeof c.interval === 'number') cards[k] = c;
  }
  const t = o.today;
  return {
    settings: toSettings(o.settings),
    cards,
    today:
      t && typeof t.date === 'string' && Array.isArray(t.keys)
        ? { date: t.date, keys: t.keys.filter((k) => typeof k === 'string') }
        : null,
    sent: typeof o.sent === 'string' ? o.sent : null,
  };
}

/** How the review stands: for the admin section. */
export function summary(state: ReviewState, pool: Map<string, ReviewHighlight>, date: string) {
  let never = 0;
  let scheduled = 0;
  let due = 0;
  for (const [k, h] of pool) {
    const c = state.cards[k];
    if (c?.never) never++;
    else if (c) scheduled++;
    const d = dueOf(h, c);
    if (d && d <= date) due++;
  }
  return { highlights: pool.size, reviewed: scheduled + never, never, due };
}

/** "in 2 weeks", for the page after an answer. */
export function inWords(from: string, to: string): string {
  const d = daysBetween(from, to);
  if (d < 14) return `in ${d} day${d === 1 ? '' : 's'}`;
  if (d < 60) return `in ${Math.round(d / 7)} weeks`;
  if (d < 730) return `in ${Math.round(d / 30.4)} months`;
  return `in ${Math.round(d / 365)} years`;
}

// ---------- Anki ----------

const ankiField = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, '<br>');
const tag = (s: string) =>
  s
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');

/**
 * A tab-separated file Anki imports (File → Import): front is the passage, back the note and
 * where it's from, then tags. Never-again highlights are left out.
 */
export function ankiText(
  pool: Map<string, ReviewHighlight>,
  books: ReviewBook[],
  cards: Record<string, Card> = {},
): string {
  const byId = new Map(books.map((b) => [b.id, b]));
  const lines = ['#separator:tab', '#html:true', '#tags column:3'];
  const rows = [...pool]
    .filter(([k]) => !cards[k]?.never)
    .map(([, h]) => ({ h, b: byId.get(h.book_id)! }))
    .sort(
      (x, y) => x.b.title.localeCompare(y.b.title) || (x.h.progress ?? 1e9) - (y.h.progress ?? 1e9),
    );
  for (const { h, b } of rows) {
    const front = ankiField(h.text || h.note || '');
    const back = [
      h.text && h.note ? `<i>${ankiField(h.note)}</i>` : '',
      `${ankiField(b.title)} — ${ankiField(b.author)}`,
    ]
      .filter(Boolean)
      .join('<br><br>');
    const tags = ['highlights', tag(b.title), tag(b.author), b.genre ? tag(b.genre) : '']
      .filter(Boolean)
      .join(' ');
    lines.push([front, back, tags].join('\t'));
  }
  return lines.join('\n') + '\n';
}
