import { daysBetween, localDate, round1 } from '../common/time';
import type {
  ItemMeta,
  MediaCatalogue,
  MediaCatalogueEntry,
  MediaDailyRow,
  MediaEvent,
  MediaHistory,
  MediaItemRow,
  MediaPartRow,
  MediaRunRow,
  MediaSessionRow,
  MediaSource,
  MediaStatus,
  Medium,
} from './media.types';

/** A new run (a re-watch) starts after this many days without the item. Books use 365. */
export const RUN_GAP_DAYS = 180;
/** Progress at or above this counts as finished, as for books. */
export const FINISHED = 99;
/** A part (or a film) watched to this % of its runtime counts as watched: the credits don't matter. */
export const WATCHED_PCT = 90;
/** Shorter sittings with less progress than this are browsing noise (autoplay previews). */
const NOISE_MINUTES = 2;
const NOISE_PCT = 10;
/** Without a runtime, a part counts as watched at this share of its season's median minutes... */
const MEDIAN_SHARE = 0.75;
/** ...or, with no other episodes to compare, after this many minutes. */
const LONE_EPISODE_MINUTES = 15;
/** Without a runtime, a film counts as watched after this many minutes; less is a share of a typical film. */
const FILM_WATCHED_MINUTES = 60;
const TYPICAL_FILM_MINUTES = 100;
/** Minutes given to a dated event (no time played) when nothing knows the runtime. */
export const DEFAULT_RUNTIME: Partial<Record<Medium, number>> = {
  tv: 45,
  film: TYPICAL_FILM_MINUTES,
};

/** Lower-case ASCII words joined by dashes, safe as an id and a cover file name. */
export function slug(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[^\p{ASCII}]/gu, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

/** The key metadata is cached under for an event: medium plus source key. */
export const metaKey = (e: Pick<MediaEvent, 'media' | 'source_key'>) =>
  `${e.media}:${e.source_key}`;

export interface BuildOptions {
  /** metaKey(event) -> what TMDB or Plex knows. */
  meta?: Map<string, ItemMeta>;
  catalogue?: MediaCatalogue;
  /** Filled with item id -> the metaKey of its first event, to find its poster afterwards. */
  itemKeys?: Map<string, string>;
}

interface Session {
  ev: MediaEvent;
  startMs: number;
  minutes: number;
  pct: number | null;
  part: Part | null;
}

interface Part {
  key: string;
  no: number;
  title: string;
  runtime: number | null;
  sessions: Session[];
  minutes: number;
  firstWatched: string | null;
}

interface Item {
  id: string;
  media: Medium;
  title: string;
  creator: string | null;
  series: string | null;
  series_id: string | null;
  series_no: number | null;
  genre: string | null;
  subgenre: string | null;
  year: number | null;
  runtime: number | null;
  unitsTotal: number | null;
  ext: MediaItemRow['ext'];
  sources: Set<MediaSource>;
  sessions: Session[];
  parts: Map<string, Part>;
  seasonMeta: NonNullable<ItemMeta['seasons']>[string] | undefined;
}

const firstOf = <T>(...xs: (T | null | undefined)[]): T | null =>
  xs.find((x) => x !== undefined && x !== null && x !== '') ?? null;

function catalogueEntry(cat: MediaCatalogue, e: MediaEvent): MediaCatalogueEntry {
  return cat[e.source_key] ?? cat[(e.series_title ?? e.title).toLowerCase()] ?? {};
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Splits a sitting at local midnights: [date, minutes] for each day it touched. */
function splitByDay(startMs: number, minutes: number): [string, number][] {
  const endMs = startMs + minutes * 60_000;
  const out: [string, number][] = [];
  let from = startMs;
  while (from < endMs || !out.length) {
    const d = new Date(from);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const to = Math.min(endMs, midnight);
    out.push([localDate(d), (to - from) / 60_000]);
    if (to >= endMs) break;
    from = to;
  }
  return out;
}

/**
 * Turns events from every source into the five media files. TV is grouped by season (the
 * "book"), so a show is a series of seasons; a film is one item, its collection the series.
 */
export function buildMediaHistory(events: MediaEvent[], opts: BuildOptions = {}): MediaHistory {
  const meta = opts.meta ?? new Map<string, ItemMeta>();
  const cat = opts.catalogue ?? {};
  const items = new Map<string, Item>();
  for (const ev0 of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    const c = catalogueEntry(cat, ev0);
    if (c.exclude) continue;
    const m = meta.get(metaKey(ev0)) ?? {};
    const media: Medium = c.media ?? m.media ?? ev0.media;
    const ev: MediaEvent = { ...ev0, media };
    if (media === 'tv' && !ev.series_title && ev.title.includes(': ')) {
      // a colon title that metadata (or the catalogue) says is a show: "Show: Episode"
      const i = ev.title.indexOf(': ');
      ev.series_title = ev.title.slice(0, i);
      ev.title = ev.title.slice(i + 2);
    }
    let item: Item | undefined;
    if (media === 'tv') {
      const show = firstOf(c.title, m.title, ev.series_title, ev.title)!;
      const season = ev.season ?? 1;
      const showSlug = slug(show);
      const id = `tv-${showSlug}-s${season}`;
      item = items.get(id);
      if (!item) {
        const seasonMeta = m.seasons?.[String(season)];
        const label =
          ev.season_label && !/^season \d+$/i.test(ev.season_label)
            ? ev.season_label
            : `Season ${season}`;
        item = newItem(id, media, `${show}: ${label}`, c, m, ev);
        item.series = show;
        item.series_id = `show-${showSlug}`;
        item.series_no = season;
        item.seasonMeta = seasonMeta;
        item.unitsTotal = firstOf(c.episodes?.[String(season)], seasonMeta?.episodes);
        items.set(id, item);
      }
    } else {
      const title = firstOf(c.title, m.title, ev.title)!;
      const year = firstOf(c.year, m.year, ev.year);
      const id = `${media}-${slug(title)}${year ? `-${year}` : ''}`;
      item = items.get(id);
      if (!item) {
        item = newItem(id, media, title, c, m, ev);
        const coll = c.series ? { name: c.series, order: c.series_no ?? null } : m.collection;
        if (coll) {
          item.series = coll.name;
          item.series_id = `${media}-collection-${slug(coll.name.replace(/ collection$/i, ''))}`;
          item.series_no = coll.order ?? null;
        }
        items.set(id, item);
      }
    }
    if (!opts.itemKeys?.has(item.id)) opts.itemKeys?.set(item.id, metaKey(ev0));
    item.sources.add(ev.source);
    if (ev.ext) item.ext = { ...ev.ext, ...item.ext };
    const runtimeGuess = item.runtime ?? DEFAULT_RUNTIME[media] ?? 30;
    const minutes = ev.seconds !== null ? ev.seconds / 60 : runtimeGuess;
    item.sessions.push({
      ev,
      startMs: Date.parse(ev.start),
      minutes,
      pct: ev.position_pct ?? null,
      part: null,
    });
  }

  const out: MediaHistory = { items: [], runs: [], daily: [], sessions: [], parts: [] };
  for (const item of items.values()) buildItem(item, out);
  out.items.sort(
    (a, b) => (a.first ?? '').localeCompare(b.first ?? '') || a.id.localeCompare(b.id),
  );
  out.runs.sort((a, b) => a.start.localeCompare(b.start) || a.run_id.localeCompare(b.run_id));
  out.daily.sort((a, b) => a.date.localeCompare(b.date) || a.item_id.localeCompare(b.item_id));
  out.sessions.sort((a, b) => a.start.localeCompare(b.start));
  out.parts.sort((a, b) => a.item_id.localeCompare(b.item_id) || a.no - b.no);
  return out;
}

function newItem(
  id: string,
  media: Medium,
  title: string,
  c: MediaCatalogueEntry,
  m: ItemMeta,
  ev: MediaEvent,
): Item {
  return {
    id,
    media,
    title,
    creator: firstOf(c.creator, m.creator),
    series: null,
    series_id: null,
    series_no: null,
    genre: firstOf(c.genre, m.genres?.[0]),
    subgenre: firstOf(c.subgenre, m.genres?.[1]),
    year: firstOf(c.year, m.year, ev.year),
    runtime: firstOf(c.runtime, m.runtime),
    unitsTotal: null,
    ext: { ...m.ext },
    sources: new Set(),
    sessions: [],
    parts: new Map(),
    seasonMeta: undefined,
  };
}

/** Numbers the episodes, decides what was watched, and adds the item's rows to `out`. */
function buildItem(item: Item, out: MediaHistory): void {
  const tv = item.media === 'tv';
  if (tv) assignParts(item);

  // furthest position as a %, once the runtime is known; dated events have none
  for (const s of item.sessions) {
    const runtime = s.part ? s.part.runtime : item.runtime;
    if (s.pct === null && s.ev.position_seconds != null && runtime) {
      s.pct = Math.min(100, (s.ev.position_seconds / 60 / runtime) * 100);
    }
  }
  const real = item.sessions.filter(
    (s) => !(s.minutes < NOISE_MINUTES && (s.pct ?? 0) < NOISE_PCT && !s.ev.completed),
  );
  if (!real.length) return;
  item.sessions = real;
  for (const p of item.parts.values()) {
    p.sessions = real.filter((s) => s.part === p);
    p.minutes = p.sessions.reduce((t, s) => t + s.minutes, 0);
  }
  for (const [k, p] of item.parts) if (!p.sessions.length) item.parts.delete(k);

  const maxNo = Math.max(0, ...[...item.parts.values()].map((p) => p.no));
  const unitsTotal = tv ? Math.max(item.unitsTotal ?? 0, maxNo) || null : null;

  // minutes that count as having watched a part with no runtime: 75% of the season's median,
  // taking each episode's longest day (a re-watch shouldn't double it)
  const longestDay = new Map<Part, number>();
  for (const p of item.parts.values()) {
    const byDay = new Map<string, number>();
    for (const s of p.sessions) {
      const d = localDate(new Date(s.startMs));
      byDay.set(d, (byDay.get(d) ?? 0) + s.minutes);
    }
    longestDay.set(p, Math.max(0, ...byDay.values()));
  }
  const thresholds = new Map<Part, number>();
  for (const p of item.parts.values()) {
    if (p.runtime) thresholds.set(p, p.runtime * MEDIAN_SHARE);
    else {
      const others = median(
        [...item.parts.values()].filter((o) => o !== p).map((o) => longestDay.get(o)!),
      );
      thresholds.set(p, others !== null ? others * MEDIAN_SHARE : LONE_EPISODE_MINUTES);
    }
  }

  interface Run {
    sessions: Session[];
    watched: Set<Part>;
    minutesByPart: Map<Part, number>;
    filmMinutes: number;
    filmPct: number;
    progress: number | null;
  }
  const runs: Run[] = [];
  const dayUnits = new Map<string, number>();
  const dayProgress = new Map<string, number | null>();
  const progressOf = (r: Run): number | null => {
    if (tv) return unitsTotal ? round1(Math.min(100, (r.watched.size / unitsTotal) * 100)) : null;
    if (r.filmPct >= WATCHED_PCT) return 100;
    if (r.filmPct > 0 && item.runtime) return round1(r.filmPct);
    if (item.runtime) {
      const pct = (r.filmMinutes / item.runtime) * 100;
      return pct >= WATCHED_PCT ? 100 : round1(pct);
    }
    if (r.filmMinutes >= FILM_WATCHED_MINUTES) return 100;
    return round1(Math.min(99, (r.filmMinutes / TYPICAL_FILM_MINUTES) * 100));
  };

  let run: Run | null = null;
  let lastDate = '';
  for (const s of item.sessions) {
    const date = localDate(new Date(s.startMs));
    const finishedRun = run && run.progress !== null && run.progress >= FINISHED;
    const restart = tv && finishedRun && s.part?.no === 1;
    if (!run || daysBetween(lastDate, date) > RUN_GAP_DAYS || restart || (!tv && finishedRun)) {
      run = {
        sessions: [],
        watched: new Set(),
        minutesByPart: new Map(),
        filmMinutes: 0,
        filmPct: 0,
        progress: null,
      };
      runs.push(run);
    }
    run.sessions.push(s);
    lastDate = date;
    if (s.part) {
      const p = s.part;
      const mins = (run.minutesByPart.get(p) ?? 0) + s.minutes;
      run.minutesByPart.set(p, mins);
      const watched =
        s.ev.completed ||
        s.ev.estimated ||
        (s.pct !== null && s.pct >= WATCHED_PCT) ||
        mins >= thresholds.get(p)!;
      if (watched && !run.watched.has(p)) {
        run.watched.add(p);
        if (!p.firstWatched) {
          p.firstWatched = date;
          dayUnits.set(date, (dayUnits.get(date) ?? 0) + 1);
        }
      }
    } else {
      run.filmMinutes += s.minutes;
      run.filmPct = Math.max(run.filmPct, s.ev.completed || s.ev.estimated ? 100 : (s.pct ?? 0));
    }
    run.progress = progressOf(run);
    dayProgress.set(date, run.progress);
  }

  const dates = (ss: Session[]) =>
    [...new Set(ss.map((s) => localDate(new Date(s.startMs))))].sort();
  const sumMin = (ss: Session[]) => ss.reduce((t, s) => t + s.minutes, 0);
  const final = runs[runs.length - 1].progress;
  let status: MediaStatus;
  if (final !== null && final >= FINISHED) status = 'finished';
  else if (final) status = 'in_progress';
  else if (final === 0) status = 'not_started';
  else status = 'unknown';
  const allDates = dates(item.sessions);
  const watchedEver = [...item.parts.values()].filter((p) => p.firstWatched).length;
  const base = {
    media: item.media,
    title: item.title,
    creator: item.creator,
    genre: item.genre,
  };

  out.items.push({
    id: item.id,
    ...base,
    series: item.series,
    series_id: item.series_id,
    series_no: item.series_no,
    subgenre: item.subgenre,
    year: item.year,
    status,
    progress: final,
    hours: round1(sumMin(item.sessions) / 60),
    units: tv ? watchedEver : null,
    units_total: unitsTotal,
    times: runs.length,
    first: allDates[0] ?? null,
    last: allDates[allDates.length - 1] ?? null,
    sources: [...item.sources].sort(),
    ext: {
      tmdb_id: item.ext.tmdb_id ?? null,
      imdb_id: item.ext.imdb_id ?? null,
      plex_rating_key: item.ext.plex_rating_key ?? null,
    },
  } satisfies MediaItemRow);

  runs.forEach((r, i) => {
    const d = dates(r.sessions);
    out.runs.push({
      run_id: `${item.id}#${i + 1}`,
      item_id: item.id,
      ...base,
      subgenre: item.subgenre,
      series: item.series,
      run_no: i + 1,
      times: runs.length,
      start: d[0],
      end: d[d.length - 1],
      days: d.length,
      hours: round1(sumMin(r.sessions) / 60),
      units: tv ? r.watched.size : null,
      progress: r.progress,
      finished: r.progress !== null && r.progress >= FINISHED,
    } satisfies MediaRunRow);
  });

  const dayMinutes = new Map<string, number>();
  for (const s of item.sessions) {
    for (const [date, mins] of splitByDay(s.startMs, s.minutes)) {
      dayMinutes.set(date, (dayMinutes.get(date) ?? 0) + mins);
    }
  }
  let progress: number | null = null;
  for (const date of [...dayMinutes.keys()].sort()) {
    if (dayProgress.has(date)) progress = dayProgress.get(date)!;
    out.daily.push({
      date,
      item_id: item.id,
      ...base,
      minutes: round1(dayMinutes.get(date)!),
      units: dayUnits.get(date) ?? 0,
      progress,
    } satisfies MediaDailyRow);
  }

  for (const s of item.sessions) {
    out.sessions.push({
      start: new Date(s.startMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      end: new Date(s.startMs + s.minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      date: localDate(new Date(s.startMs)),
      item_id: item.id,
      part_id: s.part ? partId(item, s.part) : null,
      media: item.media,
      minutes: round1(s.minutes),
      progress: s.pct !== null ? round1(s.pct) : null,
      estimated: s.ev.estimated,
      source: s.ev.source,
      device: s.ev.device ?? null,
    } satisfies MediaSessionRow);
  }

  for (const p of item.parts.values()) {
    const d = dates(p.sessions);
    out.parts.push({
      id: partId(item, p),
      item_id: item.id,
      media: item.media,
      no: p.no,
      title: p.title,
      runtime: p.runtime,
      plays: p.sessions.length,
      minutes: round1(p.minutes),
      first: d[0],
      last: d[d.length - 1],
      completed: p.firstWatched !== null,
    } satisfies MediaPartRow);
  }
}

const partId = (item: Item, p: Part) => `${item.id}-e${String(p.no).padStart(2, '0')}`;

/**
 * Gives each session its episode. Sources with episode numbers keep them; otherwise the title
 * is looked up in the season's metadata, and unknown episodes are numbered in order of first watch.
 */
function assignParts(item: Item): void {
  const titles = item.seasonMeta?.titles ?? {};
  const runtimes = item.seasonMeta?.runtimes ?? {};
  const byKey = new Map<string, Part>();
  const unnumbered: Session[] = [];
  for (const s of item.sessions) {
    const no = s.ev.episode ?? titles[s.ev.title.toLowerCase()] ?? null;
    if (no === null) {
      unnumbered.push(s);
      continue;
    }
    const key = `#${no}`;
    let p = byKey.get(key);
    if (!p) {
      p = newPart(key, no, s.ev.title, runtimes[String(no)] ?? item.runtime);
      byKey.set(key, p);
    }
    s.part = p;
  }
  let next = Math.max(0, ...[...byKey.values()].map((p) => p.no));
  for (const s of unnumbered) {
    const key = `t:${s.ev.title.toLowerCase()}`;
    let p = byKey.get(key);
    if (!p) {
      next += 1;
      p = newPart(key, next, s.ev.title, item.runtime);
      byKey.set(key, p);
    }
    s.part = p;
  }
  item.parts = byKey;
}

function newPart(key: string, no: number, title: string, runtime: number | null): Part {
  return { key, no, title, runtime, sessions: [], minutes: 0, firstWatched: null };
}
