import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

/** The fields of data/highlights.json an export uses. */
export interface HighlightRow {
  id: number;
  book_id: string;
  date: string | null;
  time: string | null;
  progress: number | null;
  chapter: number | null;
  text: string;
  note: string | null;
  colour?: string | null;
  kind: 'highlight' | 'note' | 'bookmark';
}

/** The fields of data/books.json an export uses. */
export interface BookRow {
  id: string;
  title: string;
  author: string;
  series?: string | null;
  series_no?: number | null;
  genre?: string | null;
  subgenre?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  published_year?: number | null;
  status?: string | null;
  rating?: number | null;
  first_read?: string | null;
  last_read?: string | null;
}

/** A book with its highlights and notes (no bookmarks), in the order they come in the book. */
export interface BookHighlights {
  book: BookRow;
  highlights: HighlightRow[];
}

/** Where in the book, then when: as the book page lists them. */
const byPlace = (a: HighlightRow, b: HighlightRow) =>
  (a.progress ?? 1e9) - (b.progress ?? 1e9) ||
  (a.time ?? '').localeCompare(b.time ?? '') ||
  a.id - b.id;

/** Highlights and notes grouped by book, books by title; bookmarks and unknown books left out. */
export function groupByBook(books: BookRow[], highlights: HighlightRow[]): BookHighlights[] {
  const byId = new Map(books.map((b) => [b.id, b]));
  const out = new Map<string, BookHighlights>();
  for (const h of highlights) {
    const book = byId.get(h.book_id);
    if (!book || h.kind === 'bookmark' || !(h.text || h.note)) continue;
    let g = out.get(book.id);
    if (!g) out.set(book.id, (g = { book, highlights: [] }));
    g.highlights.push(h);
  }
  for (const g of out.values()) g.highlights.sort(byPlace);
  return [...out.values()].sort(
    (a, b) => a.book.title.localeCompare(b.book.title) || a.book.id.localeCompare(b.book.id),
  );
}

// ---------- Markdown (Obsidian, Logseq) ----------

/** A file name that works on Windows, macOS and Linux, and in Obsidian links. */
export function safeFileName(s: string): string {
  const clean = s
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\p{Cc}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return clean.slice(0, 120).trim() || 'Untitled';
}

/**
 * One stable file name per book ("Title - Author.md"), so a fresh export overwrites last
 * time's files in the vault rather than adding copies. Two books that would share a name get
 * their book id added.
 */
export function markdownNames(groups: BookHighlights[]): Map<string, string> {
  const base = (b: BookRow) => safeFileName(`${b.title} - ${b.author}`);
  const counts = new Map<string, number>();
  for (const g of groups) {
    const k = base(g.book).toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Map(
    groups.map((g) => {
      const name = base(g.book);
      const clash = (counts.get(name.toLowerCase()) ?? 0) > 1;
      return [g.book.id, `${clash ? `${name} (${safeFileName(g.book.id)})` : name}.md`];
    }),
  );
}

/** A YAML scalar: JSON's double-quoted strings are valid YAML. */
const yaml = (v: string | number) => (typeof v === 'number' ? String(v) : JSON.stringify(v));

/** One book's Markdown: YAML front matter, then each highlight as a quote with its note. */
export function bookMarkdown({ book, highlights }: BookHighlights, exported: string): string {
  const front: [string, string | number | null | undefined][] = [
    ['title', book.title],
    ['author', book.author],
    ['series', book.series],
    ['series_no', book.series_no],
    ['genre', book.genre],
    ['subgenre', book.subgenre],
    ['isbn', book.isbn13 ?? book.isbn10],
    ['published', book.published_year],
    ['rating', book.rating],
    ['status', book.status],
    ['first_read', book.first_read],
    ['last_read', book.last_read],
    ['highlights', highlights.length],
    ['book_id', book.id],
    ['source', 'moonreader-dashboard'],
    ['exported', exported],
  ];
  const lines = ['---'];
  for (const [k, v] of front) if (v != null && v !== '') lines.push(`${k}: ${yaml(v)}`);
  lines.push('tags:', '  - books', '  - highlights', '---', '', `# ${book.title}`, '');
  lines.push(
    `by ${book.author}${book.series ? `, ${book.series}${book.series_no != null ? ` #${book.series_no}` : ''}` : ''}`,
    '',
  );
  lines.push('## Highlights', '');
  for (const h of highlights) {
    if (h.text) {
      for (const l of h.text.split('\n')) lines.push(l.trim() ? `> ${l}` : '>');
    }
    const meta: string[] = [];
    if (h.progress != null) meta.push(`${Math.round(h.progress)}%`);
    if (h.chapter != null) meta.push(`chapter ${h.chapter}`);
    if (h.date) meta.push(h.date);
    if (h.note) {
      if (h.text) lines.push('');
      lines.push(`**Note:** ${h.note.replace(/\n+/g, ' ')}`);
    }
    // an Obsidian block id, so a link to a highlight survives a re-export
    lines.push('', `<small>${meta.join(' · ')}</small> ^hl-${h.id}`, '');
  }
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}

// ---------- Readwise ----------

/** Readwise's CSV import columns (https://readwise.io/import_bulk). */
export const READWISE_COLUMNS = ['Highlight', 'Title', 'Author', 'URL', 'Note', 'Location', 'Date'];

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** "YYYY-MM-DD HH:MM:SS" from a local YYYY-MM-DDTHH:MM:SS (or just the date). */
const csvDate = (h: HighlightRow) =>
  h.time ? h.time.replace('T', ' ').slice(0, 19) : h.date ? `${h.date} 00:00:00` : '';

/**
 * Every highlight and note as Readwise's CSV import reads it. Location is the highlight's
 * place in the book (1, 2, 3…), which Readwise sorts by. A note with no highlighted text
 * uses the note as its highlight.
 */
export function readwiseCsv(groups: BookHighlights[]): string {
  const rows = [READWISE_COLUMNS.join(',')];
  for (const { book, highlights } of groups) {
    highlights.forEach((h, i) => {
      const text = h.text || h.note || '';
      const note = h.text ? h.note : null;
      rows.push(
        [text, book.title, book.author, '', note, i + 1, csvDate(h)].map(csvCell).join(','),
      );
    });
  }
  return rows.join('\r\n') + '\r\n';
}

/** One highlight as Readwise's v2 API takes it (https://readwise.io/api_deets). */
export interface ReadwiseHighlight {
  text: string;
  title: string;
  author: string;
  source_type: string;
  category: 'books';
  note?: string;
  location: number;
  location_type: 'order';
  highlighted_at?: string;
}

/** A highlight's key for the record of what was pushed: Readwise dedupes on text, title and author too. */
export const pushKey = (h: Pick<ReadwiseHighlight, 'text' | 'title' | 'author'>) =>
  createHash('sha256')
    .update(`${h.title}\u0000${h.author}\u0000${h.text}`)
    .digest('hex')
    .slice(0, 32);

/** Readwise's limits on field lengths. */
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Highlights for Readwise's API. Times in highlights.json are the server's local time, so
 * they're sent as the instant they were (UTC).
 */
export function readwiseHighlights(groups: BookHighlights[]): ReadwiseHighlight[] {
  const out: ReadwiseHighlight[] = [];
  for (const { book, highlights } of groups) {
    highlights.forEach((h, i) => {
      const r: ReadwiseHighlight = {
        text: cap(h.text || h.note || '', 8191),
        title: cap(book.title, 511),
        author: cap(book.author, 1024),
        source_type: 'moonreader_dashboard',
        category: 'books',
        location: i + 1,
        location_type: 'order',
      };
      if (h.text && h.note) r.note = cap(h.note, 8191);
      const at = h.time ? new Date(h.time) : null;
      if (at && !Number.isNaN(at.getTime())) r.highlighted_at = at.toISOString();
      out.push(r);
    });
  }
  return out;
}

// ---------- zip ----------

/** DOS date and time of a JS date (local time, as zip tools show it). */
function dosTime(d: Date): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date =
    ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

/**
 * A zip of the files given, stored (not compressed: Markdown of highlights is small, and
 * this keeps it to node:zlib's crc32 and no zip library). Names are UTF-8.
 */
export function zip(files: { name: string; data: Buffer | string }[], when = new Date()): Buffer {
  const [time, date] = dosTime(when);
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(0, 8); // stored
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, name, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // made by
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + data.length;
  }
  const dirSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/** The Markdown export: a folder of one file per book, zipped. */
export function markdownZip(groups: BookHighlights[], exported: string, when = new Date()): Buffer {
  const names = markdownNames(groups);
  return zip(
    groups.map((g) => ({
      name: `Highlights/${names.get(g.book.id)!}`,
      data: bookMarkdown(g, exported),
    })),
    when,
  );
}
