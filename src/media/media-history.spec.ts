import { buildMediaHistory, slug } from './media-history';
import type { ItemMeta, MediaEvent } from './media.types';

/** An episode watched at 12:00 UTC on `date`, so its local date is the same in any test time zone. */
const ep = (
  date: string,
  title: string,
  minutes: number,
  extra: Partial<MediaEvent> = {},
): MediaEvent => ({
  source: 'netflix',
  source_key: 'copper valley',
  media: 'tv',
  start: `${date}T12:00:00Z`,
  seconds: minutes * 60,
  estimated: false,
  series_title: 'Copper Valley',
  season: 1,
  title,
  ...extra,
});

const film = (
  date: string,
  title: string,
  minutes: number,
  extra: Partial<MediaEvent> = {},
): MediaEvent => ({
  source: 'netflix',
  source_key: title.toLowerCase(),
  media: 'film',
  start: `${date}T12:00:00Z`,
  seconds: minutes * 60,
  estimated: false,
  title,
  ...extra,
});

describe('slug', () => {
  it('makes safe ids', () => {
    expect(slug('Amélie & Co.: Part 2')).toBe('amelie-and-co-part-2');
    expect(slug('!!!')).toBe('untitled');
  });
});

describe('buildMediaHistory', () => {
  it('makes a season the item and the show the series', () => {
    const h = buildMediaHistory([
      ep('2025-01-04', 'Pilot', 50),
      ep('2025-01-04', 'Two', 48),
      ep('2025-01-05', 'Three', 52),
      ep('2025-03-01', 'Pilot', 50, { season: 2 }),
    ]);
    expect(h.items.map((i) => [i.id, i.title, i.series, i.series_id, i.series_no])).toEqual([
      ['tv-copper-valley-s1', 'Copper Valley: Season 1', 'Copper Valley', 'show-copper-valley', 1],
      ['tv-copper-valley-s2', 'Copper Valley: Season 2', 'Copper Valley', 'show-copper-valley', 2],
    ]);
    const s1 = h.items[0];
    // without metadata the season has as many episodes as were seen, numbered in watch order
    expect(s1).toMatchObject({
      units: 3,
      units_total: 3,
      progress: 100,
      status: 'finished',
      times: 1,
    });
    expect(h.parts.filter((p) => p.item_id === s1.id).map((p) => [p.no, p.title])).toEqual([
      [1, 'Pilot'],
      [2, 'Two'],
      [3, 'Three'],
    ]);
    expect(
      h.daily
        .filter((d) => d.item_id === s1.id)
        .map((d) => [d.date, d.minutes, d.units, d.progress]),
    ).toEqual([
      ['2025-01-04', 98, 2, 66.7],
      ['2025-01-05', 52, 1, 100],
    ]);
  });

  it('uses metadata for episode numbers, counts and genres', () => {
    const meta = new Map<string, ItemMeta>([
      [
        'tv:copper valley',
        {
          media: 'tv',
          title: 'Copper Valley',
          creator: 'A. Writer',
          genres: ['Drama', 'Mystery'],
          seasons: {
            '1': { episodes: 8, titles: { three: 3, pilot: 1 }, runtimes: { '1': 55, '3': 50 } },
          },
          ext: { tmdb_id: 42 },
        },
      ],
    ]);
    const h = buildMediaHistory(
      [ep('2025-01-04', 'Pilot', 30, { position_seconds: 52 * 60 }), ep('2025-01-05', 'Three', 20)],
      { meta },
    );
    const [s1] = h.items;
    expect(s1).toMatchObject({
      creator: 'A. Writer',
      genre: 'Drama',
      subgenre: 'Mystery',
      units_total: 8,
      units: 1,
      progress: 12.5,
      status: 'in_progress',
    });
    expect(s1.ext.tmdb_id).toBe(42);
    // the pilot reached 52 of 55 minutes (watched); episode 3 only 20 of 50
    expect(h.parts.map((p) => [p.no, p.completed])).toEqual([
      [1, true],
      [3, false],
    ]);
  });

  it('drops autoplay previews', () => {
    const h = buildMediaHistory([ep('2025-01-04', 'Pilot', 50), ep('2025-01-04', 'Two', 1)]);
    expect(h.sessions).toHaveLength(1);
    expect(h.parts).toHaveLength(1);
  });

  it('starts a re-watch after a long gap or a fresh start of a finished season', () => {
    const h = buildMediaHistory([
      ep('2024-01-04', 'Pilot', 50),
      ep('2024-01-05', 'Two', 50),
      ep('2024-03-01', 'Pilot', 50), // finished, then episode 1 again
      ep('2025-01-01', 'Two', 50), // over 180 days later
    ]);
    expect(h.runs.map((r) => [r.run_no, r.start, r.units, r.finished])).toEqual([
      [1, '2024-01-04', 2, true],
      [2, '2024-03-01', 1, false],
      [3, '2025-01-01', 1, false],
    ]);
    expect(h.items[0]).toMatchObject({ times: 3, units: 2, status: 'in_progress', progress: 50 });
  });

  it('finishes films by runtime, or after an hour without one', () => {
    const meta = new Map<string, ItemMeta>([
      ['film:metropolis', { media: 'film', runtime: 150, year: 1927 }],
    ]);
    const h = buildMediaHistory(
      [
        film('2025-01-04', 'Metropolis', 70),
        film('2025-01-05', 'Metropolis', 70), // 140 of 150 minutes: watched
        film('2025-02-01', 'Nosferatu', 40),
        film('2025-02-02', 'The General', 75),
      ],
      { meta },
    );
    const byId = Object.fromEntries(h.items.map((i) => [i.id, i]));
    expect(byId['film-metropolis-1927']).toMatchObject({
      status: 'finished',
      progress: 100,
      hours: 2.3,
      times: 1,
      units: null,
    });
    expect(byId['film-nosferatu'].status).toBe('in_progress');
    expect(byId['film-the-general'].status).toBe('finished');
  });

  it('applies the media catalogue', () => {
    const h = buildMediaHistory(
      [ep('2025-01-04', 'Pilot', 50), film('2025-01-05', 'Bad Upload', 90)],
      {
        catalogue: {
          'copper valley': { genre: 'Drama', creator: 'Someone', episodes: { '1': 10 } },
          'bad upload': { exclude: true },
        },
      },
    );
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({
      genre: 'Drama',
      creator: 'Someone',
      units_total: 10,
      progress: 10,
    });
  });

  it('splits a sitting over midnight between the two days', () => {
    const start = new Date(2025, 0, 4, 23, 30); // local time
    const h = buildMediaHistory([film('x', 'Late Show', 60, { start: start.toISOString() })]);
    expect(h.daily.map((d) => [d.date, d.minutes])).toEqual([
      ['2025-01-04', 30],
      ['2025-01-05', 30],
    ]);
  });
});
