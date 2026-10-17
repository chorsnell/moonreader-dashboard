import { DatabaseSync } from 'node:sqlite';
import { buildHighlights, colourFromArgb, type NoteRow, readNotes } from './highlights';
import type { BookHistory } from './reading-history.types';

const book = (id: string, files: string[], daily: [string, number | null][]): BookHistory => ({
  id,
  title: id,
  author: 'A',
  series: null,
  series_no: null,
  genre: 'G',
  subgenre: 'S',
  isbn13: null,
  isbn10: null,
  work_id: null,
  status: 'in_progress',
  progress: daily.at(-1)?.[1] ?? null,
  total_minutes: 0,
  total_words: 0,
  times_read: 1,
  first_read: daily[0]?.[0] ?? null,
  last_read: daily.at(-1)?.[0] ?? null,
  reads: daily.length
    ? [
        {
          read_no: 1,
          start: daily[0][0],
          end: daily.at(-1)![0],
          days_read: daily.length,
          minutes: null,
          progress: null,
          finished: null,
        },
      ]
    : [],
  daily: daily.map(([date, progress]) => ({ date, minutes: 10, words: 100, progress })),
  synced: null,
  source_files: files,
});

const note = (extra: Partial<NoteRow>): NoteRow => ({
  id: null,
  filename: '/sdcard/Books/Dune.epub',
  lastChapter: 2,
  lastSplitIndex: 0,
  lastPosition: 100,
  highlightLength: 10,
  highlightColor: -256,
  time: new Date(2026, 2, 2, 21, 30).getTime(),
  bookmark: null,
  note: null,
  original: 'Fear is the mind-killer.',
  underline: 0,
  strikethrough: 0,
  ...extra,
});

describe('readNotes', () => {
  it('gives nothing when there is no notes table', () => {
    const db = new DatabaseSync(':memory:');
    expect(readNotes(db)).toEqual([]);
  });

  it('reads only the columns there are', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      'create table notes (_id integer primary key, filename text, time numeric, original text)',
    );
    db.prepare('insert into notes (filename, time, original) values (?, ?, ?)').run(
      '/b/Dune.epub',
      1508168642011,
      'text',
    );
    const [row] = readNotes(db);
    expect(row).toMatchObject({ id: 1, filename: '/b/Dune.epub', time: 1508168642011 });
    expect(row.highlightColor).toBeNull();
    expect(row.note).toBeNull();
  });

  it('gives nothing without a file name to tie notes to books', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('create table notes (_id integer primary key, original text)');
    db.exec("insert into notes (original) values ('x')");
    expect(readNotes(db)).toEqual([]);
  });
});

describe('buildHighlights', () => {
  const dune = book(
    'dune',
    ['Dune.epub'],
    [
      ['2026-03-01', 10],
      ['2026-03-02', 30],
    ],
  );

  it('ties notes to books by file name and drops the rest', () => {
    const { highlights, unmatched } = buildHighlights(
      [dune],
      [note({ id: 7 }), note({ filename: '/sdcard/manual.pdf' })],
    );
    expect(unmatched).toBe(1);
    expect(highlights).toEqual([
      {
        id: 7,
        book_id: 'dune',
        date: '2026-03-02',
        time: '2026-03-02T21:30:00',
        progress: 20,
        chapter: 3,
        text: 'Fear is the mind-killer.',
        note: null,
        colour: '#ffff00',
        kind: 'highlight',
      },
    ]);
  });

  it('tells highlights, notes and bookmarks apart', () => {
    const { highlights } = buildHighlights(
      [dune],
      [
        note({ id: 1, original: 'a<BR>b' }),
        note({ id: 2, note: 'my thought' }),
        note({ id: 3, original: '', bookmark: 'Chapter 4', highlightLength: 0 }),
        note({ id: 4, original: '', note: '' }),
      ],
    );
    expect(highlights.map((h) => [h.id, h.kind, h.text, h.colour])).toEqual([
      [1, 'highlight', 'a\nb', '#ffff00'],
      [2, 'note', 'Fear is the mind-killer.', '#ffff00'],
      [3, 'bookmark', 'Chapter 4', null],
    ]);
  });

  it("spreads a day's notes in book order across that day's progress", () => {
    const at = (h: number) => new Date(2026, 2, 2, h).getTime();
    const { highlights } = buildHighlights(
      [dune],
      [
        note({ id: 1, lastChapter: 5, time: at(9) }),
        note({ id: 2, lastChapter: 1, time: at(10) }),
        note({ id: 3, lastChapter: 3, time: at(11) }),
      ],
    );
    expect(highlights.map((h) => [h.id, h.progress])).toEqual([
      [1, 25],
      [2, 15],
      [3, 20],
    ]);
  });

  it('takes seconds as well as milliseconds, and copes with no time', () => {
    const secs = Math.floor(new Date(2026, 2, 1, 8).getTime() / 1000);
    const { highlights } = buildHighlights([dune], [note({ time: secs }), note({ time: null })]);
    expect(highlights.map((h) => [h.time, h.progress])).toEqual([
      [null, null],
      ['2026-03-01T08:00:00', 5],
    ]);
  });
});

describe('colourFromArgb', () => {
  it('drops the alpha', () => {
    expect(colourFromArgb(-28160)).toBe('#ff9200');
    expect(colourFromArgb(1996532479)).toBe('#00aaff');
    expect(colourFromArgb(null)).toBeNull();
  });
});
