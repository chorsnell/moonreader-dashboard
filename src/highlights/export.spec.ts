import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yauzl from 'yauzl';
import {
  bookMarkdown,
  type BookRow,
  groupByBook,
  type HighlightRow,
  markdownNames,
  markdownZip,
  pushKey,
  readwiseCsv,
  readwiseHighlights,
  safeFileName,
} from './export';

const book = (id: string, title: string, extra: Partial<BookRow> = {}): BookRow => ({
  id,
  title,
  author: 'Ann Author',
  ...extra,
});
const hl = (id: number, book_id: string, text: string, extra: Partial<HighlightRow> = {}) =>
  ({
    id,
    book_id,
    date: '2024-03-01',
    time: '2024-03-01T21:30:00',
    progress: 10,
    chapter: 2,
    text,
    note: null,
    kind: 'highlight',
    ...extra,
  }) as HighlightRow;

const books = [
  book('a', 'Alpha: A "Story"', {
    rating: 4,
    series: 'Saga',
    series_no: 1,
    isbn13: '9780000000002',
  }),
  book('b', 'Beta'),
];
const highlights = [
  hl(1, 'a', 'Later, with "quotes", and a comma', { progress: 80 }),
  hl(2, 'a', 'Early\nsecond line', { progress: 5, note: 'Mine', kind: 'note' }),
  hl(3, 'b', 'Chapter 3', { kind: 'bookmark' }),
  hl(4, 'b', '', { note: 'Only a note', kind: 'note', time: null, date: '2024-01-01' }),
  hl(5, 'gone', 'From a book no longer here'),
];
const groups = groupByBook(books, highlights);

/** The files in a zip, as name → text. */
async function unzip(buf: Buffer): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), 'zip-'));
  const file = join(dir, 'x.zip');
  await writeFile(file, buf);
  try {
    return await new Promise((resolve, reject) => {
      const out: Record<string, string> = {};
      yauzl.open(file, { lazyEntries: true }, (err, z) => {
        if (err) return reject(err);
        z.on('entry', (e: yauzl.Entry) =>
          z.openReadStream(e, (err2, s) => {
            if (err2) return reject(err2);
            const chunks: Buffer[] = [];
            s.on('data', (c: Buffer) => chunks.push(c));
            s.on('end', () => {
              out[e.fileName] = Buffer.concat(chunks).toString('utf8');
              z.readEntry();
            });
          }),
        );
        z.on('end', () => resolve(out));
        z.on('error', reject);
        z.readEntry();
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('highlights export', () => {
  it('groups highlights and notes by book, in book order, without bookmarks', () => {
    expect(groups.map((g) => [g.book.id, g.highlights.map((h) => h.id)])).toEqual([
      ['a', [2, 1]],
      ['b', [4]],
    ]);
  });

  it('names each book’s file the same way every time', () => {
    expect(safeFileName('A/B: "C"? <D>')).toBe('A B C D');
    expect([...markdownNames(groups).values()]).toEqual([
      'Alpha A Story - Ann Author.md',
      'Beta - Ann Author.md',
    ]);
    const twins = groupByBook(
      [book('x1', 'Same'), book('x2', 'Same')],
      [hl(1, 'x1', 'one'), hl(2, 'x2', 'two')],
    );
    expect([...markdownNames(twins).values()]).toEqual([
      'Same - Ann Author (x1).md',
      'Same - Ann Author (x2).md',
    ]);
  });

  it('writes Markdown with front matter and quoted highlights', () => {
    const md = bookMarkdown(groups[0], '2026-10-18');
    expect(md).toContain(
      '---\ntitle: "Alpha: A \\"Story\\""\nauthor: "Ann Author"\nseries: "Saga"',
    );
    expect(md).toContain('isbn: "9780000000002"\n');
    expect(md).toContain('rating: 4\n');
    expect(md).toContain(
      '> Early\n> second line\n\n**Note:** Mine\n\n<small>5% · chapter 2 · 2024-03-01</small> ^hl-2',
    );
    expect(md.indexOf('Early')).toBeLessThan(md.indexOf('Later'));
    const noteOnly = bookMarkdown(groups[1], '2026-10-18');
    expect(noteOnly).toContain('**Note:** Only a note');
    expect(noteOnly).not.toMatch(/^>/m);
  });

  it('zips a file per book that unzips again', async () => {
    const files = await unzip(markdownZip(groups, '2026-10-18'));
    expect(Object.keys(files)).toEqual([
      'Highlights/Alpha A Story - Ann Author.md',
      'Highlights/Beta - Ann Author.md',
    ]);
    expect(files['Highlights/Beta - Ann Author.md']).toBe(bookMarkdown(groups[1], '2026-10-18'));
  });

  it('writes Readwise’s CSV columns, quoting where needed', () => {
    const csv = readwiseCsv(groups).split('\r\n');
    expect(csv[0]).toBe('Highlight,Title,Author,URL,Note,Location,Date');
    expect(csv[1]).toBe(
      '"Early\nsecond line","Alpha: A ""Story""",Ann Author,,Mine,1,2024-03-01 21:30:00',
    );
    expect(csv[2]).toBe(
      '"Later, with ""quotes"", and a comma","Alpha: A ""Story""",Ann Author,,,2,2024-03-01 21:30:00',
    );
    expect(csv[3]).toBe('Only a note,Beta,Ann Author,,,1,2024-01-01 00:00:00');
  });

  it('builds Readwise API highlights with a stable key', () => {
    const r = readwiseHighlights(groups);
    expect(r[0]).toMatchObject({
      text: 'Early\nsecond line',
      title: 'Alpha: A "Story"',
      author: 'Ann Author',
      note: 'Mine',
      location: 1,
      location_type: 'order',
      category: 'books',
      source_type: 'moonreader_dashboard',
    });
    expect(r[0].highlighted_at).toMatch(/^2024-03-01T\d\d:30:00\.000Z$/);
    expect(r[2]).not.toHaveProperty('highlighted_at');
    expect(pushKey(r[0])).toBe(
      pushKey({ text: r[0].text, title: r[0].title, author: r[0].author }),
    );
    expect(pushKey(r[0])).not.toBe(pushKey(r[1]));
  });
});
