import { buildMediaHistory } from '../media-history';
import { emptyTautulliCache, tautulliEvents, tautulliMeta, type TautulliRow } from './tautulli';

const at = (iso: string) => Date.parse(iso) / 1000;

const episode = (
  row_id: number,
  iso: string,
  no: number,
  extra: Partial<TautulliRow> = {},
): TautulliRow => ({
  row_id,
  started: at(iso),
  play_duration: 2700,
  percent_complete: 98,
  watched_status: 1,
  media_type: 'episode',
  title: `Episode ${no}`,
  grandparent_title: 'Night Ferry',
  parent_media_index: 1,
  media_index: no,
  rating_key: 100 + no,
  parent_rating_key: 50,
  grandparent_rating_key: 10,
  player: 'Living Room',
  ...extra,
});

const movie: TautulliRow = {
  row_id: 9,
  started: at('2025-02-01T20:00:00Z'),
  play_duration: 5400,
  percent_complete: 95,
  watched_status: 1,
  media_type: 'movie',
  title: 'Metropolis',
  year: 1927,
  rating_key: 77,
};

describe('tautulliEvents', () => {
  it('maps episodes and films, and skips music and live TV', () => {
    const ev = tautulliEvents([
      episode(1, '2025-01-04T12:00:00Z', 1),
      movie,
      { ...movie, row_id: 10, media_type: 'track', title: 'A song' },
      { ...movie, row_id: 11, media_type: 'live', title: 'News' },
    ]);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({
      source: 'tautulli',
      source_key: 'plex:10',
      media: 'tv',
      series_title: 'Night Ferry',
      season: 1,
      episode: 1,
      seconds: 2700,
      position_pct: 98,
      completed: true,
      device: 'Living Room',
      start: '2025-01-04T12:00:00.000Z',
    });
    expect(ev[1]).toMatchObject({
      source_key: 'plex:77',
      media: 'film',
      year: 1927,
      ext: { plex_rating_key: '77' },
    });
  });
});

describe('tautulliMeta', () => {
  it('turns cached metadata into genres, ids and episode counts', () => {
    const cache = {
      ...emptyTautulliCache(),
      rows: [episode(1, '2025-01-04T12:00:00Z', 1), movie],
      items: {
        '10': {
          title: 'Night Ferry',
          genres: ['Crime', 'Thriller'],
          guids: ['tmdb://321', 'imdb://tt1'],
          thumb: '/t/10',
        },
        '77': {
          title: 'Metropolis',
          genres: ['Science Fiction'],
          directors: ['Fritz Lang'],
          duration: 8880000,
          year: 1927,
        },
      },
      seasons: {
        '50': {
          children_count: 6,
          children_list: [{ media_index: 1, title: 'Episode 1', duration: 2820000 }],
        },
      },
    };
    const meta = tautulliMeta(cache);
    expect(meta.get('tv:plex:10')).toMatchObject({
      genres: ['Crime', 'Thriller'],
      poster: '/t/10',
      poster_from: 'tautulli',
      ext: { tmdb_id: 321, imdb_id: 'tt1' },
      seasons: { '1': { episodes: 6, runtimes: { '1': 47 } } },
    });
    expect(meta.get('film:plex:77')).toMatchObject({ creator: 'Fritz Lang', runtime: 148 });

    const h = buildMediaHistory(tautulliEvents(cache.rows), { meta });
    expect(h.items.map((i) => [i.id, i.genre, i.units, i.units_total, i.sources])).toEqual([
      ['tv-night-ferry-s1', 'Crime', 1, 6, ['tautulli']],
      ['film-metropolis-1927', 'Science Fiction', null, null, ['tautulli']],
    ]);
  });
});
