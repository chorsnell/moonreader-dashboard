import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/tv.js');

const season = (show: string, no: number, extra: object = {}) => ({
  id: `tv-${show}-s${no}`,
  media: 'tv',
  title: `${show}: Season ${no}`,
  creator: null,
  series: show,
  series_id: `show-${show}`,
  series_no: no,
  genre: null,
  subgenre: null,
  year: null,
  status: 'finished',
  progress: 100,
  hours: 5,
  units: 8,
  units_total: 8,
  times: 1,
  first: '2025-01-01',
  last: '2025-01-03',
  sources: ['netflix'],
  ext: {},
  ...extra,
});
const film = {
  ...season('x', 1),
  id: 'film-metropolis-1927',
  media: 'film',
  title: 'Metropolis',
  series: null,
  series_id: null,
  series_no: null,
  units: null,
  units_total: null,
};
const day = (item_id: string, date: string, minutes: number, units: number) => ({
  date,
  item_id,
  media: 'tv',
  title: '',
  creator: null,
  genre: null,
  minutes,
  units,
  progress: null,
});

const items = [
  season('a', 1),
  season('a', 2, { status: 'in_progress', progress: 25, units: 2, last: '2025-01-10' }),
  season('b', 1, {
    status: 'in_progress',
    progress: 50,
    units: 4,
    first: '2024-06-01',
    last: '2024-06-05',
  }),
  film,
];
const daily = [
  day('tv-a-s1', '2025-01-01', 150, 3),
  day('tv-a-s1', '2025-01-02', 150, 3),
  day('tv-a-s1', '2025-01-03', 100, 2),
  day('tv-a-s2', '2025-01-10', 100, 2),
  day('tv-b-s1', '2024-06-05', 200, 4),
];
const data = { media_items: items, media_daily: daily };

describe('TV & film calcs', () => {
  it('adapts media rows to book rows, with links to the show or film', () => {
    const rows = run<Record<string, unknown>>('tv_books', data);
    expect(rows[0]).toMatchObject({
      author: null,
      first_read: '2025-01-01',
      genre: 'Untagged',
      show: 'a',
      show_id: 'show-a',
    });
    expect(rows.find((m) => m.media === 'film')).toMatchObject({
      film: 'Metropolis',
      film_id: 'film-metropolis-1927',
    });
  });

  it('marks seasons finished, on the go or dropped', () => {
    const shows = run<{ show: string; seasons: { state: string }[] }>('tv_shows', data);
    expect(shows.map((s) => [s.show, s.seasons.map((x) => x.state)])).toEqual([
      ['a', ['done', 'now']],
      ['b', ['dropped']],
    ]);
    // the book "left unfinished" calc, reused: in progress and untouched for 60 days
    expect(run<{ id: string }>('tv_stalled', data).map((r) => r.id)).toEqual(['tv-b-s1']);
  });

  it('measures binges in episodes per watching day', () => {
    const b = run<{ id: string; rate: number; span: number }>('tv_binge', data);
    expect(b.find((r) => r.id === 'tv-a-s1')).toMatchObject({ rate: 8 / 3, span: 3 });
  });

  it('works out cost per hour from the subscriptions', () => {
    const s = (date: string, minutes: number, source: string) => ({
      start: `${date}T20:00:00Z`,
      date,
      item_id: 'tv-a-s1',
      media: 'tv',
      minutes,
      source,
    });
    const media_sessions = [s('2025-01-01', 300, 'netflix'), s('2025-02-01', 60, 'tautulli')];
    const media_meta = {
      subscriptions: [
        { service: 'Netflix', monthly: 10, currency: 'GBP', from: '2025-01', to: '2025-03' },
      ],
    };
    // the history runs to March, so the open months are counted up to then
    const media_daily = [...daily, day('tv-a-s2', '2025-03-20', 30, 0)];
    expect(run('tv_cost', { ...data, media_daily, media_sessions, media_meta })).toEqual([
      {
        service: 'Netflix',
        year: 2025,
        currency: 'GBP',
        months: 3,
        cost: 30,
        hours: 5,
        idle: 2,
        per_hour: 6,
      },
    ]);
    expect(run('tv_cost', { ...data, media_sessions, media_meta: [] })).toEqual([]);
  });
});
