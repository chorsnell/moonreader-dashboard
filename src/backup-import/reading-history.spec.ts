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
