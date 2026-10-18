import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/life-events.js');
const day = (date: string, minutes: number) => ({
  date,
  book_id: 'b',
  title: 'B',
  minutes,
  words: 0,
});
const ev = (id: string, kind: string, start: string, end: string) => ({
  id,
  title: id,
  kind,
  start,
  end,
  source: 'manual',
});

type Row = {
  id: string | null;
  kind: string;
  days: number;
  minutes: number;
  per_day: number;
  reading_days: number;
  share_read: number;
};

describe('life event reading', () => {
  // ten days of the log: 10 minutes a day, but 40 on the 3rd and 4th (a holiday)
  const daily = [
    ...['01', '02', '05', '06', '07', '08', '09', '10'].map((d) => day(`2025-06-${d}`, 10)),
    day('2025-06-03', 40),
    day('2025-06-04', 40),
  ];

  it('compares each event with normal days, clipped to the log', () => {
    const events = [
      ev('hol', 'holiday', '2025-06-03', '2025-06-04'),
      ev('move', 'move', '2025-06-10', '2025-06-20'), // runs past the log
      ev('old', 'trip', '2020-01-01', '2020-01-05'), // before the log: left out
    ];
    const rows = run<Row>('life_event_reading', { daily, life_events: events });
    expect(rows.map((r) => [r.id, r.days, r.minutes, r.per_day, r.share_read])).toEqual([
      ['hol', 2, 80, 40, 1],
      ['move', 1, 10, 10, 1],
      [null, 7, 70, 10, 1],
    ]);
  });

  it('groups by kind, normal last', () => {
    const events = [
      ev('h1', 'holiday', '2025-06-03', '2025-06-03'),
      ev('h2', 'holiday', '2025-06-04', '2025-06-04'),
      ev('j', 'job', '2025-06-08', '2025-06-08'),
    ];
    const rows = run<Row & { events: number }>('life_event_kinds', { daily, life_events: events });
    expect(rows.map((r) => [r.kind, r.events, r.per_day])).toEqual([
      ['holiday', 2, 40],
      ['job', 1, 10],
      ['normal', 0, 10],
    ]);
  });

  it('is empty without events or reading', () => {
    expect(run('life_event_reading', { daily, life_events: [] })).toEqual([]);
    expect(
      run('life_event_kinds', {
        daily: [],
        life_events: [ev('a', 'trip', '2025-01-01', '2025-01-02')],
      }),
    ).toEqual([]);
  });
});
