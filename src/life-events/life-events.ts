/**
 * Holidays, trips and life events (BOO-86): date ranges the admin marks by hand or that come
 * from a calendar feed (iCal URL), kept in library/life_events.json. The page reads
 * data/life_events.json: the events only, never the calendar's address (such feeds are
 * usually secret links). Pure functions; LifeEventsService does the files and the fetching.
 */
import type { IcalEvent } from './ical';

export const EVENT_KINDS = ['holiday', 'trip', 'job', 'baby', 'move', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface LifeEvent {
  id: string;
  title: string;
  kind: EventKind;
  /** First day, YYYY-MM-DD. */
  start: string;
  /** Last day (inclusive), YYYY-MM-DD. */
  end: string;
  source: 'manual' | 'calendar';
}

export interface CalendarState {
  /** The feed's address ('' when there's none). Never sent to the page. */
  url: string;
  /** When it was last fetched successfully, local time. */
  pulled: string | null;
  /** Why the last fetch failed, if it did. */
  error: string | null;
  events: LifeEvent[];
}

export interface LifeEventsFile {
  schema_version: 1;
  events: LifeEvent[];
  calendar: CalendarState;
}

export class LifeEventError extends Error {}

export const MAX_EVENTS = 2000;
/** A timed calendar event this long or longer counts (a weekend away); shorter ones are appointments. */
export const MIN_TIMED_HOURS = 20;
/** Longest range an event may span. */
export const MAX_DAYS = 3660;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function emptyLifeEvents(): LifeEventsFile {
  return {
    schema_version: 1,
    events: [],
    calendar: { url: '', pulled: null, error: null, events: [] },
  };
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const validDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(s));

/** An event as typed by the admin, checked; throws LifeEventError with a message to show. */
export function toManualEvent(raw: unknown, id: string): LifeEvent {
  const o = asObject(raw);
  const title = str(o.title, 120);
  const start = str(o.start, 10);
  const end = str(o.end, 10) || start;
  const kind = EVENT_KINDS.includes(o.kind as EventKind) ? (o.kind as EventKind) : 'other';
  if (!title) throw new LifeEventError('Give the event a name.');
  if (!validDate(start)) throw new LifeEventError('The start must be a date (YYYY-MM-DD).');
  if (!validDate(end)) throw new LifeEventError('The end must be a date (YYYY-MM-DD).');
  if (end < start) throw new LifeEventError('The end is before the start.');
  if ((Date.parse(end) - Date.parse(start)) / DAY_MS > MAX_DAYS) {
    throw new LifeEventError('An event can be at most ten years long.');
  }
  return { id, title, kind, start, end, source: 'manual' };
}

function toStored(raw: unknown, source: LifeEvent['source']): LifeEvent | null {
  const o = asObject(raw);
  const id = str(o.id, 200);
  try {
    return id ? { ...toManualEvent(o, id), source } : null;
  } catch {
    return null;
  }
}

/** Reads library/life_events.json leniently: whatever doesn't check out is left out. */
export function normaliseLifeEvents(raw: unknown): LifeEventsFile {
  const o = asObject(raw);
  const cal = asObject(o.calendar);
  const list = (v: unknown, source: LifeEvent['source']) =>
    (Array.isArray(v) ? v : [])
      .map((e) => toStored(e, source))
      .filter((e): e is LifeEvent => e !== null)
      .slice(0, MAX_EVENTS);
  return {
    schema_version: 1,
    events: list(o.events, 'manual'),
    calendar: {
      url: str(cal.url, 2000),
      pulled: str(cal.pulled, 30) || null,
      error: str(cal.error, 500) || null,
      events: list(cal.events, 'calendar'),
    },
  };
}

/** A calendar address: http(s), or webcal(s) which means https. Throws LifeEventError. */
export function toCalendarUrl(raw: unknown): string {
  const s = str(raw, 2000);
  if (!s) return '';
  let u: URL;
  try {
    u = new URL(s.replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new LifeEventError("That doesn't look like a web address.");
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new LifeEventError(
      'The calendar address must start with https://, http:// or webcal://.',
    );
  }
  return u.toString();
}

/** What the admin page shows of the address: its host only (the rest is often a secret). */
export function calendarHost(url: string): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

/** The kind of a calendar event, guessed from its name. */
export function guessKind(summary: string): EventKind {
  const s = summary.toLowerCase();
  if (/\b(new job|job|work|starts? at|first day)\b/.test(s)) return 'job';
  if (/\b(mov(e|ing)|house move|new house|new flat)\b/.test(s)) return 'move';
  if (/\b(baby|born|birth|parental|maternity|paternity)\b/.test(s)) return 'baby';
  if (/\b(trip|travel|flight|conference|visit|weekend|city break)\b/.test(s)) return 'trip';
  if (/\b(holiday|vacation|leave|break|annual leave|pto|off)\b/.test(s)) return 'holiday';
  return 'holiday';
}

/**
 * The calendar's events worth marking: all-day events and timed ones of 20 hours or more,
 * so a calendar with appointments in it doesn't mark every day.
 */
export function fromCalendar(events: IcalEvent[]): LifeEvent[] {
  const seen = new Set<string>();
  const out: LifeEvent[] = [];
  for (const e of events) {
    if (!e.allDay && e.hours < MIN_TIMED_HOURS) continue;
    if ((Date.parse(e.end) - Date.parse(e.start)) / DAY_MS > MAX_DAYS) continue;
    // a repeating event shares its UID with its exceptions: keep the first
    const id = `cal-${e.uid}`.slice(0, 200);
    if (seen.has(id)) continue;
    seen.add(id);
    const title = e.summary.slice(0, 120) || 'Calendar event';
    out.push({ id, title, kind: guessKind(title), start: e.start, end: e.end, source: 'calendar' });
    if (out.length >= MAX_EVENTS) break;
  }
  return out;
}

/** data/life_events.json: every event, oldest first, without the calendar's address. */
export function servedLifeEvents(file: LifeEventsFile): LifeEvent[] {
  return [...file.events, ...file.calendar.events].sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1,
  );
}

/** A short id for a new manual event. */
export function newEventId(file: LifeEventsFile, title: string): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'event';
  const taken = new Set(file.events.map((e) => e.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
