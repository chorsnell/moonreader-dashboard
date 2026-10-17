import { buildMediaHistory } from '../media-history';
import { absEvents, absMeta, type AbsSession } from './audiobookshelf';

const hour = 3600;
const session = (
  id: string,
  iso: string,
  listened: number,
  at: number,
  extra: Partial<AbsSession> = {},
): AbsSession => ({
  id,
  libraryItemId: 'li_1',
  mediaType: 'book',
  displayTitle: 'The Time Machine',
  displayAuthor: 'H. G. Wells',
  mediaMetadata: {
    title: 'The Time Machine',
    series: [],
    genres: ['Science Fiction'],
    publishedYear: '1895',
  },
  duration: 3.5 * hour,
  timeListening: listened,
  currentTime: at,
  startedAt: Date.parse(iso),
  deviceInfo: { clientName: 'Abs Android' },
  ...extra,
});

describe('Audiobookshelf sessions', () => {
  const sessions = [
    session('s1', '2025-01-04T12:00:00Z', hour, hour),
    session('s2', '2025-01-05T12:00:00Z', 2 * hour, 3 * hour),
    session('s3', '2025-01-06T12:00:00Z', 0.45 * hour, 3.45 * hour),
    session('p1', '2025-01-06T13:00:00Z', 600, 600, {
      mediaType: 'podcast',
      libraryItemId: 'li_p',
    }),
  ];

  it('maps book sessions to audiobook events, leaving podcasts out', () => {
    const ev = absEvents(sessions);
    expect(ev).toHaveLength(3);
    expect(ev[0]).toMatchObject({
      source: 'audiobookshelf',
      source_key: 'abs:li_1',
      media: 'audiobook',
      seconds: hour,
      year: 1895,
      device: 'Abs Android',
    });
    expect(ev[1].position_pct).toBeCloseTo((3 / 3.5) * 100);
  });

  it('builds an audiobook item, finished by position', () => {
    const h = buildMediaHistory(absEvents(sessions), { meta: absMeta(sessions) });
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({
      id: 'audiobook-the-time-machine-1895',
      media: 'audiobook',
      creator: 'H. G. Wells',
      genre: 'Science Fiction',
      status: 'finished',
      progress: 100,
      hours: 3.5,
      times: 1,
    });
    expect(h.daily.map((d) => d.minutes)).toEqual([60, 120, 27]);
  });

  it('takes the series from the metadata', () => {
    const s = [
      session('a', '2025-01-04T12:00:00Z', hour, hour, {
        mediaMetadata: {
          title: 'A Princess of Mars',
          series: [{ name: 'Barsoom', sequence: '1' }],
        },
      }),
    ];
    const [item] = buildMediaHistory(absEvents(s), { meta: absMeta(s) }).items;
    expect(item).toMatchObject({ series: 'Barsoom', series_no: 1, status: 'in_progress' });
  });
});
