import {
  ankiText,
  answer,
  type Card,
  EMPTY_STATE,
  inWords,
  MIN_AGE_DAYS,
  pickToday,
  type ReviewHighlight,
  reviewable,
  reviewKey,
  today,
  toSettings,
  toState,
} from './review';

const hl = (
  id: number,
  book_id: string,
  text: string,
  date: string | null = '2025-01-01',
  extra: Partial<ReviewHighlight> = {},
): ReviewHighlight => ({
  id,
  book_id,
  date,
  text,
  note: null,
  kind: 'highlight',
  ...extra,
});
const books = [
  { id: 'a', title: 'Alpha', author: 'Ann', genre: 'Classics' },
  { id: 'b', title: 'Beta', author: 'Bob', genre: null },
  { id: 'c', title: 'Gamma', author: 'Cy', genre: 'Horror' },
];

describe('daily highlight review', () => {
  const pool = reviewable(
    [
      hl(1, 'a', 'one'),
      hl(2, 'a', 'two'),
      hl(3, 'b', 'three'),
      hl(4, 'c', 'four'),
      hl(5, 'a', 'one', '2026-01-01'), // the same passage on a re-read
      hl(6, 'a', 'Chapter 3', null, { kind: 'bookmark' }),
      hl(7, 'gone', 'not in the library'),
      hl(8, 'b', 'fresh', '2026-10-10'),
    ],
    books,
  );

  it('keys highlights by book and text, not by id', () => {
    expect(reviewKey({ book_id: 'a', text: 'one  ', note: null })).toBe(
      reviewKey({ book_id: 'a', text: 'one', note: 'x' }),
    );
    expect(reviewKey({ book_id: 'a', text: 'one', note: null })).not.toBe(
      reviewKey({ book_id: 'b', text: 'one', note: null }),
    );
    expect(pool.size).toBe(5); // one, two, three, four, fresh
  });

  it('picks due highlights, one per book first, the same all day', () => {
    const date = '2026-10-18';
    const keys = pickToday(pool, {}, date, 3);
    expect(keys).toHaveLength(3);
    const booksOf = keys.map((k) => pool.get(k)!.book_id).sort();
    expect(booksOf).toEqual(['a', 'b', 'c']);
    expect(pickToday(pool, {}, date, 3)).toEqual(keys);
    // too new to come up yet
    expect(keys.map((k) => pool.get(k)!.text)).not.toContain('fresh');
    expect(pickToday(pool, {}, date, 10)).toHaveLength(4);
    expect(MIN_AGE_DAYS).toBe(30);
  });

  it('leaves out highlights not due and never-again ones', () => {
    const k1 = reviewKey({ book_id: 'a', text: 'one', note: null });
    const k3 = reviewKey({ book_id: 'b', text: 'three', note: null });
    const cards: Record<string, Card> = {
      [k1]: { interval: 7, due: '2026-10-25', reviews: 1, last: '2026-10-18' },
      [k3]: { interval: 7, due: '2026-10-01', never: true, reviews: 1, last: '2026-09-24' },
    };
    const keys = pickToday(pool, cards, '2026-10-18', 10);
    expect(keys).not.toContain(k1);
    expect(keys).not.toContain(k3);
    expect(keys).toHaveLength(2);
  });

  it('keeps today’s pick once made', () => {
    const first = today(EMPTY_STATE, pool, '2026-10-18');
    const again = today(
      { ...first.state, settings: { ...first.state.settings, per_day: 1 } },
      pool,
      '2026-10-18',
    );
    expect(again.keys).toEqual(first.keys);
    const next = today(first.state, pool, '2026-10-19');
    expect(next.state.today!.date).toBe('2026-10-19');
  });

  it('spaces answers out: keep doubles, less often quadruples, never retires', () => {
    const k = answer(undefined, 'keep', '2026-10-18')!;
    expect(k).toMatchObject({ interval: 7, due: '2026-10-25', reviews: 1 });
    const k2 = answer(k, 'keep', '2026-10-25')!;
    expect(k2).toMatchObject({ interval: 14, due: '2026-11-08', reviews: 2 });
    const l = answer(k2, 'less', '2026-11-08')!;
    expect(l.interval).toBe(56);
    expect(answer(undefined, 'less', '2026-10-18')!.interval).toBe(30);
    expect(answer(k2, 'never', '2026-11-08')).toMatchObject({ never: true, reviews: 3 });
    expect(answer(k2, 'reset', '2026-11-08')).toBeUndefined();
    let c: Card | undefined;
    for (let i = 0; i < 20; i++) c = answer(c, 'less', '2026-01-01');
    expect(c!.interval).toBe(1000);
  });

  it('reads settings and state defensively', () => {
    expect(toSettings({ per_day: 99, notify: 'yes', hour: 7 })).toEqual({
      per_day: 5,
      notify: false,
      hour: 7,
    });
    expect(toState('nonsense')).toEqual(EMPTY_STATE);
    expect(
      toState({ cards: { x: { due: '2026-01-01', interval: 7 }, y: { bad: 1 } } }).cards,
    ).toEqual({
      x: { due: '2026-01-01', interval: 7 },
    });
  });

  it('says when one comes back', () => {
    expect(inWords('2026-10-18', '2026-10-19')).toBe('in 1 day');
    expect(inWords('2026-10-18', '2026-11-17')).toBe('in 4 weeks');
    expect(inWords('2026-10-18', '2027-04-18')).toBe('in 6 months');
  });

  it('writes a tab-separated file Anki imports', () => {
    const p = reviewable(
      [
        hl(1, 'a', 'Line one\nline <two>', '2025-01-01', { note: 'my\tnote', progress: 50 }),
        hl(2, 'a', 'Earlier', '2025-01-01', { progress: 10 }),
        hl(3, 'b', 'retired'),
      ],
      books,
    );
    const never = {
      [reviewKey({ book_id: 'b', text: 'retired', note: null })]: {
        interval: 0,
        due: '2026-01-01',
        never: true,
        reviews: 1,
        last: null,
      },
    };
    const lines = ankiText(p, books, never).trimEnd().split('\n');
    expect(lines.slice(0, 3)).toEqual(['#separator:tab', '#html:true', '#tags column:3']);
    expect(lines).toHaveLength(5);
    expect(lines[3]).toBe('Earlier\tAlpha — Ann\thighlights Alpha Ann Classics');
    expect(lines[4]).toBe(
      'Line one<br>line &lt;two&gt;\t<i>my note</i><br><br>Alpha — Ann\thighlights Alpha Ann Classics',
    );
  });
});
