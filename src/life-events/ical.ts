/**
 * A small iCalendar (RFC 5545) reader: just enough to take the date ranges out of the
 * VEVENTs of a calendar feed. It unfolds lines, reads UID, SUMMARY, DTSTART, DTEND,
 * DURATION (days and weeks) and STATUS, and ignores everything else. Repeating events
 * (RRULE) are not expanded: only their first occurrence is read.
 */

export interface IcalEvent {
  uid: string;
  summary: string;
  /** First day, YYYY-MM-DD. */
  start: string;
  /** Last day (inclusive), YYYY-MM-DD. */
  end: string;
  /** All-day (VALUE=DATE), as holidays usually are. */
  allDay: boolean;
  /** How long it lasts in hours (24 per day for all-day events). */
  hours: number;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

const DAY_MS = 86_400_000;

/** Joins folded lines (a line starting with a space or tab continues the one before). */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else if (line) out.push(line);
  }
  return out;
}

/** NAME;PARAM=x;PARAM="y":value */
export function parseProp(line: string): Prop | null {
  // the first colon outside quotes ends the name and parameters
  let quoted = false;
  let i = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rest] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

/** TEXT values escape commas, semicolons, backslashes and newlines. */
export function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).trim();
}

/**
 * A DATE (YYYYMMDD) or DATE-TIME (YYYYMMDDTHHMMSS, Z for UTC) as milliseconds, read as UTC
 * wall time: the calendar day is what matters here, not the instant.
 */
function parseWhen(p: Prop): { ms: number; date: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/.exec(p.value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0, s ? +s : 0);
  if (Number.isNaN(ms)) return null;
  return { ms, date: !h || p.params.VALUE === 'DATE' };
}

/** P1D, P2W, PT36H… as milliseconds (months and years aren't allowed in DURATION). */
function parseDuration(v: string): number | null {
  const m = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m || v.trim() === 'P') return null;
  const [, w, d, h, mi, s] = m.map((x) => (x ? +x : 0));
  return (((w * 7 + d) * 24 + h) * 60 + mi) * 60_000 + s * 1000;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The events of a calendar, in the order they appear; cancelled and undated ones left out. */
export function parseIcal(text: string): IcalEvent[] {
  const out: IcalEvent[] = [];
  let cur: Prop[] | null = null;
  let depth = 0; // components inside a VEVENT (VALARM) have their own DTSTART…
  for (const line of unfold(text)) {
    const p = parseProp(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value.toUpperCase() === 'VEVENT' && !cur) cur = [];
      else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      if (cur && depth) depth--;
      else if (cur && p.value.toUpperCase() === 'VEVENT') {
        const e = toEvent(cur, out.length);
        if (e) out.push(e);
        cur = null;
      }
      continue;
    }
    if (cur && !depth) cur.push(p);
  }
  return out;
}

function toEvent(props: Prop[], n: number): IcalEvent | null {
  const get = (name: string) => props.find((p) => p.name === name);
  if (get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED') return null;
  const dtstart = get('DTSTART');
  const start = dtstart && parseWhen(dtstart);
  if (!start) return null;
  const dtend = get('DTEND');
  const duration = get('DURATION');
  let endMs: number;
  const parsedEnd = dtend && parseWhen(dtend);
  const dur = duration ? parseDuration(duration.value) : null;
  if (parsedEnd) endMs = parsedEnd.ms;
  else if (dur != null) endMs = start.ms + dur;
  // no end: one day for a date, an instant for a date-time (RFC 5545 3.6.1)
  else endMs = start.date ? start.ms + DAY_MS : start.ms;
  if (endMs < start.ms) endMs = start.ms;
  const hours = (endMs - start.ms) / 3_600_000;
  // an all-day DTEND is the day after; a timed one ending at midnight ends the day before
  const lastMs =
    endMs > start.ms && (start.date || endMs % DAY_MS === 0)
      ? endMs - 1
      : Math.max(endMs, start.ms);
  return {
    uid: unescapeText(get('UID')?.value ?? '') || `event-${n + 1}`,
    summary: unescapeText(get('SUMMARY')?.value ?? ''),
    start: iso(start.ms),
    end: iso(Math.max(start.ms, lastMs)),
    allDay: start.date,
    hours,
  };
}
