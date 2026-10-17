import { loadCalcs } from '../support/feature-calcs';

type Signal = { id: string; on: boolean; text: string };
type Risk = {
  book_id: string;
  level: string;
  signals: Signal[];
  nearest: { book_id: string; finished: boolean }[];
  nearest_gave_up?: number;
};

const run = loadCalcs('calcs.js', 'features/giveup-risk.js');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const day = (s: string, n: number) => iso(Date.parse(s) + n * 864e5);

/** A read opened on the given day offsets, `step` points a day; finished or stopped where it got. */
function read(
  id: string,
  genre: string,
  start: string,
  offsets: number[],
  step: number,
  done: boolean,
) {
  const daily = offsets.map((o, i) => ({
    book_id: id,
    date: day(start, o),
    minutes: 30,
    progress: done && i === offsets.length - 1 ? 100 : Math.min(99, (i + 1) * step),
  }));
  const last = daily[daily.length - 1];
  return {
    daily,
    read: {
      read_id: id + '#1',
      book_id: id,
      title: id,
      genre,
      read_no: 1,
      start: daily[0].date,
      end: last.date,
      progress: last.progress,
      finished: done,
    },
  };
}
const every = (n: number) => Array.from({ length: n }, (_, i) => i);

const asOf = [{ date: '2026-06-30' }];
// the past: steady finished reads (every day, 5 points a day) and two given up around 25%
// after slowing and long breaks
const past = [
  ...[0, 1, 2, 3, 4].map((i) =>
    read('fin' + i, 'Classics', day('2025-01-01', i * 40), every(20), 5, true),
  ),
  read('dnf1', 'Classics', '2025-08-01', [0, 1, 2, 3, 4, 5, 6, 10, 17, 27], 2.5, false),
  read('dnf2', 'Classics', '2025-10-01', [0, 1, 2, 3, 4, 5, 6, 7, 12, 20, 31], 2.2, false),
];
const base = { reads: past.map((p) => p.read), daily: past.flatMap((p) => p.daily), as_of: asOf };
const current = (id: string, offsets: number[], step: number) => {
  const p = read(
    id,
    'Classics',
    day('2026-06-30', -offsets[offsets.length - 1] - 0),
    offsets,
    step,
    false,
  );
  return {
    p,
    row: { id, title: id, genre: 'Classics', progress: p.read.progress, start: p.read.start },
  };
};

describe('give-up risk', () => {
  it('flags a read that is slowing, with longer breaks and left alone', () => {
    // 2.5 points a day for a week, then breaks of 5, 8 and 12 days, and 14 days untouched
    const { p, row } = current('stall', [0, 1, 2, 3, 4, 5, 6, 12, 21, 34], 2.5);
    const shifted = p.daily.map((d) => ({ ...d, date: day(d.date, -14) }));
    const start = shifted[0].date;
    const [r] = run<Risk>('giveup_risk', {
      ...base,
      current: [{ ...row, start }],
      daily: [...base.daily, ...shifted],
    });
    const on = r.signals.filter((s) => s.on).map((s) => s.id);
    expect(on).toEqual(['pace', 'gaps', 'idle']);
    // both given-up books stopped near here, but most that got this far were finished
    expect(r.signals.find((s) => s.id === 'zone')!.text).toMatch(
      /^2 of your 2 given-up Classics books/,
    );
    expect(r.level).toBe('likely');
    expect(r.nearest[0].finished).toBe(false); // most like a book you gave up on
    expect(r.signals.find((s) => s.id === 'idle')!.text).toMatch(/not opened for 14 days/);
  });

  it('leaves a steady read alone', () => {
    const { p, row } = current('fine', every(20), 4);
    const [r] = run<Risk>('giveup_risk', {
      ...base,
      current: [row],
      daily: [...base.daily, ...p.daily],
    });
    expect(r.level).toBe('fine');
    expect(r.signals.filter((s) => s.on)).toEqual([]);
  });

  it('says nothing without given-up books to learn from, or this early', () => {
    const { p, row } = current('x', every(20), 4);
    const fin = past.slice(0, 5);
    const [r] = run<Risk>('giveup_risk', {
      reads: fin.map((q) => q.read),
      daily: [...fin.flatMap((q) => q.daily), ...p.daily],
      as_of: asOf,
      current: [row],
    });
    expect(r.level).toBe('unknown');
    const [early] = run<Risk>('giveup_risk', { ...base, current: [{ ...row, progress: 1 }] });
    expect(early.level).toBe('too_early');
  });
});
