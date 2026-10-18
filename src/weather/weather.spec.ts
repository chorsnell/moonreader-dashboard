import { daylightHours } from '../demo/demo-weather';
import {
  fromArchive,
  fromGeocoding,
  mergeDays,
  missingRanges,
  normaliseWeather,
  parseCoordinates,
  type WeatherDay,
} from './weather';

const day = (date: string): WeatherDay => ({
  date,
  t_max: 10,
  t_min: 2,
  precip_mm: 0,
  daylight_h: 9,
});

describe('weather', () => {
  it('reads coordinates', () => {
    expect(parseCoordinates('51.5, -0.12')).toEqual({ lat: 51.5, lon: -0.12 });
    expect(parseCoordinates('51.5 -0.12')).toEqual({ lat: 51.5, lon: -0.12 });
    expect(parseCoordinates('-33.9;151.2')).toEqual({ lat: -33.9, lon: 151.2 });
    expect(parseCoordinates('Leeds')).toBeNull();
    expect(parseCoordinates('95, 10')).toBeNull();
  });

  it("reads Open-Meteo's geocoding", () => {
    expect(
      fromGeocoding({
        results: [
          {
            name: 'Leeds',
            admin1: 'England',
            country: 'United Kingdom',
            latitude: 53.8,
            longitude: -1.55,
          },
        ],
      }),
    ).toEqual({ name: 'Leeds, England, United Kingdom', lat: 53.8, lon: -1.55 });
    expect(fromGeocoding({})).toBeNull();
    expect(fromGeocoding({ results: [] })).toBeNull();
  });

  it("reads the archive, skipping days it hasn't filled in", () => {
    const days = fromArchive({
      daily: {
        time: ['2025-01-01', '2025-01-02', 'nope'],
        temperature_2m_max: [8.04, null, 1],
        temperature_2m_min: [1.2, null, 1],
        precipitation_sum: [3.3, null, 1],
        daylight_duration: [28_800, 29_000, 1],
      },
    });
    expect(days).toEqual([
      { date: '2025-01-01', t_max: 8, t_min: 1.2, precip_mm: 3.3, daylight_h: 8 },
    ]);
    expect(fromArchive(null)).toEqual([]);
  });

  it('asks only for the days not cached, in chunks', () => {
    const have = [day('2025-01-03'), day('2025-01-04')];
    expect(missingRanges(have, '2025-01-01', '2025-01-06')).toEqual([
      ['2025-01-01', '2025-01-02'],
      ['2025-01-05', '2025-01-06'],
    ]);
    expect(missingRanges([], '2025-01-01', '2025-01-05', 2)).toEqual([
      ['2025-01-01', '2025-01-02'],
      ['2025-01-03', '2025-01-04'],
      ['2025-01-05', '2025-01-05'],
    ]);
    expect(missingRanges(have, '2025-01-03', '2025-01-04')).toEqual([]);
    expect(missingRanges([], '2025-01-02', '2025-01-01')).toEqual([]);
  });

  it('merges days, newer winning, and reads the file leniently', () => {
    const merged = mergeDays(
      [day('2025-01-02'), day('2025-01-01')],
      [{ ...day('2025-01-02'), t_max: 20 }],
    );
    expect(merged.map((d) => [d.date, d.t_max])).toEqual([
      ['2025-01-01', 10],
      ['2025-01-02', 20],
    ]);
    const f = normaliseWeather({
      location: { name: 'X', lat: 200, lon: 0 },
      days: [{ date: 'bad' }, day('2025-01-01')],
    });
    expect(f.location).toBeNull();
    expect(f.days).toHaveLength(1);
  });

  it('works out daylight for the demo', () => {
    expect(daylightHours(172)).toBeCloseTo(16.4, 0); // midsummer, 51.5°N
    expect(daylightHours(355)).toBeCloseTo(7.8, 0); // midwinter
  });
});
