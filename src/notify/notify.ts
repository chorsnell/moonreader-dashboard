/**
 * Notifications (BOO-72): events sent to the owner's own channels (ntfy, Gotify, Discord or
 * any webhook). The events are found by comparing what was already notified (kept in
 * library/notify-state.json) with the data after each rebuild, so a restart or a second
 * rebuild of the same backup never sends anything twice.
 */
import { randomBytes } from 'node:crypto';
import { bookKeys } from '../clubs/clubs';

// ---------- events ----------

/** Something to tell the owner. Anything may send one through NotifierService.send. */
export interface NotifyEvent {
  /** What it is, e.g. book_finished; the admin can switch each kind off. */
  kind: string;
  title: string;
  message: string;
  /** Where tapping it goes: an absolute URL, e.g. a book's page. */
  url?: string | null;
  /** Short words or emoji names (ntfy shows them as emoji). */
  tags?: string[];
  priority?: 'low' | 'default' | 'high';
  /** Anything else, for webhooks. */
  data?: Record<string, unknown>;
}

/** The kinds of event, with their label in admin. Other features may add theirs here. */
export const NOTIFY_EVENTS: { kind: string; label: string; note: string }[] = [
  {
    kind: 'book_finished',
    label: 'Book finished',
    note: 'When a sync brings in a book you finished.',
  },
  {
    kind: 'new_record',
    label: 'New personal record',
    note: 'A longer streak, a bigger day or week, a faster book…',
  },
  {
    kind: 'streak_at_risk',
    label: 'Streak at risk',
    note: 'In the evening, when nothing has been synced today and you have a streak going.',
  },
  {
    kind: 'year_goal',
    label: 'Year goal reached',
    note: 'When you finish as many books this year as your goal.',
  },
  {
    kind: 'friend_finished',
    label: 'A friend finished a book you have',
    note: 'When a friend finishes a book that is in your library too.',
  },
];

// ---------- channels and settings ----------

export const CHANNEL_TYPES = ['ntfy', 'gotify', 'discord', 'webhook'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  /** ntfy: the topic URL; Gotify: the server; Discord and webhooks: the webhook URL. Secret. */
  url: string;
  /** ntfy access token, Gotify app token or a webhook's bearer token. Secret. */
  token: string;
}

export interface NotifySettings {
  channels: Channel[];
  /** kind -> on; a kind not listed is on. */
  events: Record<string, boolean>;
  /** "Streak at risk" is sent from this hour (local time, 0–23)… */
  streak_hour: number;
  /** …when the streak is at least this many days. */
  streak_min: number;
  /** Books to finish this year, or null for no goal. */
  year_goal: number | null;
}

export const DEFAULT_NOTIFY: NotifySettings = {
  channels: [],
  events: {},
  streak_hour: 21,
  streak_min: 3,
  year_goal: null,
};

export const MAX_CHANNELS = 10;
export const KIND = /^[a-z][a-z0-9_]{0,39}$/;

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intIn = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
};

export class NotifyError extends Error {}

/** An http(s) URL with no spaces, or null. */
export function cleanUrl(raw: unknown): string | null {
  const s = text(raw, 1000);
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:'
      ? u.toString().replace(/\/$/, '')
      : null;
  } catch {
    return null;
  }
}

/** The settings from settings.json's "notify" section, filling in what's missing. */
export function toNotifySettings(raw: unknown): NotifySettings {
  const o = asObject(raw);
  const channels = (Array.isArray(o.channels) ? o.channels : [])
    .map((c) => asObject(c))
    .filter((c) => CHANNEL_TYPES.includes(c.type as ChannelType) && cleanUrl(c.url))
    .slice(0, MAX_CHANNELS)
    .map((c) => ({
      id: text(c.id, 20) || newChannelId(),
      type: c.type as ChannelType,
      name: text(c.name, 60),
      url: cleanUrl(c.url)!,
      token: text(c.token, 500),
    }));
  const events: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(asObject(o.events))) {
    if (KIND.test(k) && typeof v === 'boolean') events[k] = v;
  }
  const goal = Number(o.year_goal);
  return {
    channels,
    events,
    streak_hour: intIn(o.streak_hour, 0, 23, DEFAULT_NOTIFY.streak_hour),
    streak_min: intIn(o.streak_min, 1, 365, DEFAULT_NOTIFY.streak_min),
    year_goal: Number.isInteger(goal) && goal > 0 && goal <= 10_000 ? goal : null,
  };
}

/** A new channel from the admin's request: {type, name?, url, token?}. */
export function toChannel(body: unknown): Channel {
  const o = asObject(body);
  if (!CHANNEL_TYPES.includes(o.type as ChannelType)) {
    throw new NotifyError('Choose ntfy, Gotify, Discord or a webhook.');
  }
  const url = cleanUrl(o.url);
  if (!url) throw new NotifyError('The address must start with http:// or https://.');
  const type = o.type as ChannelType;
  if (type === 'gotify' && !text(o.token, 500)) {
    throw new NotifyError('Gotify needs an application token.');
  }
  if (type === 'ntfy' && new URL(url).pathname.split('/').filter(Boolean).length < 1) {
    throw new NotifyError('Give the topic’s address, e.g. https://ntfy.sh/my-reading.');
  }
  return {
    id: newChannelId(),
    type,
    name: text(o.name, 60) || LABELS[type],
    url,
    token: text(o.token, 500),
  };
}

const LABELS: Record<ChannelType, string> = {
  ntfy: 'ntfy',
  gotify: 'Gotify',
  discord: 'Discord',
  webhook: 'Webhook',
};

export const newChannelId = () => randomBytes(6).toString('base64url');

/** Settings as the admin page gets them: no URLs or tokens, only where each channel goes. */
export function publicSettings(s: NotifySettings) {
  return {
    channels: s.channels.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      host: new URL(c.url).host,
      has_token: !!c.token,
    })),
    events: Object.fromEntries(
      NOTIFY_EVENTS.map((e) => [e.kind, s.events[e.kind] !== false]).concat(
        Object.entries(s.events).filter(([k]) => !NOTIFY_EVENTS.some((e) => e.kind === k)),
      ),
    ),
    kinds: NOTIFY_EVENTS,
    streak_hour: s.streak_hour,
    streak_min: s.streak_min,
    year_goal: s.year_goal,
  };
}

/** {events, streak_hour, streak_min, year_goal} from the admin, onto the current settings. */
export function withOptions(s: NotifySettings, body: unknown): NotifySettings {
  const o = asObject(body);
  const events = { ...s.events };
  for (const [k, v] of Object.entries(asObject(o.events))) {
    if (KIND.test(k) && typeof v === 'boolean') events[k] = v;
  }
  const goal = o.year_goal === null || o.year_goal === '' ? null : Number(o.year_goal);
  return toNotifySettings({
    ...s,
    events,
    streak_hour: o.streak_hour ?? s.streak_hour,
    streak_min: o.streak_min ?? s.streak_min,
    year_goal: o.year_goal === undefined ? s.year_goal : goal,
  });
}

// ---------- sending ----------

export interface Request {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const NTFY_PRIORITY = { low: 2, default: 3, high: 4 } as const;
const GOTIFY_PRIORITY = { low: 2, default: 5, high: 8 } as const;

/** The HTTP request that delivers an event to a channel. */
export function requestFor(c: Channel, e: NotifyEvent, time: string): Request {
  const json = { 'Content-Type': 'application/json' };
  const bearer: Record<string, string> = c.token ? { Authorization: `Bearer ${c.token}` } : {};
  const priority = e.priority ?? 'default';
  if (c.type === 'ntfy') {
    // JSON publishing to the server's root, so titles needn't fit in an ASCII header
    const u = new URL(c.url);
    const parts = u.pathname.split('/').filter(Boolean);
    const topic = parts.pop() ?? '';
    u.pathname = `/${parts.join('/')}`;
    return {
      url: u.toString(),
      headers: { ...json, ...bearer },
      body: JSON.stringify({
        topic,
        title: e.title,
        message: e.message,
        tags: e.tags ?? [],
        priority: NTFY_PRIORITY[priority],
        ...(e.url ? { click: e.url } : {}),
      }),
    };
  }
  if (c.type === 'gotify') {
    return {
      url: `${c.url}/message`,
      headers: { ...json, 'X-Gotify-Key': c.token },
      body: JSON.stringify({
        title: e.title,
        message: e.message,
        priority: GOTIFY_PRIORITY[priority],
        ...(e.url ? { extras: { 'client::notification': { click: { url: e.url } } } } : {}),
      }),
    };
  }
  if (c.type === 'discord') {
    return {
      url: c.url,
      headers: json,
      body: JSON.stringify({
        username: 'Reading history',
        embeds: [
          {
            title: e.title.slice(0, 256),
            description: e.message.slice(0, 4000),
            ...(e.url ? { url: e.url } : {}),
            timestamp: new Date(time).toISOString(),
          },
        ],
      }),
    };
  }
  return {
    url: c.url,
    headers: { ...json, ...bearer },
    body: JSON.stringify({
      event: e.kind,
      title: e.title,
      message: e.message,
      url: e.url ?? null,
      tags: e.tags ?? [],
      priority,
      data: e.data ?? {},
      time,
    }),
  };
}

// ---------- finding events ----------

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What was notified already. */
export interface NotifyState {
  /** read_ids of finished reads. */
  finished: string[];
  /** record id -> its value. */
  records: Record<string, number>;
  /** friend slug -> keys of their finished reads. */
  friends: Record<string, string[]>;
  /** "<year>:<goal>" once that goal was reached. */
  goals: string[];
  /** The last day "streak at risk" was sent. */
  streak_warned: string | null;
  updated: string | null;
}

export const EMPTY_STATE: NotifyState = {
  finished: [],
  records: {},
  friends: {},
  goals: [],
  streak_warned: null,
  updated: null,
};

export function toState(raw: unknown): NotifyState | null {
  const o = asObject(raw);
  if (!Array.isArray(o.finished)) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    finished: strings(o.finished),
    records: Object.fromEntries(
      Object.entries(asObject(o.records)).filter(([, v]) => typeof v === 'number'),
    ) as Record<string, number>,
    friends: Object.fromEntries(
      Object.entries(asObject(o.friends)).map(([k, v]) => [k, strings(v)]),
    ),
    goals: strings(o.goals),
    streak_warned: typeof o.streak_warned === 'string' ? o.streak_warned : null,
    updated: typeof o.updated === 'string' ? o.updated : null,
  };
}

/** A personal record as the records calc gives it. */
export interface RecordRow {
  id: string;
  label: string;
  unit: string;
  lower_better: boolean;
  value: number;
  date: string;
  title?: string | null;
  book_id?: string | null;
  prev_value?: number | null;
}

export interface FriendReads {
  slug: string;
  name: string;
  reads: Row[];
  books: Row[];
}

/** Everything the events are found in. */
export interface Snapshot {
  /** Today, local time. */
  today: string;
  /** Your finished reads (private books already named as such). */
  reads: Row[];
  /** Your books, to match friends' against. */
  books: Row[];
  records: RecordRow[];
  friends: FriendReads[];
  /** Private book ids: never named. */
  private: Set<string>;
  /** The dashboard's address (ending in /), or null when it isn't known (no PUBLIC_URL). */
  home: string | null;
}

/** Only things that happened this recently are news: an old import is not. */
export const NEWS_DAYS = 14;
/** More finishes than this at once go in one message. */
export const DIGEST_OVER = 5;

const DAY_MS = 86_400_000;
const daysAgo = (date: string, today: string) =>
  Math.round((Date.parse(today) - Date.parse(date.slice(0, 10))) / DAY_MS);

/** Formats a record's value the way the Records card does. */
export function recordText(r: Pick<RecordRow, 'unit' | 'value'>): string {
  const v = r.value;
  if (r.unit === 'minutes') {
    return v >= 60 ? `${Math.floor(v / 60)} h ${Math.round(v % 60)} min` : `${Math.round(v)} min`;
  }
  const n = (x: number) => x.toLocaleString('en-GB');
  if (r.unit === 'days') return `${n(v)} ${v === 1 ? 'day' : 'days'}`;
  if (r.unit === 'books') return `${n(v)} ${v === 1 ? 'book' : 'books'}`;
  if (r.unit === 'hours') return `${n(v)} h`;
  return `${n(v)} ${r.unit}`;
}

const better = (r: RecordRow, before: number) =>
  r.lower_better ? r.value < before : r.value > before;

const nameOf = (r: Row, priv: Set<string>) =>
  priv.has(str(r.book_id)) ? 'a private book' : str(r.title) || 'a book';

/**
 * The events since `prev`, and what to remember. With no `prev` (the first run, or after the
 * state was lost) everything is taken as already notified, so nothing old is sent.
 */
export function detect(
  prev: NotifyState | null,
  snap: Snapshot,
  goal: number | null,
): { events: NotifyEvent[]; next: NotifyState } {
  const events: NotifyEvent[] = [];
  const first = prev === null;
  const was = prev ?? EMPTY_STATE;
  const priv = snap.private;
  const at = (hash: string) => (snap.home ? `${snap.home}#${hash}` : null);
  const link = (id: string) => at(`book/${encodeURIComponent(id)}`);

  // books finished
  const finished = snap.reads.filter((r) => r.finished === true && str(r.read_id) && str(r.end));
  const seen = new Set(was.finished);
  const fresh = finished
    .filter((r) => !seen.has(str(r.read_id)) && daysAgo(str(r.end), snap.today) <= NEWS_DAYS)
    .sort((a, b) => (str(a.end) < str(b.end) ? -1 : 1));
  if (!first && fresh.length > DIGEST_OVER) {
    events.push({
      kind: 'book_finished',
      title: `${fresh.length} books finished`,
      message: fresh
        .map(
          (r) =>
            `${nameOf(r, priv)}${priv.has(str(r.book_id)) ? '' : str(r.author) ? `, ${str(r.author)}` : ''}`,
        )
        .join('\n'),
      tags: ['books'],
      data: { count: fresh.length },
    });
  } else if (!first) {
    for (const r of fresh) {
      const hidden = priv.has(str(r.book_id));
      const hours = num(r.hours);
      const days = num(r.days_read);
      const rn = num(r.read_no);
      events.push({
        kind: 'book_finished',
        title: hidden ? 'Finished a private book' : `Finished ${str(r.title) || 'a book'}`,
        message: hidden
          ? 'Another one done.'
          : [
              str(r.author) && `by ${str(r.author)}`,
              hours !== null &&
                `${hours} hours${days ? ` over ${days} day${days === 1 ? '' : 's'}` : ''}`,
              rn && rn > 1 && `your read number ${rn}`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Another one done.',
        url: hidden ? null : link(str(r.book_id)),
        tags: ['books'],
        data: hidden
          ? {}
          : {
              book_id: r.book_id,
              read_id: r.read_id,
              title: r.title,
              author: r.author,
              end: r.end,
            },
      });
    }
  }

  // personal records: better than what was notified, and set lately
  const records: Record<string, number> = {};
  for (const r of snap.records) {
    records[r.id] = r.value;
    const before = was.records[r.id];
    if (first || before === undefined || !better(r, before)) continue;
    if (daysAgo(r.date, snap.today) > NEWS_DAYS) continue;
    const book = r.book_id ? (priv.has(r.book_id) ? 'a private book' : r.title) : null;
    events.push({
      kind: 'new_record',
      title: `New record: ${r.label.toLowerCase()}`,
      message: `${recordText(r)}${book ? ` (${book})` : ''}, beating ${recordText({ ...r, value: before })}.`,
      url: r.book_id && !priv.has(r.book_id) ? link(r.book_id) : null,
      tags: ['trophy'],
      data: { record: r.id, value: r.value, previous: before },
    });
  }

  // the year goal
  const goals = [...was.goals];
  const year = snap.today.slice(0, 4);
  if (goal) {
    const key = `${year}:${goal}`;
    const done = finished.filter((r) => str(r.end).startsWith(year)).length;
    if (done >= goal && !goals.includes(key)) {
      goals.push(key);
      if (!first) {
        events.push({
          kind: 'year_goal',
          title: `Year goal reached: ${goal} ${goal === 1 ? 'book' : 'books'}`,
          message: `You've finished ${done} ${done === 1 ? 'book' : 'books'} in ${year}.`,
          url: at(`year/${year}`),
          tags: ['tada'],
          priority: 'high',
          data: { year: Number(year), goal, finished: done },
        });
      }
    }
  }

  // friends finishing a book that's in your library too
  const friends: Record<string, string[]> = {};
  const mine = new Map<string, Row>();
  for (const b of snap.books) for (const k of bookKeys(b)) if (!mine.has(k)) mine.set(k, b);
  for (const f of snap.friends) {
    const books = new Map(f.books.map((b) => [str(b.id), b]));
    const done = f.reads.filter((r) => r.finished === true && str(r.end));
    const keyOf = (r: Row) => str(r.read_id) || `${str(r.book_id)}@${str(r.end)}`;
    friends[f.slug] = done.map(keyOf);
    const had = was.friends[f.slug];
    if (first || !had) continue; // someone new: what they'd read before isn't news
    const old = new Set(had);
    for (const r of done) {
      if (old.has(keyOf(r)) || daysAgo(str(r.end), snap.today) > NEWS_DAYS) continue;
      const theirs = books.get(str(r.book_id)) ?? r;
      const match = bookKeys(theirs)
        .map((k) => mine.get(k))
        .find(Boolean);
      if (!match || priv.has(str(match.id))) continue;
      events.push({
        kind: 'friend_finished',
        title: `${f.name} finished ${str(match.title) || str(r.title)}`,
        message:
          match.status === 'finished'
            ? `You've read it too.`
            : match.status === 'in_progress'
              ? `You're reading it too${num(match.progress) !== null ? ` (${Math.round(num(match.progress)!)}%)` : ''}.`
              : `It's in your library too.`,
        url: link(str(match.id)),
        tags: ['busts_in_silhouette'],
        data: { friend: f.slug, book_id: match.id, title: match.title },
      });
    }
  }

  return {
    events,
    next: {
      finished: finished.map((r) => str(r.read_id)),
      records,
      friends,
      goals: goals.filter((g) => g >= `${Number(year) - 1}:`),
      streak_warned: was.streak_warned,
      updated: null,
    },
  };
}

// ---------- streaks ----------

const addDays = (d: string, n: number) =>
  new Date(Date.parse(d) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The run of consecutive reading days ending today or yesterday, as of `today`:
 * `{days, read_today}`; days is 0 when the last reading day was before yesterday.
 */
export function currentStreak(
  daily: Row[],
  today: string,
): { days: number; read_today: boolean; last: string | null } {
  const days = new Set(
    daily
      .filter((d) => (num(d.minutes) ?? 0) > 0 || (num(d.words) ?? 0) > 0)
      .map((d) => str(d.date).slice(0, 10)),
  );
  const last = [...days].sort().pop() ?? null;
  const readToday = days.has(today);
  let day = readToday ? today : addDays(today, -1);
  let n = 0;
  while (days.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return { days: n, read_today: readToday, last };
}

/** "Streak at risk", when it's time to send it, or null. */
export function streakWarning(
  daily: Row[],
  now: { date: string; hour: number },
  s: Pick<NotifySettings, 'streak_hour' | 'streak_min'>,
  warned: string | null,
): NotifyEvent | null {
  if (now.hour < s.streak_hour || warned === now.date) return null;
  const st = currentStreak(daily, now.date);
  if (st.read_today || st.days < s.streak_min) return null;
  return {
    kind: 'streak_at_risk',
    title: `Your ${st.days}-day streak is at risk`,
    message: `Nothing's been synced today. Read a few pages (and sync) before midnight to keep it going.`,
    tags: ['fire'],
    priority: 'high',
    data: { streak: st.days, last_read: st.last },
  };
}
