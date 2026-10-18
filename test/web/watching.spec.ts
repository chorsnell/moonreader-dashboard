import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/tv.js', 'features/watching-and-reading.js');

const book = (id: string, title: string) => ({
  id,
  title,
  author: 'Someone',
  genre: 'Classics',
  status: 'finished',
  first_read: '2024-01-01',
});
const item = (id: string, media: string, title: string, first: string, extra: object = {}) => ({
  id,
  media,
  title,
  series: media === 'tv' ? title : null,
  series_id: media === 'tv' ? `show-${id}` : null,
  series_no: media === 'tv' ? 1 : null,
  status: 'finished',
  first,
  adapts: null,
  ...extra,
});

describe('reading and watching', () => {
  it('splits hours per month by medium (audiobooks as listening), with empty months', () => {
    const rows = run('x_split_month', {
      daily: [{ date: '2025-01-05', book_id: 'a', title: 'A', minutes: 120 }],
      media_daily: [
        { date: '2025-02-10', item_id: 'b', media: 'audiobook', title: 'B', minutes: 30 },
        { date: '2025-03-01', item_id: 'f', media: 'film', title: 'F', minutes: 90 },
      ],
    });
    expect(rows).toEqual([
      { month: '2025-01', reading: 2, watching: 0, listening: 0 },
      { month: '2025-02', reading: 0, watching: 0, listening: 0.5 },
      { month: '2025-03', reading: 0, watching: 1.5, listening: 0 },
    ]);
  });

  it('compares reading in big TV weeks with weeks without TV', () => {
    const daily = [];
    const media_daily = [];
    // 2025-01-06 is a Monday; 12 weeks, TV in every third week, little reading in those
    for (let w = 0; w < 12; w++) {
      const date = new Date(Date.UTC(2025, 0, 6 + w * 7)).toISOString().slice(0, 10);
      const tv = w % 3 === 0;
      daily.push({ date, book_id: 'a', title: 'A', minutes: tv ? 30 : 180 });
      if (tv) media_daily.push({ date, item_id: 's', media: 'tv', title: 'S', minutes: 240 });
    }
    const [first] = run<{ summary: Record<string, number> }>('x_weeks', { daily, media_daily });
    expect(first.summary).toMatchObject({ weeks: 10, read_heavy: 0.5, read_none: 3 });
    expect(first.summary.r).toBeLessThan(-0.9);
  });

  it('finds adaptations by title or by the catalogue, and which came first', () => {
    const rows = run<Record<string, unknown>>('x_adaptations', {
      books: [book('dracula', 'Dracula'), book('lost-world', 'The Lost World')],
      reads: [
        { book_id: 'dracula', start: '2024-03-01' },
        { book_id: 'lost-world', start: '2023-01-01' },
      ],
      media_items: [
        item('film-nosferatu-1922', 'film', 'Nosferatu', '2024-01-01', { adapts: 'Dracula' }),
        item('film-the-lost-world-1925', 'film', 'Lost World', '2024-01-01'),
        item('film-metropolis', 'film', 'Metropolis', '2024-01-01'),
      ],
      media_runs: [],
    });
    const got = rows.map((r) => [r.book_id, r.film_id, r.first, r.gap_days]);
    expect(got.sort()).toEqual([
      ['dracula', 'film-nosferatu-1922', 'watched', 60],
      ['lost-world', 'film-the-lost-world-1925', 'read', 365],
    ]);
  });

  it('sums a year on screen for Wrapped, and leaves out years with nothing watched or heard', () => {
    const rows = run('x_year_screen', {
      daily: [
        { date: '2024-03-01', book_id: 'a', title: 'A', minutes: 600 },
        { date: '2025-01-05', book_id: 'a', title: 'A', minutes: 120 },
      ],
      media_daily: [
        { date: '2025-02-10', item_id: 'ab', media: 'audiobook', title: 'AB', minutes: 90 },
        { date: '2025-03-01', item_id: 'f', media: 'film', title: 'F', minutes: 90 },
        { date: '2025-03-02', item_id: 's1', media: 'tv', title: 'S1', minutes: 120 },
        { date: '2025-03-03', item_id: 's2', media: 'tv', title: 'S2', minutes: 60 },
        { date: '2025-03-04', item_id: 't1', media: 'tv', title: 'T1', minutes: 150 },
      ],
      media_items: [
        item('f', 'film', 'F', '2025-03-01'),
        item('s1', 'tv', 'Show S', '2025-03-02', { series_id: 'show-s', series: 'Show S' }),
        item('s2', 'tv', 'Show S', '2025-03-03', { series_id: 'show-s', series: 'Show S' }),
        item('t1', 'tv', 'Show T', '2025-03-04', { series_id: 'show-t', series: 'Show T' }),
      ],
      media_runs: [
        { item_id: 'f', media: 'film', finished: true, end: '2025-03-01' },
        { item_id: 's1', media: 'tv', finished: true, end: '2025-03-02' },
        { item_id: 's2', media: 'tv', finished: false, end: '2025-03-03' },
        { item_id: 'ab', media: 'audiobook', finished: true, end: '2025-02-10' },
      ],
    });
    expect(rows).toEqual([
      {
        year: 2025,
        read: 2,
        watched: 7,
        listened: 1.5,
        seasons: 1,
        films: 1,
        shows: 2,
        audiobooks: 1,
        top_show: { show_id: 'show-s', show: 'Show S', hours: 3 },
      },
    ]);
  });
});
