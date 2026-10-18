import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/on-this-day.js');
const day = (date: string, book_id: string, minutes = 20, progress = 50) => ({
  date,
  book_id,
  title: book_id.toUpperCase(),
  author: 'A',
  genre: 'Fiction',
  minutes,
  words: minutes * 250,
  progress,
});
const read = (book_id: string, start: string, end: string, finished = true, read_no = 1) => ({
  book_id,
  title: book_id.toUpperCase(),
  author: 'A',
  genre: 'Fiction',
  start,
  end,
  finished,
  read_no,
});

type Row = { date: string; years_ago: number; book_id: string; opened: boolean; event: string };

describe('on this day', () => {
  it('lists the books read on the same date in earlier years, newest first', () => {
    const daily = [
      day('2023-10-17', 'a', 10),
      day('2024-10-17', 'b', 15),
      day('2024-10-17', 'c', 40),
      day('2025-10-16', 'd'),
      day('2026-10-17', 'e'),
    ];
    const reads = [read('c', '2024-10-17', '2024-11-01'), read('b', '2024-09-01', '2024-10-17')];
    const rows = run<Row>('on_this_day', { daily, reads });
    expect(rows.map((r) => [r.date, r.years_ago, r.book_id, r.event])).toEqual([
      // 2025-10-17: nothing read and nothing on the go, so no row
      ['2024-10-17', 2, 'c', 'started'],
      ['2024-10-17', 2, 'b', 'finished'],
      ['2023-10-17', 3, 'a', null],
    ]);
  });

  it('shows what was on the go on a day without reading', () => {
    const daily = [day('2025-10-10', 'a'), day('2025-10-20', 'a'), day('2026-10-17', 'b')];
    const reads = [read('a', '2025-10-10', '2025-10-20')];
    const rows = run<Row>('on_this_day', { daily, reads });
    expect(rows).toEqual([
      expect.objectContaining({ date: '2025-10-17', book_id: 'a', opened: false }),
    ]);
  });

  it('uses 28 February for 29 February in other years', () => {
    const daily = [day('2023-02-28', 'a'), day('2024-02-29', 'b')];
    expect(run<Row>('on_this_day', { daily, reads: [] }).map((r) => r.date)).toEqual([
      '2023-02-28',
    ]);
    const later = run<Row>('on_this_day', {
      daily: [...daily, day('2028-02-29', 'c')],
      reads: [],
    });
    expect(later.map((r) => [r.date, r.years_ago])).toEqual([
      ['2024-02-29', 4],
      ['2023-02-28', 5],
    ]);
  });

  it('is empty in the first year of the log', () => {
    expect(run('on_this_day', { daily: [day('2026-01-01', 'a')], reads: [] })).toEqual([]);
  });
});
