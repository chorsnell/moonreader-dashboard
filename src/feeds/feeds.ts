/**
 * Feeds (BOO-74): an Atom feed of finished books and an iCal feed of reading days, finishes
 * and book club check-ins, each at its own secret URL. A feed belongs to an audience (the
 * public, read-password visitors or friends) and is built from the data files exactly as
 * that audience is served them, so it never says more than their /data/* would.
 *
 * The secret is in the URL (feed readers and calendar apps can't sign in), so it's stored
 * hashed like federation tokens, shown once, and can be rotated or revoked.
 */
import { randomBytes } from 'node:crypto';
import type { ViewerRole } from '../privacy/privacy';

export type FeedKind = 'atom' | 'ical';
export const FEED_KINDS: FeedKind[] = ['atom', 'ical'];
export const FEED_EXT: Record<FeedKind, string> = { atom: 'atom', ical: 'ics' };

export interface Feed {
  id: string;
  kind: FeedKind;
  /** Whose privacy settings filter it. Never the admin's "everything": a URL leaks easily. */
  audience: ViewerRole;
  name: string;
  /** sha256 of the secret in the URL. */
  token_hash: string;
  created: string;
  rotated: string | null;
  last_used: string | null;
}

export interface FeedsFile {
  feeds: Feed[];
}

export const MAX_FEEDS = 20;
/** How many finished books the Atom feed lists. */
export const ATOM_ENTRIES = 50;
/** How far back the calendar's reading days go. */
export const ICAL_DAYS = 400;

export const newFeedId = () => randomBytes(6).toString('base64url');

export class FeedError extends Error {}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** {kind, audience, name} from the admin's request. */
export function toFeedInput(body: unknown): Pick<Feed, 'kind' | 'audience' | 'name'> {
  const o = asObject(body);
  if (!FEED_KINDS.includes(o.kind as FeedKind)) {
    throw new FeedError('Choose Atom (finished books) or iCal (a calendar).');
  }
  const audience = o.audience === 'reader' || o.audience === 'friends' ? o.audience : 'public';
  const kind = o.kind as FeedKind;
  const name =
    (typeof o.name === 'string' ? o.name.trim().slice(0, 60) : '') ||
    (kind === 'atom' ? 'Finished books' : 'Reading calendar');
  return { kind, audience, name };
}

/** A feed without its hash, for the admin page. */
export function publicFeed(f: Feed) {
  return {
    id: f.id,
    kind: f.kind,
    audience: f.audience,
    name: f.name,
    created: f.created,
    rotated: f.rotated,
    last_used: f.last_used,
  };
}

/** The path of a feed's URL, relative to the dashboard. */
export const feedPath = (kind: FeedKind, token: string) => `feeds/${token}.${FEED_EXT[kind]}`;

// ---------- the rows they're built from ----------

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Rows standing in for a private book ("A private book"): no use in a feed. */
const isAnonymised = (r: Row) => str(r.book_id ?? r.id).startsWith('private-');

export interface FeedData {
  books: Row[];
  reads: Row[];
  daily: Row[];
  /** What the audience's dates are rounded to. */
  dates: 'day' | 'week' | 'month';
  /** Whether day-by-day reading (diary and streaks at exact days) may be shown. */
  days: boolean;
  /** {book id: cover path} for the covers they may see. */
  covers: Record<string, string>;
  /** meta.json's generated, local time. */
  generated: string | null;
}

export interface FeedContext {
  /** The feed's own absolute URL. */
  self: string;
  /** The dashboard's absolute URL, ending in a slash. */
  home: string;
  /** A cover's absolute URL from its path (covers/x.jpg?v=1), through the feed's own secret. */
  cover: (path: string) => string;
  title: string;
}

// ---------- Atom ----------

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A local YYYY-MM-DD[THH:MM[:SS]] as an RFC 3339 time (taken as UTC: Atom wants a zone). */
function rfc3339(local: string): string {
  const d = local.slice(0, 10);
  const t = /T(\d{2}:\d{2})(:\d{2})?/.exec(local);
  return `${d}T${t ? `${t[1]}${t[2] ?? ':00'}` : '12:00:00'}Z`;
}

const stars = (r: number) => '★'.repeat(Math.round(r)) + '☆'.repeat(Math.max(0, 5 - Math.round(r)));

/** The finished books, newest first: what the Atom feed lists. */
export function finishedReads(data: FeedData, limit = ATOM_ENTRIES): Row[] {
  return data.reads
    .filter((r) => r.finished === true && str(r.end) && !isAnonymised(r))
    .sort((a, b) => (str(a.end) < str(b.end) ? 1 : str(a.end) > str(b.end) ? -1 : 0))
    .slice(0, limit);
}

export function buildAtom(data: FeedData, ctx: FeedContext): string {
  const books = new Map(data.books.map((b) => [str(b.id), b]));
  const reads = finishedReads(data);
  const updated = rfc3339(data.generated ?? str(reads[0]?.end) ?? '1970-01-01');
  const when = (d: string) =>
    data.dates === 'month'
      ? `in ${d.slice(0, 7)}`
      : data.dates === 'week'
        ? `in the week of ${d}`
        : `on ${d}`;
  const entries = reads.map((r) => {
    const id = str(r.book_id);
    const book = books.get(id) ?? {};
    const title = str(r.title) || str(book.title) || 'Untitled';
    const author = str(r.author) || str(book.author);
    const link = `${ctx.home}#book/${encodeURIComponent(id)}`;
    const rating = num(book.rating);
    const hours = num(r.hours);
    const days = num(r.days_read);
    const facts = [
      author && `by ${author}`,
      str(r.series) && `${str(r.series)}${num(r.series_no) ? ` #${num(r.series_no)}` : ''}`,
      str(r.genre),
      hours !== null && `${hours} hours${days ? ` over ${days} day${days === 1 ? '' : 's'}` : ''}`,
      num(r.read_no) && (r.read_no as number) > 1 && `read ${String(r.read_no)} times`,
    ].filter(Boolean) as string[];
    const cover = data.covers[id];
    const html = [
      cover ? `<p><img src="${escapeXml(ctx.cover(cover))}" alt="" width="180"></p>` : '',
      `<p>Finished ${escapeXml(when(str(r.end)))}.</p>`,
      rating !== null && rating > 0
        ? `<p>Rated ${escapeXml(stars(rating))} (${rating} of 5)</p>`
        : '',
      facts.length ? `<p>${escapeXml(facts.join(' · '))}</p>` : '',
    ].join('');
    return [
      '  <entry>',
      `    <id>urn:moonreader-dashboard:read:${escapeXml(str(r.read_id) || id)}</id>`,
      `    <title>${escapeXml(author ? `${title}, ${author}` : title)}</title>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(link)}"/>`,
      `    <updated>${rfc3339(str(r.end))}</updated>`,
      author ? `    <author><name>${escapeXml(author)}</name></author>` : '',
      str(r.genre) ? `    <category term="${escapeXml(str(r.genre))}"/>` : '',
      `    <content type="html">${escapeXml(html)}</content>`,
      '  </entry>',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(ctx.self.replace(/\/feeds\/[^/]+$/, '/feeds'))}#finished</id>`,
    `  <title>${escapeXml(ctx.title)}</title>`,
    '  <subtitle>Books finished</subtitle>',
    `  <updated>${updated}</updated>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(ctx.self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(ctx.home)}"/>`,
    '  <generator>moonreader-dashboard</generator>',
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}

// ---------- iCal ----------

/** A book club as the calendar needs it. */
export interface ClubDates {
  id: string;
  title: string;
  author: string;
  start: string;
  pct_per_week: number | null;
  members: number;
}

export interface CalEvent {
  uid: string;
  /** YYYY-MM-DD, all day. */
  start: string;
  /** The day after the last one (iCal's DTEND is exclusive). */
  end: string;
  summary: string;
  description?: string;
  url?: string;
  categories?: string;
}

const DAY_MS = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(d) + n * DAY_MS).toISOString().slice(0, 10);
const validDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** "1 h 5 min", "45 min". */
function minutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}

/** Every event the calendar holds, from data the audience may see. */
export function calendarEvents(
  data: FeedData,
  clubs: ClubDates[],
  ctx: Pick<FeedContext, 'home'>,
  today: string,
): CalEvent[] {
  const out: CalEvent[] = [];
  const link = (id: string) => `${ctx.home}#book/${encodeURIComponent(id)}`;

  // reading days: only when the audience gets exact days, the diary and streaks
  if (data.days && data.dates === 'day') {
    const from = addDays(today, -ICAL_DAYS);
    const byDay = new Map<string, { minutes: number; titles: string[] }>();
    for (const d of data.daily) {
      const date = str(d.date).slice(0, 10);
      if (!validDay(date) || date < from || isAnonymised(d)) continue;
      const day = byDay.get(date) ?? { minutes: 0, titles: [] };
      day.minutes += num(d.minutes) ?? 0;
      const t = str(d.title);
      if (t && !day.titles.includes(t)) day.titles.push(t);
      byDay.set(date, day);
    }
    for (const [date, day] of [...byDay].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (day.minutes <= 0 && !day.titles.length) continue;
      out.push({
        uid: `day-${date}`,
        start: date,
        end: addDays(date, 1),
        summary: day.minutes > 0 ? `Read ${minutes(day.minutes)}` : 'Read',
        description: day.titles.join('\n'),
        categories: 'Reading',
      });
    }
  }

  // finishes: on the day, or across the week or month the audience's dates are rounded to
  for (const r of data.reads) {
    const end = str(r.end).slice(0, 10);
    if (r.finished !== true || !validDay(end) || isAnonymised(r)) continue;
    const span =
      data.dates === 'month'
        ? Math.round(
            (Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 1) - Date.parse(end)) /
              DAY_MS,
          )
        : data.dates === 'week'
          ? 7
          : 1;
    const author = str(r.author);
    out.push({
      uid: `finish-${str(r.read_id) || str(r.book_id)}`,
      start: end,
      end: addDays(end, span),
      summary: `Finished ${str(r.title) || 'a book'}`,
      description: [author && `by ${author}`, num(r.hours) !== null && `${num(r.hours)} hours`]
        .filter(Boolean)
        .join('\n'),
      url: str(r.book_id) ? link(str(r.book_id)) : undefined,
      categories: 'Finished',
    });
  }

  // book clubs: the start, a check-in each week of the schedule, and the planned finish
  for (const c of clubs) {
    if (!validDay(c.start)) continue;
    const what = `${c.title}${c.author ? ` (${c.author})` : ''}`;
    const people = `${c.members} reader${c.members === 1 ? '' : 's'}`;
    out.push({
      uid: `club-${c.id}-start`,
      start: c.start,
      end: addDays(c.start, 1),
      summary: `Book club starts: ${c.title}`,
      description: `${what}, ${people}.`,
      categories: 'Book club',
    });
    if (!c.pct_per_week || c.pct_per_week <= 0) continue;
    const weeks = Math.ceil(100 / c.pct_per_week);
    for (let w = 1; w <= Math.min(weeks, 104); w++) {
      const date = addDays(c.start, 7 * w);
      const target = Math.min(100, Math.round(w * c.pct_per_week * 10) / 10);
      const last = w === weeks;
      out.push({
        uid: `club-${c.id}-week-${w}`,
        start: date,
        end: addDays(date, 1),
        summary: last
          ? `Book club finishes: ${c.title}`
          : `Book club week ${w}: ${c.title} to ${target}%`,
        description: last
          ? `${what}: everyone should have finished.`
          : `${what}: the schedule says ${target}% by today.`,
        categories: 'Book club',
      });
    }
  }
  return out;
}

/** Escapes a TEXT value (RFC 5545 3.3.11). */
export function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets, never inside a UTF-8 character (RFC 5545 3.1). */
export function foldIcs(line: string): string {
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const icsDate = (d: string) => d.replace(/-/g, '');

export function buildIcs(events: CalEvent[], title: string, generated: string | null): string {
  const g = (generated ?? '1970-01-01T00:00:00').replace(/[-:]/g, '');
  const stamp = `${g.slice(0, 8)}T${(g.slice(9, 15) || '000000').padEnd(6, '0')}Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//moonreader-dashboard//Reading calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(title)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcs(e.uid)}@moonreader-dashboard`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.start)}`,
      `DTEND;VALUE=DATE:${icsDate(e.end)}`,
      `SUMMARY:${escapeIcs(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeIcs(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.categories) lines.push(`CATEGORIES:${escapeIcs(e.categories)}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcs).join('\r\n')}\r\n`;
}
