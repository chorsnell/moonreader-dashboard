import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KINDLE_SESSIONS,
  KINDLE_TITLES,
  MY_CLIPPINGS,
  makeKoboDb,
} from '../../test/support/fake-kobo';
import { csvRecords } from './csv';
import { detectUpload } from './detect';
import { clippingTime, parseClippings, parseKindleSessions } from './kindle';
import { koboTime, readKobo } from './kobo';

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'devices-'));
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

describe('Kobo', () => {
  it('reads times with or without a zone', () => {
    expect(koboTime('2026-03-05T20:00:00Z')?.toISOString()).toBe('2026-03-05T20:00:00.000Z');
    expect(koboTime('2026-03-05 20:00:00.000')?.toISOString()).toBe('2026-03-05T20:00:00.000Z');
    expect(koboTime('')).toBeNull();
    expect(koboTime('1970-01-01T00:00:00')).toBeNull();
  });

  it('reads books, reads, days and highlights from KoboReader.sqlite', () => {
    const path = join(tmp, 'KoboReader.sqlite');
    makeKoboDb(path);
    const books = readKobo(path);
    expect(books.map((b) => b.title)).toEqual(['Alpha', 'Kobo Only Book']);
    const [alpha, only] = books;
    expect(alpha).toMatchObject({
      shelf: 'read',
      progress: 100,
      reads: [{ start: '2026-03-04', end: '2026-03-05', finished: true, minutes: 90 }],
      daily: [],
    });
    expect(alpha.highlights).toHaveLength(1);
    expect(only).toMatchObject({
      id: 'kobo-store-0001',
      author: 'Kit Kobo',
      isbn13: '9780141439518',
      series: 'Kobo Saga',
      series_no: 2,
      shelf: 'currently-reading',
      progress: 40,
      date_added: '2026-02-20',
      reads: [{ start: '2026-03-01', end: '2026-03-03', finished: false, progress: 40 }],
    });
    expect(only.daily).toEqual([
      { date: '2026-03-01', minutes: 30, words: null, progress: 20 },
      { date: '2026-03-03', minutes: 30, words: null, progress: 40 },
    ]);
    expect(only.highlights).toEqual([
      expect.objectContaining({ text: 'A line worth keeping.', note: null, kind: 'highlight' }),
      expect.objectContaining({ text: 'Another line.', note: 'My thought', kind: 'note' }),
    ]);
  });
});

describe('Kindle', () => {
  it('reads UK and US clipping dates as local times', () => {
    expect(clippingTime('Sunday, 14 March 2021 21:03:11')).toBe('2021-03-14T21:03:11');
    expect(clippingTime('Tuesday, March 16, 2021 9:15:02 PM')).toBe('2021-03-16T21:15:02');
    expect(clippingTime('Tuesday, March 16, 2021 12:05:00 AM')).toBe('2021-03-16T00:05:00');
    expect(clippingTime('nonsense')).toBeNull();
  });

  it('reads My Clippings.txt, putting notes on their highlight', () => {
    const books = parseClippings(MY_CLIPPINGS);
    expect(books.map((b) => [b.title, b.author])).toEqual([
      ['Pride and Prejudice', 'Jane Austen'],
      ['Beta', 'Bob Writer'],
    ]);
    expect(books[0].highlights).toEqual([
      {
        time: '2021-03-14T21:03:11',
        progress: null,
        chapter: null,
        location: 7,
        text: 'It is a truth universally acknowledged.',
        note: 'The famous opening.',
        kind: 'note',
      },
      expect.objectContaining({ location: 400, kind: 'bookmark', text: 'Bookmark' }),
    ]);
    expect(books[1].highlights).toEqual([
      expect.objectContaining({ location: 120, text: 'Beta has a line.' }),
    ]);
  });

  it('turns reading sessions into minutes per day', () => {
    const books = parseKindleSessions(csvRecords(KINDLE_SESSIONS).records);
    expect(books).toEqual([
      expect.objectContaining({
        id: 'B00ABCDEF1',
        title: 'Kindle book B00ABCDEF1',
        daily: [
          { date: '2026-02-10', minutes: 40, words: null, progress: null },
          { date: '2026-02-12', minutes: 45, words: null, progress: null },
        ],
        reads: [{ start: '2026-02-10', end: '2026-02-12', finished: null, minutes: 85 }],
      }),
    ]);
  });
});

describe('detectUpload', () => {
  const write = async (name: string, text: string) => {
    const p = join(tmp, name);
    await writeFile(p, text);
    return p;
  };

  it('tells the files apart by their contents', async () => {
    const kobo = join(tmp, 'k.sqlite');
    makeKoboDb(kobo);
    expect(await detectUpload(kobo)).toMatchObject({ kind: 'books', source: 'kobo' });
    expect(await detectUpload(await write('a.txt', MY_CLIPPINGS))).toMatchObject({
      source: 'kindle_clippings',
    });
    const titles = await detectUpload(await write('t.csv', KINDLE_TITLES));
    expect(titles.kind).toBe('titles');
    const sessions = await detectUpload(
      await write('s.csv', KINDLE_SESSIONS),
      titles.kind === 'titles' ? titles.titles : undefined,
    );
    expect(sessions).toMatchObject({
      source: 'kindle',
      books: [{ title: 'The Kindle Book', author: 'Kay Kindle' }],
    });
    await expect(detectUpload(await write('x.csv', 'a,b\n1,2\n'))).rejects.toThrow(
      /KoboReader.sqlite/,
    );
  });
});
