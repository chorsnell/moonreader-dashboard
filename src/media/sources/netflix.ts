import type { MediaEvent } from '../media.types';

/**
 * Netflix's viewing activity. Two files are understood:
 * - ViewingActivity.csv from "Download your personal information": every sitting of every
 *   profile, with start time, time played and the position reached;
 * - NetflixViewingHistory.csv from a profile's "Viewing activity" page: only title and date.
 */

export type NetflixKind = 'activity' | 'history';

export interface NetflixRow {
  profile: string;
  /** ISO UTC, or a local date (YYYY-MM-DD) for the light history file. */
  start: string;
  seconds: number | null;
  title: string;
  supplemental: string;
  device: string | null;
  bookmark: number | null;
}

export interface NetflixFile {
  kind: NetflixKind;
  profiles: string[];
  rows: NetflixRow[];
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** Whether the start of a file looks like either Netflix CSV. */
export function looksLikeNetflix(head: string): boolean {
  const first = head.replace(/^﻿/, '').split(/\r?\n/)[0].replace(/"/g, '').trim();
  return /^Profile Name,Start Time,/i.test(first) || /^Title,Date$/i.test(first);
}

/** "HH:MM:SS" (hours may pass 24) -> seconds; anything else -> null. */
export function hms(s: string | undefined): number | null {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec((s ?? '').trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Reads either Netflix CSV. Throws when it's neither. */
export function parseNetflix(text: string): NetflixFile {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error('The file is empty.');
  const cols = header.map((h) => h.trim().toLowerCase());
  const at = (name: string) => cols.indexOf(name);
  if (at('profile name') >= 0 && at('start time') >= 0 && at('title') >= 0) {
    const [profile, start, duration, title, supp, device, bookmark] = [
      'profile name',
      'start time',
      'duration',
      'title',
      'supplemental video type',
      'device type',
      'bookmark',
    ].map(at);
    const rows: NetflixRow[] = [];
    for (const r of body) {
      const when = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(r[start] ?? '');
      if (!when || !r[title]) continue;
      rows.push({
        profile: (r[profile] ?? '').trim(),
        start: `${when[1]}T${when[2].length === 5 ? `${when[2]}:00` : when[2]}Z`,
        seconds: hms(r[duration]),
        title: r[title].trim(),
        supplemental: supp >= 0 ? (r[supp] ?? '').trim() : '',
        device: device >= 0 ? (r[device] ?? '').trim() || null : null,
        bookmark: bookmark >= 0 ? hms(r[bookmark]) : null,
      });
    }
    const profiles = [...new Set(rows.map((r) => r.profile))].sort();
    return { kind: 'activity', profiles, rows };
  }
  if (at('title') >= 0 && at('date') >= 0) {
    const [title, date] = [at('title'), at('date')];
    const dates = body.map((r) => (r[date] ?? '').trim());
    const order = dateOrder(dates);
    const rows: NetflixRow[] = [];
    body.forEach((r, i) => {
      const d = parseDate(dates[i], order);
      if (!d || !r[title]) return;
      rows.push({
        profile: '',
        start: d,
        seconds: null,
        title: r[title].trim(),
        supplemental: '',
        device: null,
        bookmark: null,
      });
    });
    return { kind: 'history', profiles: [], rows };
  }
  throw new Error("That isn't a Netflix viewing activity file.");
}

/** Whether d/m/y or m/d/y: the history file uses the account's locale. */
function dateOrder(dates: string[]): 'dmy' | 'mdy' {
  for (const d of dates) {
    const m = /^(\d{1,2})[/.](\d{1,2})[/.]\d{2,4}$/.exec(d);
    if (m && Number(m[1]) > 12) return 'dmy';
    if (m && Number(m[2]) > 12) return 'mdy';
  }
  return 'mdy';
}

function parseDate(s: string, order: 'dmy' | 'mdy'): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s);
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const [day, month] = order === 'dmy' ? [a, b] : [b, a];
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const SEASON =
  /^(?:(season|series|part|volume|vol\.|chapter|book|collection|temporada|staffel|saison) (\d+)|(limited series|miniseries|mini-series))$/i;

export interface ParsedTitle {
  show: string | null;
  season: number | null;
  season_label: string | null;
  episode_title: string;
  episode: number | null;
}

/**
 * "Show: Season 2: Episode title", "Show: Limited Series: Episode", "Show: Part 1: Chapter
 * Three", or a film (which may itself contain a colon). show is null when there's no season token.
 */
export function parseTitle(title: string): ParsedTitle {
  const parts = title.split(': ');
  for (let i = 1; i < parts.length; i++) {
    const m = SEASON.exec(parts[i].trim());
    if (!m) continue;
    let rest = parts
      .slice(i + 1)
      .join(': ')
      .trim();
    let episode: number | null = null;
    const num = /^(.*?)\s*\(Episode (\d+)\)$/i.exec(rest);
    if (num) {
      rest = num[1] || `Episode ${num[2]}`;
      episode = Number(num[2]);
    }
    return {
      show: parts.slice(0, i).join(': ').trim(),
      season: m[2] ? Number(m[2]) : 1,
      season_label: parts[i].trim(),
      episode_title: rest || parts[i].trim(),
      episode,
    };
  }
  return { show: null, season: null, season_label: null, episode_title: title, episode: null };
}

/** How many different remainders after "First part: " make the first part a show. */
const SHOW_REMAINDERS = 3;

export interface NetflixEventOptions {
  /** The profiles to import; an export with only one profile imports it anyway. */
  profiles: string[];
}

/** Netflix rows -> media events: extras dropped, chosen profiles only, titles split into show and episode. */
export function netflixEvents(file: NetflixFile, opts: NetflixEventOptions): MediaEvent[] {
  const chosen = new Set(opts.profiles);
  const keep = (r: NetflixRow) =>
    file.kind === 'history' || chosen.has(r.profile) || file.profiles.length === 1;
  const rows = file.rows.filter((r) => keep(r) && !r.supplemental);
  // titles without a season token: "Prefix: rest" is a show when the prefix has 3+ different rests
  const rests = new Map<string, Set<string>>();
  for (const r of rows) {
    const i = r.title.indexOf(': ');
    if (i <= 0 || parseTitle(r.title).show) continue;
    const prefix = r.title.slice(0, i);
    rests.set(prefix, (rests.get(prefix) ?? new Set()).add(r.title.slice(i + 2)));
  }
  return rows.map((r): MediaEvent => {
    const t = parseTitle(r.title);
    const i = r.title.indexOf(': ');
    const prefix = i > 0 ? r.title.slice(0, i) : null;
    const showByCount = !t.show && prefix && (rests.get(prefix)?.size ?? 0) >= SHOW_REMAINDERS;
    const show = t.show ?? (showByCount ? prefix : null);
    const start =
      file.kind === 'history' ? localNoon(r.start) : r.start; /* the light file has dates only */
    const base = {
      source: 'netflix' as const,
      start,
      seconds: r.seconds,
      estimated: r.seconds === null,
      position_seconds: r.bookmark,
      device: r.device,
    };
    if (show) {
      return {
        ...base,
        source_key: show.toLowerCase(),
        media: 'tv',
        series_title: show,
        season: t.season ?? 1,
        season_label: t.season_label,
        episode: t.episode,
        title: t.show ? t.episode_title : r.title.slice(i + 2),
      };
    }
    return { ...base, source_key: r.title.toLowerCase(), media: 'film', title: r.title };
  });
}

function localNoon(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}
