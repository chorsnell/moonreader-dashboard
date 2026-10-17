import type { MetadataFile } from '../metadata/metadata.types';
import { applyFinishRules } from './finish-rules';
import type { BookHistory, Catalogue, DayEntry, ReadEntry } from './reading-history.types';

const TODAY = '2026-10-17';

function read(
  start: string,
  end: string,
  progress: number | null,
  extra: Partial<ReadEntry> = {},
): ReadEntry {
  return {
    read_no: 1,
    start,
    end,
    days_read: 2,
    minutes: 60,
    progress,
    finished: progress === null ? null : progress >= 99,
    ...extra,
  };
}

function book(id: string, reads: ReadEntry[], daily: DayEntry[] = []): BookHistory {
  const final = reads.at(-1)?.progress ?? null;
  return {
    id,
    title: id,
    author: 'Someone',
    series: null,
    series_no: null,
    genre: 'Science Fiction',
    subgenre: 'Hard SF',
    isbn13: null,
    isbn10: null,
    work_id: null,
    status: final === null ? 'unknown' : final >= 99 ? 'finished' : 'in_progress',
    progress: final,
    total_minutes: 0,
    total_words: 0,
    times_read: reads.length,
    first_read: reads[0]?.start ?? null,
    last_read: reads.at(-1)?.end ?? null,
    reads,
    daily,
    synced: null,
    source_files: [`${id}.epub`],
  };
}

const day = (date: string, minutes: number | null, words: number | null): DayEntry => ({
  date,
  minutes,
  words,
  progress: null,
});

const noMetadata: MetadataFile = { books: {}, authors: {} };
const catalogue = (books: Catalogue['books'] = {}): Catalogue => ({ books, exclude: [] });

describe('applyFinishRules', () => {
  it('counts a read that stopped in the back matter as finished once it is over', () => {
    const over = book('afterword', [read('2026-01-01', '2026-02-01', 97.5)]);
    const current = book('current', [read('2026-10-01', '2026-10-15', 97.5)]);
    const early = book('early', [read('2026-01-01', '2026-02-01', 90)]);
    applyFinishRules([over, current, early], catalogue(), noMetadata, TODAY);

    expect(over.reads[0]).toMatchObject({ finished: true, finished_by: 'near_end' });
    expect(over.status).toBe('finished');
    // opened two days ago: still being read
    expect(current.reads[0].finished).toBe(false);
    expect(current.status).toBe('in_progress');
    expect(early.reads[0].finished).toBe(false);
  });

  it('counts an earlier read at 95%+ as over, even when the latest read is current', () => {
    const b = book('reread', [
      read('2020-01-01', '2020-02-01', 96, { read_no: 1 }),
      read('2026-10-10', '2026-10-15', 40, { read_no: 2 }),
    ]);
    applyFinishRules([b], catalogue(), noMetadata, TODAY);
    expect(b.reads[0].finished_by).toBe('near_end');
    expect(b.reads[1].finished).toBe(false);
    expect(b.status).toBe('in_progress');
  });

  it('estimates old reads with no progress from the words read against the page count', () => {
    const whole = book(
      'whole',
      [read('2014-03-01', '2014-03-20', null)],
      [day('2014-03-01', 300, 50_000), day('2014-03-20', 300, 32_000)],
    );
    const half = book(
      'half',
      [read('2014-03-01', '2014-03-20', null)],
      [day('2014-03-01', 300, 40_000)],
    );
    const unknownLength = book(
      'unknown-length',
      [read('2014-03-01', '2014-03-20', null)],
      [day('2014-03-01', 300, 90_000)],
    );
    const metadata: MetadataFile = {
      books: { whole: { pages: 400 }, half: { pages: 400 } },
      authors: {},
    };
    applyFinishRules([whole, half, unknownLength], catalogue(), metadata, TODAY);

    // 400 pages × 250 words = 100,000; 82,000 is past 80%
    expect(whole.reads[0]).toMatchObject({ finished: true, finished_by: 'estimate' });
    expect(whole.status).toBe('finished');
    expect(half.reads[0].finished).toBeNull();
    expect(half.status).toBe('unknown');
    // no page count: nothing to estimate from
    expect(unknownLength.status).toBe('unknown');
  });

  it('turns minutes into words at the usual reading speed when no words were logged', () => {
    // a later book sets the speed: 250 words a minute
    const later = book(
      'later',
      [read('2022-01-01', '2022-01-02', 100)],
      [day('2022-01-01', 100, 25_000)],
    );
    const old = book(
      'old',
      [read('2013-05-01', '2013-05-10', null)],
      [day('2013-05-01', 200, null), day('2013-05-10', 200, null)],
    );
    applyFinishRules(
      [later, old],
      catalogue({ 'old.epub': { title: 'old', author: 'Someone', pages: 380 } }),
      noMetadata,
      TODAY,
    );
    // 400 min × 250 wpm = 100,000 words against 95,000
    expect(old.reads[0].finished_by).toBe('estimate');
  });

  it('follows "finished" in the catalogue: true marks the latest read, false stops the guesses', () => {
    const spin = book('spin', [read('2023-04-01', '2023-04-20', 81)]);
    const notReally = book('not-really', [read('2026-01-01', '2026-02-01', 97)]);
    applyFinishRules(
      [spin, notReally],
      catalogue({
        'spin.epub': { title: 'spin', author: 'Someone', finished: true },
        'not-really.epub': { title: 'not-really', author: 'Someone', finished: false },
      }),
      noMetadata,
      TODAY,
    );
    expect(spin.reads[0]).toMatchObject({ finished: true, finished_by: 'by_hand' });
    expect(spin.status).toBe('finished');
    expect(notReally.reads[0].finished).toBe(false);
    expect(notReally.status).toBe('in_progress');
  });

  it('leaves reads that reached 99% and books from imports alone', () => {
    const done = book('done', [read('2026-01-01', '2026-02-01', 100)]);
    const imported = {
      ...book('imported', [read('2026-01-01', '2026-02-01', 97)]),
      source: 'goodreads' as const,
    };
    applyFinishRules([done, imported], catalogue(), noMetadata, TODAY);
    expect(done.reads[0].finished_by).toBeUndefined();
    expect(imported.reads[0].finished).toBe(false);
  });
});
