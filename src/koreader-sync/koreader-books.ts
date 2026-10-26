import { posix } from 'node:path';
import { round1 } from '../common/time';
import { bookKey } from '../common/book-match';
import type { BookHistory, DayEntry } from '../backup-import/reading-history.types';
import type { Highlight } from '../backup-import/highlights';
import type { ImportedBook, ImportedHighlight, ImportFile } from '../imports/imports.types';

/**
 * The KOReader plugin's side of the sync (koreader/API.md): what a device's book sidecars
 * say, and what the dashboard sends back about books on the device. Pure functions, so the
 * rules are tested without a server.
 */

/** Books KOReader holds only because the plugin copied Moon+ history in (koreader/API.md). */
export const SYNTHETIC_MD5 = 'moonplus:';

export interface SidecarAnnotation {
  text?: string | null;
  note?: string | null;
  /** "YYYY-MM-DD HH:MM:SS", KOReader's format. */
  datetime?: string | null;
  chapter?: string | null;
  pageno?: number | null;
  /** null for a page bookmark. */
  drawer?: string | null;
  color?: string | null;
}

/** One book as the plugin reads it from the device's sidecar (.sdr) files. */
export interface SidecarBook {
  md5: string;
  file?: string | null;
  title?: string | null;
  authors?: string | null;
  series?: string | null;
  pages?: number | null;
  /** 0..1, KOReader's percent_finished. */
  percent?: number | null;
  /** KOReader's summary.status: reading, complete, abandoned. */
  status?: string | null;
  modified?: string | null;
  annotations?: SidecarAnnotation[];
  /** When the dashboard last received it, local time. */
  received?: string;
  device?: string | null;
}

/** A device file the plugin asks about. */
export interface DeviceFile {
  md5?: string | null;
  file?: string | null;
  title?: string | null;
  authors?: string | null;
}

/** What the dashboard tells the plugin about one book (koreader/API.md, "Book"). */
export interface PluginBook {
  id: string;
  title: string;
  author: string;
  status: string;
  progress: number | null;
  genre: string;
  subgenre: string;
  shelves: string[];
  days: { date: string; minutes: number | null; progress: number | null }[];
  highlights: {
    text: string;
    note: string | null;
    chapter: number | null;
    time: string | null;
    kind: string;
  }[];
}

const text = (v: unknown, max = 2000): string =>
  typeof v === 'string' ? v.replace(/\0/g, '').trim().slice(0, max) : '';
const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
/** KOReader keeps several authors one per line; the dashboard joins them with " & ". */
export const koreaderAuthors = (raw: unknown): string =>
  text(raw)
    .split(/\r?\n/)
    .map((a) => a.trim())
    .filter((a) => a && a !== 'N/A')
    .join(' & ');

/** "2026-10-20 22:01:00" -> "2026-10-20T22:01:00"; anything else -> null. */
export function koreaderTime(raw: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(text(raw, 40));
  if (!m) return null;
  return `${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}`;
}

/** Whitespace, quotes, dashes and case folded, so the same passage compares equal. */
export function normaliseText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Cleans one book of a POST /api/koreader/books body, or returns null when it can't be used
 * (no md5, a synthetic Moon+ row). Limits keep a broken device from filling the disk.
 */
export function cleanSidecarBook(raw: unknown): SidecarBook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const md5 = text(r.md5, 200);
  if (!md5 || md5.startsWith(SYNTHETIC_MD5)) return null;
  const percent = finite(r.percent);
  const annotations = Array.isArray(r.annotations) ? r.annotations.slice(0, 5000) : [];
  return {
    md5,
    file: text(r.file, 500) || null,
    title: text(r.title, 500) || null,
    authors: text(r.authors, 500) || null,
    series: text(r.series, 300) || null,
    pages: finite(r.pages),
    percent: percent === null ? null : Math.min(1, Math.max(0, percent)),
    status: ['reading', 'complete', 'abandoned'].includes(text(r.status)) ? text(r.status) : null,
    modified: text(r.modified, 40) || null,
    annotations: annotations
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => ({
        text: text(a.text, 10000) || null,
        note: text(a.note, 10000) || null,
        datetime: text(a.datetime, 40) || null,
        chapter: text(a.chapter, 300) || null,
        pageno: finite(a.pageno),
        drawer: text(a.drawer, 40) || null,
        color: text(a.color, 40) || null,
      })),
  };
}

/** A sidecar's annotations as dashboard highlights. Bookmarks with no text are left out. */
export function sidecarHighlights(book: SidecarBook): ImportedHighlight[] {
  const out: ImportedHighlight[] = [];
  for (const a of book.annotations ?? []) {
    const t = text(a.text, 10000);
    const note = text(a.note, 10000) || null;
    if (!a.drawer && !note) continue; // a plain page bookmark: KOReader's text is just its place
    if (!t && !note) continue;
    const progress =
      a.pageno && book.pages && book.pages > 0
        ? round1(Math.min(100, (a.pageno / book.pages) * 100))
        : null;
    out.push({
      time: koreaderTime(a.datetime),
      progress,
      chapter: null,
      location: a.pageno ?? null,
      text: t,
      note,
      kind: a.drawer ? (note ? 'note' : 'highlight') : 'bookmark',
    });
  }
  return out.sort((x, y) => (x.location ?? 0) - (y.location ?? 0));
}

/** "Name #3" -> Name and 3, as the statistics importer reads it. */
function seriesOf(raw: string | null | undefined): {
  series: string | null;
  series_no: number | null;
} {
  const s = text(raw);
  if (!s || s === 'N/A') return { series: null, series_no: null };
  const m = /^(.*?)\s*#\s*([\d.]+)\s*$/.exec(s);
  return m && m[1] ? { series: m[1], series_no: Number(m[2]) } : { series: s, series_no: null };
}

/**
 * The KOReader import: the statistics' books, minus the Moon+ copies the plugin wrote into
 * them, plus what the sidecars add (highlights, progress, finished or abandoned), plus books
 * only the sidecars know (opened, highlighted or marked read but never timed).
 * `links` names the dashboard book a device file was matched to, so the merge finds it even
 * when KOReader's metadata spells the title differently.
 */
export function buildKoreaderBooks(
  stats: ImportedBook[],
  sidecars: Record<string, SidecarBook>,
  links: Record<string, { title: string; author: string }> = {},
): ImportedBook[] {
  const out: ImportedBook[] = [];
  const seen = new Set<string>();
  const linked = (b: ImportedBook, md5: string) => {
    const l = links[md5];
    return l ? { ...b, title: l.title, author: l.author } : b;
  };
  for (const b of stats) {
    if (b.id.startsWith(SYNTHETIC_MD5)) continue;
    // the importer suffixes a duplicate md5 with "-<row id>"
    const md5 = sidecars[b.id] ? b.id : b.id.replace(/-\d+$/, '');
    const sc = sidecars[md5];
    seen.add(md5);
    if (!sc) {
      out.push(linked(b, md5));
      continue;
    }
    out.push(linked(applySidecar(b, sc), md5));
  }
  for (const [md5, sc] of Object.entries(sidecars)) {
    if (seen.has(md5)) continue;
    const title = text(sc.title) || (sc.file ? posix.parse(sc.file).name : '');
    if (!title) continue;
    const base: ImportedBook = {
      id: md5,
      title,
      author: koreaderAuthors(sc.authors),
      isbn13: null,
      isbn10: null,
      rating: null,
      shelves: [],
      shelf: 'currently-reading',
      read_count: 0,
      date_added: null,
      pages: sc.pages ?? null,
      reads: [],
      progress: null,
      ...seriesOf(sc.series),
    };
    const book = applySidecar(base, sc);
    // nothing to show: opened once, no progress, no highlights
    if (!book.highlights?.length && !book.progress && book.shelf !== 'read') continue;
    out.push(linked(book, md5));
  }
  return out;
}

function applySidecar(b: ImportedBook, sc: SidecarBook): ImportedBook {
  const highlights = sidecarHighlights(sc);
  const percent = sc.percent !== null && sc.percent !== undefined ? round1(sc.percent * 100) : null;
  const book: ImportedBook = {
    ...b,
    pages: b.pages ?? sc.pages ?? null,
    ...(highlights.length ? { highlights } : {}),
  };
  if (sc.status === 'complete') {
    book.shelf = 'read';
    book.progress = 100;
    const last = book.reads.at(-1);
    if (last && last.finished !== true)
      book.reads = [...book.reads.slice(0, -1), { ...last, finished: true, progress: 100 }];
    book.read_count = Math.max(book.read_count, 1);
  } else if (sc.status === 'abandoned') {
    book.shelf = 'did-not-finish';
    if (percent !== null) book.progress = Math.max(book.progress ?? 0, percent);
  } else if (percent !== null) {
    book.progress = Math.max(book.progress ?? 0, percent);
    if (percent >= 99) book.shelf = 'read';
  }
  return book;
}

/** What a dashboard book looks like to the plugin. */
function pluginBook(
  b: BookHistory,
  koreaderDates: Set<string>,
  highlights: Highlight[],
  koreaderTexts: Set<string>,
): PluginBook {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    status: b.status,
    progress: b.progress ?? null,
    genre: b.genre,
    subgenre: b.subgenre,
    shelves: b.shelves ?? [],
    days: b.daily
      .filter((d: DayEntry) => !koreaderDates.has(d.date) && (d.minutes ?? 0) > 0)
      .map((d) => ({ date: d.date, minutes: d.minutes, progress: d.progress })),
    highlights: highlights
      .filter((h) => h.book_id === b.id && h.text && !koreaderTexts.has(normaliseText(h.text)))
      .map((h) => ({
        text: h.text,
        note: h.note,
        chapter: h.chapter,
        time: h.time,
        kind: h.kind,
      })),
  };
}

export interface MatchInput {
  files: DeviceFile[];
  others: boolean;
  books: BookHistory[];
  highlights: Highlight[];
  koreader: ImportFile | null;
  links: Record<string, { book_id: string }>;
}

export interface MatchResult {
  books: { md5: string | null; match: PluginBook | null }[];
  others?: PluginBook[];
  /** md5 -> the dashboard book it matched, to remember for the next import. */
  links: Record<string, { book_id: string; title: string; author: string }>;
}

const baseName = (f: string | null | undefined) =>
  f ? posix.basename(f.replace(/\\/g, '/')).toLowerCase() : '';

/**
 * Finds each device file's book: by md5 (a KOReader import of that file, or an earlier
 * match), then by file name against the files Moon+ knew, then by title and author. Days
 * and highlights that came from KOReader itself are left out, so nothing goes round twice.
 */
export function matchFiles(input: MatchInput): MatchResult {
  const byId = new Map(input.books.map((b) => [b.id, b]));
  const byMd5 = new Map<string, BookHistory>();
  const byFile = new Map<string, BookHistory>();
  const byKey = new Map<string, BookHistory>();
  for (const b of input.books) {
    const k = b.imports?.koreader;
    if (k) byMd5.set(k.replace(/-\d+$/, ''), b);
    for (const f of b.source_files) {
      const n = baseName(f);
      if (n && !byFile.has(n)) byFile.set(n, b);
    }
    const key = bookKey(b.title, b.author);
    if (!byKey.has(key)) byKey.set(key, b);
  }
  for (const [md5, l] of Object.entries(input.links)) {
    const b = byId.get(l.book_id);
    if (b && !byMd5.has(md5)) byMd5.set(md5, b);
  }
  const koreaderBooks = new Map((input.koreader?.books ?? []).map((b) => [b.id, b]));
  const koreaderOf = (b: BookHistory) => {
    const id = b.imports?.koreader;
    return id ? koreaderBooks.get(id) : undefined;
  };

  const result: MatchResult = { books: [], links: {} };
  const matched = new Set<string>();
  for (const f of input.files) {
    const md5 = text(f.md5, 200) || null;
    const title = text(f.title);
    const author = koreaderAuthors(f.authors);
    const book =
      (md5 && byMd5.get(md5)) ||
      byFile.get(baseName(f.file)) ||
      (title ? byKey.get(bookKey(title, author)) : undefined) ||
      (!title && f.file ? byKey.get(bookKey(posix.parse(baseName(f.file)).name, '')) : undefined);
    if (!book) {
      result.books.push({ md5, match: null });
      continue;
    }
    matched.add(book.id);
    if (md5) result.links[md5] = { book_id: book.id, title: book.title, author: book.author };
    const kb = koreaderOf(book);
    const dates = new Set((kb?.daily ?? []).map((d) => d.date));
    const texts = new Set((kb?.highlights ?? []).map((h) => normaliseText(h.text)).filter(Boolean));
    result.books.push({ md5, match: pluginBook(book, dates, input.highlights, texts) });
  }
  if (input.others) {
    result.others = [];
    for (const b of input.books) {
      if (matched.has(b.id) || b.source === 'koreader') continue;
      const kb = koreaderOf(b);
      const p = pluginBook(b, new Set((kb?.daily ?? []).map((d) => d.date)), [], new Set());
      if (p.days.length) result.others.push({ ...p, highlights: [] });
    }
  }
  return result;
}
