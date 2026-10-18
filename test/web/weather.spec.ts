import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/weather.js');
const read = (date: string, minutes: number) => ({ date, book_id: 'b', minutes, words: 0 });
const wx = (date: string, precip_mm: number, t: number, daylight_h: number) => ({
  date,
  t_max: t + 3,
  t_min: t - 3,
  precip_mm,
  daylight_h,
});

type Row = {
  factor: string;
  bucket: string;
  days: number;
  read_per_day: number;
  share_read: number;
  watch_per_day: number | null;
};

describe('reading and the weather', () => {
  const weather = [
    wx('2024-12-31', 9, 0, 8), // before the log: left out
    wx('2025-01-01', 0, 2, 8),
    wx('2025-01-02', 10, 2, 8),
    wx('2025-01-03', 10, 20, 15),
    wx('2025-01-04', 2, 14, 12),
  ];
  const daily = [read('2025-01-01', 10), read('2025-01-02', 50), read('2025-01-03', 30)];
  const media = [
    { date: '2025-01-04', media: 'tv', minutes: 40 },
    { date: '2025-01-04', media: 'audiobook', minutes: 99 }, // not watching
  ];

  it('averages reading and watching by rain, temperature and daylight', () => {
    const rows = run<Row>('weather_reading', { weather, daily, media_daily: media });
    const get = (f: string, b: string) => rows.find((r) => r.factor === f && r.bucket === b)!;
    expect(get('all', 'all')).toMatchObject({
      days: 4,
      read_per_day: 22.5,
      share_read: 0.75,
      watch_per_day: 10,
    });
    expect(get('rain', 'wet')).toMatchObject({ days: 2, read_per_day: 40, share_read: 1 });
    expect(get('rain', 'dry')).toMatchObject({ days: 1, read_per_day: 10 });
    expect(get('rain', 'showery')).toMatchObject({ days: 1, read_per_day: 0, watch_per_day: 40 });
    expect(get('temp', 'cold')).toMatchObject({ days: 2, read_per_day: 30 });
    expect(get('temp', 'warm')).toMatchObject({ days: 1, read_per_day: 30 });
    expect(get('daylight', 'short').days).toBe(2);
    expect(get('daylight', 'long').days).toBe(1);
  });

  it('has no watching figures without TV or film, and nothing without weather', () => {
    const rows = run<Row>('weather_reading', { weather, daily, media_daily: [] });
    expect(rows.every((r) => r.watch_per_day === null)).toBe(true);
    expect(run('weather_reading', { weather: [], daily, media_daily: [] })).toEqual([]);
  });
});
