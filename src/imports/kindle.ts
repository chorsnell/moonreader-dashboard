import { daysBetween, localDate, localDateTime, round1 } from '../common/time';
import { GAP_DAYS } from '../backup-import/reading-history';
import type { DayEntry } from '../backup-import/reading-history.types';
import type { ImportedBook, ImportedHighlight, ImportedRead } from './imports.types';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * A Kindle "Added on" date, in the device's local time: "Sunday, 14 March 2021 21:03:11"
 * (UK) or "Sunday, March 14, 2021 9:03:11 PM" (US). Null if it isn't one.
 */
export function clippingTime(raw: string): string | null {
  const s = raw.replace(/^\s*\w+,\s*/, '').trim();
  const month = (name: string) => MONTHS.findIndex((m) => m.startsWith(name.toLowerCase()));
  let m = /^(\d{1,2}) (\p{L}+) (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/iu.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[3]), month(m[2]), Number(m[1])];
  else {
    m = /^(\p{L}+) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/iu.exec(s);
    if (!m) return null;
    [y, mo, d] = [Number(m[3]), month(m[1]), Number(m[2])];
  }
  if (mo < 0) return null;
  let h = Number(m[4]);
  const pm = m[7]?.toUpperCase();
  if (pm === 'PM' && h < 12) h += 12;
  if (pm === 'AM' && h === 12) h = 0;
  return localDateTime(new Date(y, mo, d, h, Number(m[5]), Number(m[6] ?? 0)));
}

/** "Pride and Prejudice (Austen, Jane)" -> title and author ("Jane Austen"). */
function titleAuthor(line: string): { title: string; author: string } {
  const clean = line.replace(/[﻿​]/g, '').trim();
  const m = /^(.*)\(([^()]*)\)\s*$/.exec(clean);
  if (!m) return { title: clean, author: '' };
  let author = m[2].trim();
  const parts = author.split(',').map((p) => p.trim());
  if (parts.length === 2 && !author.includes(';')) author = `${parts[1]} ${parts[0]}`;
  return { title: m[1].trim(), author };
}

/** A Kindle's My Clippings.txt: highlights, notes and bookmarks, grouped by book. */
export function parseClippings(text: string): ImportedBook[] {
  const books = new Map<string, ImportedBook>();
  for (const block of text.split(/^==========\s*$/m)) {
    const lines = block.split(/\r?\n/);
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length < 2) continue;
    const { title, author } = titleAuthor(lines[0]);
    const meta = lines[1];
    const kind = /Your (Highlight|Note|Bookmark)/i.exec(meta)?.[1].toLowerCase();
    if (!title || !kind) continue;
    const loc = /Location (\d+)(?:-(\d+))?/i.exec(meta);
    const added = /Added on (.+)$/i.exec(meta);
    const body = lines.slice(2).join('\n').trim();
    if (kind !== 'bookmark' && !body) continue;
    const key = `${title}|${author}`.toLowerCase();
    let book = books.get(key);
    if (!book) {
      book = {
        id: `${title} (${author})`,
        title,
        author,
        isbn13: null,
        isbn10: null,
        rating: null,
        shelves: [],
        shelf: '',
        read_count: 0,
        date_added: null,
        pages: null,
        reads: [],
        highlights: [],
      };
      books.set(key, book);
    }
    const h: ImportedHighlight & { end: number | null } = {
      time: added ? clippingTime(added[1]) : null,
      progress: null,
      chapter: null,
      location: loc ? Number(loc[1]) : null,
      end: loc ? Number(loc[2] ?? loc[1]) : null,
      text: body || 'Bookmark',
      note: null,
      kind: kind as ImportedHighlight['kind'],
    };
    const list = book.highlights!;
    // a note belongs to the highlight it was typed on, which ends at its location
    if (h.kind === 'note' && h.location !== null) {
      const on = list.find(
        (x) =>
          x.kind === 'highlight' &&
          x.location !== null &&
          x.location <= h.location! &&
          ((x as typeof h).end ?? x.location) >= h.location!,
      );
      if (on) {
        on.note = h.text;
        on.kind = 'note';
        continue;
      }
    }
    // a highlight edited on the device is added again: keep the newest
    const same = list.findIndex((x) => x.kind === h.kind && x.location === h.location);
    if (same >= 0 && h.location !== null) list.splice(same, 1);
    list.push(h);
  }
  for (const b of books.values()) {
    for (const h of b.highlights!) delete (h as { end?: number | null }).end;
    b.highlights!.sort((x, y) => (x.location ?? 0) - (y.location ?? 0));
  }
  return [...books.values()];
}

const pick = (r: Record<string, string>, ...names: string[]) => {
  for (const n of names) if (r[n] !== undefined && r[n] !== '') return r[n];
  return '';
};

export const SESSION_START = ['start_timestamp', 'start_time', 'Start Time', 'StartTime'];
export const SESSION_MILLIS = [
  'total_reading_millis',
  'reading_time_millis',
  'total_reading_milliseconds',
  'TotalReadingMillis',
];
export const ASIN = ['ASIN', 'asin', 'Asin'];
export const TITLE = ['Title', 'title', 'Product Name', 'product_name', 'ProductName'];
export const AUTHOR = ['Author', 'author', 'Authors', 'Contributors'];

/** A timestamp from Amazon's export (UTC, with or without a "Z"), or null. */
function amazonTime(raw: string): Date | null {
  let s = raw.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Amazon's Kindle reading sessions (Request your data → Kindle →
 * Kindle.Devices.ReadingSession): minutes per book per local day, keyed by ASIN, and reads
 * split where a book was left for a year, like Moon+'s. Kindle doesn't say how far you got.
 */
export function parseKindleSessions(
  records: Record<string, string>[],
  titles: Map<string, { title: string; author: string }> = new Map(),
): ImportedBook[] {
  const byAsin = new Map<string, Map<string, DayEntry>>();
  const named = new Map<string, { title: string; author: string }>();
  for (const r of records) {
    const asin = pick(r, ...ASIN).toUpperCase();
    const start = amazonTime(pick(r, ...SESSION_START));
    const ms = Number(pick(r, ...SESSION_MILLIS));
    if (!asin || !start || !(ms > 0)) continue;
    const title = pick(r, ...TITLE);
    if (title) named.set(asin, { title, author: pick(r, ...AUTHOR) });
    const date = localDate(start);
    const days = byAsin.get(asin) ?? new Map<string, DayEntry>();
    byAsin.set(asin, days);
    const d = days.get(date) ?? { date, minutes: 0, words: null, progress: null };
    d.minutes = round1((d.minutes ?? 0) + ms / 60000);
    days.set(date, d);
  }
  const books: ImportedBook[] = [];
  for (const [asin, map] of byAsin) {
    const daily = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    const reads: ImportedRead[] = [];
    let run: DayEntry[] = [];
    const close = () => {
      if (!run.length) return;
      reads.push({
        start: run[0].date,
        end: run[run.length - 1].date,
        finished: null,
        minutes: round1(run.reduce((s, d) => s + (d.minutes ?? 0), 0)),
      });
      run = [];
    };
    for (const d of daily) {
      if (run.length && daysBetween(run[run.length - 1].date, d.date) >= GAP_DAYS) close();
      run.push(d);
    }
    close();
    const name = titles.get(asin) ?? named.get(asin);
    books.push({
      id: asin,
      title: name?.title || `Kindle book ${asin}`,
      author: name?.author ?? '',
      isbn13: null,
      isbn10: null,
      rating: null,
      shelves: [],
      shelf: '',
      read_count: 0,
      date_added: null,
      pages: null,
      reads,
      daily,
    });
  }
  return books;
}

/** A list of Kindle books with their ASIN and title (e.g. Amazon's digital orders): ASIN -> title. */
export function parseKindleTitles(
  records: Record<string, string>[],
): Map<string, { title: string; author: string }> {
  const out = new Map<string, { title: string; author: string }>();
  for (const r of records) {
    const asin = pick(r, ...ASIN).toUpperCase();
    const title = pick(r, ...TITLE);
    if (asin && title) out.set(asin, { title, author: pick(r, ...AUTHOR) });
  }
  return out;
}
