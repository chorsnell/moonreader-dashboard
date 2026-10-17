import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/odometer.js');
const day = (date: string, words: number) => ({ date, book_id: 'b', minutes: 10, words });

describe('lifetime words', () => {
  it('adds up every logged word and the last 365 days', () => {
    const daily = [
      day('2024-01-01', 500_000),
      day('2025-06-01', 300_000),
      day('2025-12-31', 100_000),
    ];
    const [r] = run('lifetime_words', { daily });
    expect(r).toMatchObject({
      words: 900_000,
      words_365: 400_000,
      first_day: '2024-01-01',
      next_milestone: 1_000_000,
    });
    // 100,000 words to go at 400,000 a year: 92 days after the last day
    expect(r.milestone_eta).toBe('2026-04-02');
  });

  it('has no milestone date without recent reading', () => {
    const [r] = run('lifetime_words', {
      daily: [day('2020-01-01', 2_500_000), day('2021-06-01', 0)],
    });
    expect(r).toMatchObject({
      words: 2_500_000,
      words_365: 0,
      next_milestone: 3_000_000,
      milestone_eta: null,
    });
  });

  it('lists the yardsticks', () => {
    expect(run<{ id: string }>('word_units', {}).map((u) => u.id)).toEqual(
      expect.arrayContaining(['kjv', 'lotr', 'shelf_m']),
    );
  });
});
