import { round1 } from '../common/time';
import { buildReadingHistory, titleFromFileName } from './reading-history';
import type { HistoryInput, StatisticsRow } from './reading-history.types';

const day = (iso: string) => Date.parse(iso) / 86_400_000;

function input(statistics: StatisticsRow[], extra: Partial<HistoryInput> = {}): HistoryInput {
  return {
    catalogue: {
      books: {
        'dune.epub': {
          title: 'Dune',
          author: 'Frank Herbert',
          genre: 'Science Fiction',
          subgenre: 'Space Opera',
        },
      },
      exclude: ['manual.pdf'],
    },
    bookMeta: new Map(),
    statistics,
    positions: new Map(),
    synced: [],
    ...extra,
  };
}

const row = (filename: string, dates: string[]): StatisticsRow => ({
  filename,
  usedTime: 0,
  readWords: 0,
  dates: dates.join('\n'),
});

describe('buildReadingHistory', () => {
  it('carries ISBNs and counts editions of one work as one book', () => {
    const days = (d: string) => [`${day(d)}|60000`, `${day(d) + 1}|60000`];
    const { books } = buildReadingHistory(
      input(
        [
          row('/b/Dune.epub', days('2020-01-01')),
          row('/b/Dune (40th Anniversary).epub', days('2021-01-01')),
          row('/b/Emma.epub', days('2022-01-01')),
          row('/b/Emma - Penguin.epub', days('2023-01-01')),
          row('/b/Moonless.epub', days('2024-01-01')),
        ],
        {
          catalogue: {
            books: {
              'dune.epub': { title: 'Dune', author: 'Frank Herbert', isbn: '0-441-17271-7' },
              'dune (40th anniversary).epub': {
                title: 'Dune (40th Anniversary)',
                author: 'Frank Herbert',
                work_id: 'OL893415W',
                isbn13: '978-0-441-17271-9',
              },
              'emma.epub': { title: 'Emma', author: 'Jane Austen', work_id: 'OL66562W' },
              'emma - penguin.epub': {
                title: 'Emma (Penguin Classics)',
                author: 'Jane Austen',
                work_id: 'ol66562w',
                isbn10: 'not an isbn',
              },
            },
            exclude: [],
          },
          isbns: new Map([['/b/moonless.epub', 'urn:isbn:9780141439587']]),
        },
      ),
    );
    const by = Object.fromEntries(books.map((b) => [b.title, b]));
    expect(Object.keys(by).sort()).toEqual(['Dune', 'Emma', 'Moonless']);
    expect(by.Dune).toMatchObject({
      isbn13: '9780441172719',
      isbn10: '0441172717',
      work_id: 'OL893415W', // filled in from the other edition
      times_read: 2,
    });
    expect(by.Dune.source_files).toHaveLength(2);
    expect(by.Emma).toMatchObject({ isbn13: null, work_id: 'OL66562W', times_read: 1 });
    expect(by.Emma.source_files).toHaveLength(2);
    expect(by.Moonless.isbn13).toBe('9780141439587'); // from Moon+'s own table
  });

  it('starts a new read after a year away', () => {
    const { books } = buildReadingHistory(
      input([
        row('/b/Dune.epub', [
          `${day('2020-01-01')}|60000`,
          `${day('2020-01-02')}|60000`,
          '#100%',
          `${day('2022-06-01')}|60000`,
          `${day('2022-06-03')}|60000`,
          '#30%',
        ]),
      ]),
    );
    expect(books).toHaveLength(1);
    const [dune] = books;
    expect(dune.genre).toBe('Science Fiction');
    expect(dune.reads.map((r) => [r.start, r.finished])).toEqual([
      ['2020-01-01', true],
      ['2022-06-01', false],
    ]);
    expect(dune.status).toBe('unknown');
  });

  it('only counts a lone day as a read when there is nothing longer', () => {
    const { books } = buildReadingHistory(
      input([
        row('/b/Dune.epub', [
          `${day('2019-01-01')}|60000`,
          `${day('2021-01-01')}|60000`,
          `${day('2021-01-02')}|60000`,
        ]),
      ]),
    );
    expect(books[0].reads.map((r) => r.start)).toEqual(['2021-01-01']);
  });

  it('marks unknown books as untagged and skips excluded files', () => {
    const result = buildReadingHistory(
      input([
        row('/b/some_new_book -- 0123456789abcdef0123456789abcdef.epub', [
          `${day('2024-05-05')}|60000`,
        ]),
        row('/b/Manual.pdf', [`${day('2024-05-05')}|60000`]),
      ]),
    );
    expect(result.books.map((b) => [b.title, b.genre])).toEqual([['Some New Book', 'Untagged']]);
    expect(result.untagged).toHaveLength(1);
  });

  it('applies a newer synced position', () => {
    const later = new Date(2026, 3, 2, 9, 30).getTime();
    const { books, syncedApplied } = buildReadingHistory(
      input([row('/b/Dune.epub', [`${day('2026-03-01')}|60000`, '#20%'])], {
        synced: [{ name: 'Dune.epub.po', text: `${later}*7@0#100:83.5%`, mtimeMs: 0 }],
      }),
    );
    expect(syncedApplied).toBe(1);
    expect(books[0]).toMatchObject({
      progress: 83.5,
      last_read: '2026-04-02',
      status: 'in_progress',
    });
  });

  it('uses when the .po arrived when Moon+ stamps it with an old time', () => {
    const stale = new Date(2026, 2, 20, 23, 12).getTime();
    const arrived = new Date(2026, 9, 22, 12, 20).getTime();
    const { books } = buildReadingHistory(
      input(
        [
          row('/b/Dune.epub', [
            `${day('2026-10-14')}|60000`,
            `${day('2026-10-15')}|60000`,
            '#7.2%',
          ]),
        ],
        {
          positions: new Map([['/b/dune.epub', 7.2]]),
          synced: [{ name: 'Dune.epub.po', text: `${stale}*18@0#17816:12.9%`, mtimeMs: arrived }],
        },
      ),
    );
    expect(books[0]).toMatchObject({ progress: 12.9, last_read: '2026-10-22' });
    expect(books[0].synced).toBe('2026-10-22T12:20');
  });

  it('matches a synced position by title when its file name differs from the backup', () => {
    const later = new Date(2026, 9, 20, 22, 0).getTime();
    const result = buildReadingHistory(
      input(
        [
          row('/b/The Talisman.epub', [
            `${day('2026-10-14')}|60000`,
            `${day('2026-10-15')}|60000`,
            '#40%',
          ]),
        ],
        {
          synced: [
            {
              name: 'The Talisman - Stephen King.epub.po',
              text: `${later}*9@0#1:52.1%`,
              mtimeMs: 0,
            },
          ],
        },
      ),
    );
    expect(result.books).toHaveLength(1);
    expect(result.books[0]).toMatchObject({ progress: 52.1, last_read: '2026-10-20' });
    expect(result.titleMatchedSyncs).toEqual([
      'The Talisman - Stephen King.epub.po  ->  The Talisman',
    ]);
    expect(result.unmatchedSyncs).toEqual([]);
  });

  it('does not match a short title partially', () => {
    const later = new Date(2026, 9, 20, 22, 0).getTime();
    const result = buildReadingHistory(
      input(
        [row('/b/It.epub', [`${day('2026-10-14')}|60000`, `${day('2026-10-15')}|60000`, '#40%'])],
        {
          synced: [{ name: 'It Ends With Us.epub.po', text: `${later}*9@0#1:10%`, mtimeMs: 0 }],
        },
      ),
    );
    expect(result.books.map((b) => b.title).sort()).toEqual(['It', 'It Ends With Us']);
    expect(result.books.find((b) => b.title === 'It')!.reads.at(-1)!.progress).toBe(40);
    expect(result.unmatchedSyncs).toEqual([
      'It Ends With Us.epub.po  ->  It Ends With Us (no match in the backup)',
    ]);
  });
});

describe('titleFromFileName', () => {
  it('removes download-site junk', () => {
    expect(titleFromFileName('/x/The_Book - libgen.li.epub')).toBe('The Book');
    expect(titleFromFileName('/x/Title (BookSee.org).pdf')).toBe('Title');
  });
});

describe('round1', () => {
  it('rounds like Python: by exact value, halves to even', () => {
    expect([1.25, 0.75, 0.25, 0.15, 2.45, 1.26, 30].map(round1)).toEqual([
      1.2, 0.8, 0.2, 0.1, 2.5, 1.3, 30,
    ]);
  });
});
