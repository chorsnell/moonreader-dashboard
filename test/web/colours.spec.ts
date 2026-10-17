import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('features/colours.js');

describe('year in colour', () => {
  it('adds up hours per book per year, in the order books were started', () => {
    const daily = [
      { date: '2024-12-30', book_id: 'a', title: 'A', author: '', genre: 'G', minutes: 60 },
      { date: '2025-01-02', book_id: 'a', title: 'A', author: '', genre: 'G', minutes: 30 },
      { date: '2025-01-01', book_id: 'b', title: 'B', author: '', genre: 'G', minutes: 90 },
    ];
    // c has no timed days, so its read's own hours count in the year it ended
    const reads = [
      {
        book_id: 'a',
        title: 'A',
        author: '',
        genre: 'G',
        start: '2024-12-30',
        end: '2025-01-02',
        hours: 1.5,
      },
      {
        book_id: 'c',
        title: 'C',
        author: '',
        genre: 'G',
        start: '2024-11-01',
        end: '2025-03-01',
        hours: 4,
      },
    ];
    const rows = run<{ year: number; book_id: string; hours: number; first: string }>(
      'year_colours',
      {
        reads,
        daily,
      },
    );
    expect(rows.map((r) => [r.year, r.book_id, r.hours, r.first])).toEqual([
      [2024, 'a', 1, '2024-12-30'],
      [2025, 'b', 1.5, '2025-01-01'],
      [2025, 'c', 4, '2025-01-01'],
      [2025, 'a', 0.5, '2025-01-02'],
    ]);
  });
});
