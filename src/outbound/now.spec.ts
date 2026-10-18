import { PRESETS } from '../privacy/privacy';
import { nowSummary, quoteIndex, streakOf, weekStart, type NowInputs } from './now';

const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;

const base: NowInputs = {
  books: [],
  reads: [
    { book_id: 'a', finished: true, end: '2026-02-01' },
    { book_id: 'b', finished: true, end: '2026-06-01' },
    { book_id: 'c', finished: false, end: '2026-10-17' },
    { book_id: 'd', finished: true, end: '2025-12-31' },
  ],
  daily: [
    { date: day(12), book_id: 'c', minutes: 30, words: 100 },
    { date: day(13), book_id: 'c', minutes: 20.4, words: 100 },
    { date: day(14), book_id: 'c', minutes: 10, words: 100 },
    { date: day(15), book_id: 'c', minutes: 15, words: 100 },
    { date: day(15), book_id: 'a', minutes: 5, words: 10 },
  ],
  current: [
    { id: 'c', title: 'Gamma', author: 'Cy', genre: 'Fantasy', progress: 38, last_read: day(15) },
  ],
  quotes: [
    { book_id: 'a', text: 'First quote', note: null, title: 'Alpha', author: 'Ann' },
    { book_id: 'b', text: 'Second quote', note: 'mine', title: 'Beta', author: 'Bob' },
  ],
  asOf: [{ date: day(15) }],
  generated: '2026-10-15T20:00:00',
  covers: { c: 'covers/c.jpg?v=1' },
  policy: null,
  goal: 24,
  today: day(16),
};

describe('streakOf', () => {
  it('counts the run up to yesterday and flags it at risk until you read today', () => {
    const s = streakOf([day(12), day(13), day(14), day(15)], day(16));
    expect(s).toEqual({
      current: 4,
      best: 4,
      last_day: day(15),
      read_today: false,
      at_risk: true,
    });
    const t = streakOf([day(12), day(13), day(14), day(15), day(16)], day(16));
    expect(t).toMatchObject({ current: 5, read_today: true, at_risk: false });
  });

  it('is broken after a missed day, and ignores days after today and repeats', () => {
    const s = streakOf([day(1), day(2), day(3), day(3), day(10), day(20)], day(16));
    expect(s).toMatchObject({ current: 0, best: 3, last_day: day(10), at_risk: false });
    expect(streakOf([], day(16))).toMatchObject({ current: 0, best: 0, last_day: null });
  });
});

describe('weekStart and quoteIndex', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // a Sunday
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
  });

  it('picks the same quote as the page for a day', () => {
    // FNV-1a of "2026-10-18", as web/features/quote-of-the-day.js works it out
    let x = 2166136261;
    for (const c of '2026-10-18') x = Math.imul(x ^ c.codePointAt(0)!, 16777619);
    expect(quoteIndex('2026-10-18', 7)).toBe((x >>> 0) % 7);
  });
});

describe('nowSummary', () => {
  it('sums up now for the admin', () => {
    const s = nowSummary(base);
    expect(s.reading).toEqual([
      {
        id: 'c',
        title: 'Gamma',
        author: 'Cy',
        genre: 'Fantasy',
        progress: 38,
        last_read: day(15),
        cover: 'covers/c.jpg?v=1',
      },
    ]);
    expect(s.today_minutes).toBe(0);
    expect(s.week_minutes).toBe(80); // Monday the 12th on
    expect(s.streak).toMatchObject({ current: 4, at_risk: true });
    expect(s.year).toMatchObject({ year: 2026, finished: 2, goal: 24, percent: 8 });
    // 289 of 365 days in
    expect(s.year.expected).toBe(19);
    expect(s.year.ahead).toBe(-17);
    expect(s.quote?.text).toMatch(/quote/);
    expect(s.as_of).toBe(day(15));
  });

  it('leaves out what the policy hides', () => {
    const s = nowSummary({ ...base, policy: PRESETS.taste });
    expect(s.reading).toBeNull();
    expect(s.today_minutes).toBeNull();
    expect(s.week_minutes).toBeNull();
    expect(s.streak).toBeNull();
    // days rounded to weeks: this week's minutes add up, but no streak or today
    const w = nowSummary({ ...base, policy: { ...PRESETS.everything, dates: 'week' } });
    expect(w.reading).not.toBeNull();
    expect(w.week_minutes).toBe(80);
    expect(w.today_minutes).toBeNull();
    expect(w.streak).toBeNull();
    // streaks hidden on their own
    const n = nowSummary({ ...base, policy: { ...PRESETS.everything, streaks: false } });
    expect(n.streak).toBeNull();
    expect(n.today_minutes).toBeNull();
    expect(n.week_minutes).toBe(80);
  });

  it('copes with no goal, no data and no quotes', () => {
    const s = nowSummary({
      ...base,
      goal: null,
      reads: undefined,
      daily: undefined,
      current: undefined,
      quotes: [],
      asOf: undefined,
    });
    expect(s.year).toEqual({
      year: 2026,
      finished: 0,
      goal: null,
      percent: null,
      expected: null,
      ahead: null,
    });
    expect(s.reading).toEqual([]);
    expect(s.quote).toBeNull();
    expect(s.streak).toMatchObject({ current: 0 });
  });
});
