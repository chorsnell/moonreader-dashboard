import { loadCalcs } from '../support/feature-calcs';

type Eta = {
  book_id: string;
  status: string;
  basis?: string;
  pace_days?: number;
  sprint?: number;
  reads_compared?: number;
  days_left?: number;
  days_lo?: number;
  days_hi?: number;
  finish?: string;
  finish_lo?: string;
  finish_hi?: string;
};

const run = loadCalcs('calcs.js', 'features/finish-eta.js');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const day = (s: string, n: number) => iso(Date.parse(s) + n * 864e5);

/** A finished read: steady to 50% over `half` days, then the second half in `back` days. */
function finished(id: string, genre: string, start: string, half: number, back: number) {
  const daily: object[] = [];
  for (let i = 0; i < half; i++)
    daily.push({ book_id: id, date: day(start, i), minutes: 30, progress: ((i + 1) / half) * 50 });
  for (let i = 1; i <= back; i++)
    daily.push({
      book_id: id,
      date: day(start, half - 1 + i),
      minutes: 30,
      progress: 50 + (i / back) * 50,
    });
  const read = {
    read_id: id + '#1',
    book_id: id,
    genre,
    start,
    end: day(start, half - 1 + back),
    finished: true,
  };
  return { daily, read };
}

const asOf = [{ date: '2026-06-30' }];
// on the go: 50% after 20 days, so 20 more days at its own pace
const cur = { id: 'now', title: 'Now', genre: 'Classics', progress: 50, start: '2026-06-11' };

describe('finish-date forecast', () => {
  it('uses the pace so far alone when there is nothing to compare with', () => {
    const [e] = run<Eta>('finish_eta', { current: [cur], reads: [], daily: [], as_of: asOf });
    expect(e).toMatchObject({
      status: 'estimate',
      basis: 'pace',
      pace_days: 20,
      days_left: 20,
      days_lo: 20,
      days_hi: 20,
    });
    expect(e.finish).toBe('2026-07-20');
  });

  it('applies your usual finishing sprint, from the genre when it has enough reads', () => {
    // five Classics whose second half took 10 days, not 20
    const parts = [0, 1, 2, 3, 4].map((i) =>
      finished('c' + i, 'Classics', day('2025-01-01', i * 60), 20, 10),
    );
    // and a slow Mystery that shouldn't count
    parts.push(finished('m', 'Mystery', '2024-01-01', 10, 40));
    const [e] = run<Eta>('finish_eta', {
      current: [cur],
      reads: parts.map((p) => p.read),
      daily: parts.flatMap((p) => p.daily),
      as_of: asOf,
    });
    expect(e.basis).toBe('genre');
    expect(e.reads_compared).toBe(5);
    expect(e.sprint).toBeCloseTo(0.5, 1);
    expect(e.days_left).toBe(10);
    expect(e.finish).toBe('2026-07-10');
  });

  it('gives a range from how much those reads varied', () => {
    const parts = [5, 10, 15, 20, 30].map((back, i) =>
      finished('a' + i, 'Other', day('2025-01-01', i * 80), 20, back),
    );
    const [e] = run<Eta>('finish_eta', {
      current: [cur],
      reads: parts.map((p) => p.read),
      daily: parts.flatMap((p) => p.daily),
      as_of: asOf,
    });
    expect(e.basis).toBe('all');
    expect(e.days_left).toBe(15);
    expect(e.days_lo!).toBeLessThan(15);
    expect(e.days_hi!).toBeGreaterThan(15);
    expect(e.finish_lo! < e.finish! && e.finish! < e.finish_hi!).toBe(true);
  });

  it('says when it is too early or the progress is unknown', () => {
    const rows = run<Eta>('finish_eta', {
      current: [
        { ...cur, id: 'a', progress: 1 },
        { ...cur, id: 'b', progress: null },
      ],
      reads: [],
      daily: [],
      as_of: asOf,
    });
    expect(rows.map((r) => r.status)).toEqual(['too_early', 'unknown']);
  });
});
