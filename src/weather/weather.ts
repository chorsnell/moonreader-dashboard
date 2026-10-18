/**
 * Reading and the weather (BOO-85): daily weather at a home location from Open-Meteo's
 * archive (free, keyless), kept in library/weather.json. The page reads data/weather.json:
 * one row per day and never the location. Pure functions; WeatherService does the files
 * and the fetching.
 */

export interface WeatherDay {
  date: string;
  /** Highest and lowest temperature, °C. */
  t_max: number | null;
  t_min: number | null;
  /** Rain, snow and so on, mm. */
  precip_mm: number | null;
  /** Hours from sunrise to sunset. */
  daylight_h: number | null;
}

export interface WeatherLocation {
  name: string;
  lat: number;
  lon: number;
}

export interface WeatherFile {
  schema_version: 1;
  location: WeatherLocation | null;
  /** When the archive was last asked, local time. */
  pulled: string | null;
  error: string | null;
  days: WeatherDay[];
}

export class WeatherError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyWeather(): WeatherFile {
  return { schema_version: 1, location: null, pulled: null, error: null, days: [] };
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function toLocation(raw: unknown): WeatherLocation | null {
  const o = asObject(raw);
  const lat = num(o.lat);
  const lon = num(o.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: str(o.name, 200) || `${lat}, ${lon}`, lat: Number(o.lat), lon: Number(o.lon) };
}

/** Reads library/weather.json leniently. */
export function normaliseWeather(raw: unknown): WeatherFile {
  const o = asObject(raw);
  const days = (Array.isArray(o.days) ? o.days : [])
    .map((d) => {
      const r = asObject(d);
      const date = str(r.date, 10);
      return DATE.test(date)
        ? {
            date,
            t_max: num(r.t_max),
            t_min: num(r.t_min),
            precip_mm: num(r.precip_mm),
            daylight_h: num(r.daylight_h),
          }
        : null;
    })
    .filter((d): d is WeatherDay => d !== null);
  return {
    schema_version: 1,
    location: toLocation(o.location),
    pulled: str(o.pulled, 30) || null,
    error: str(o.error, 500) || null,
    days: mergeDays([], days),
  };
}

/** "51.5, -0.12" (or with a space, or a semicolon) as coordinates; null if it isn't one. */
export function parseCoordinates(s: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** Open-Meteo's geocoding answer: the first place found, named "Town, Region, Country". */
export function fromGeocoding(body: unknown): WeatherLocation | null {
  const results = asObject(body).results;
  const first = Array.isArray(results) ? asObject(results[0]) : {};
  const lat = Number(first.latitude);
  const lon = Number(first.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = [first.name, first.admin1, first.country]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .filter((x, i, a) => a.indexOf(x) === i)
    .join(', ');
  return { name: name || `${lat}, ${lon}`, lat, lon };
}

/**
 * Open-Meteo's archive answer as days. Days the archive hasn't filled in yet (every value
 * null: it lags a few days behind) are left out, so they're asked for again next time.
 */
export function fromArchive(body: unknown): WeatherDay[] {
  const daily = asObject(asObject(body).daily);
  const time = Array.isArray(daily.time) ? daily.time : [];
  const col = (k: string) => (Array.isArray(daily[k]) ? (daily[k] as unknown[]) : []);
  const tmax = col('temperature_2m_max');
  const tmin = col('temperature_2m_min');
  const precip = col('precipitation_sum');
  const light = col('daylight_duration');
  const out: WeatherDay[] = [];
  time.forEach((t, i) => {
    if (typeof t !== 'string' || !DATE.test(t)) return;
    const d: WeatherDay = {
      date: t,
      t_max: num(tmax[i]),
      t_min: num(tmin[i]),
      precip_mm: num(precip[i]),
      // seconds in the API
      daylight_h: typeof light[i] === 'number' ? num((light[i] as number) / 3600) : null,
    };
    if (d.t_max === null && d.t_min === null && d.precip_mm === null) return;
    out.push(d);
  });
  return out;
}

/** The days of both, the newer winning for a date, in date order. */
export function mergeDays(old: WeatherDay[], fresh: WeatherDay[]): WeatherDay[] {
  const m = new Map(old.map((d) => [d.date, d]));
  fresh.forEach((d) => m.set(d.date, d));
  return [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The date ranges between `from` and `to` (inclusive) with no cached day, as [start, end]
 * pairs, each at most `maxDays` long, so a long history is asked for in a few requests and
 * a daily top-up asks only for the days since.
 */
export function missingRanges(
  days: WeatherDay[],
  from: string,
  to: string,
  maxDays = 366,
): [string, string][] {
  if (from > to) return [];
  const have = new Set(days.map((d) => d.date));
  const out: [string, string][] = [];
  let start: number | null = null;
  let last = 0;
  const end = Date.parse(to);
  const flush = () => {
    if (start !== null) out.push([iso(start), iso(last)]);
    start = null;
  };
  for (let t = Date.parse(from); t <= end; t += DAY_MS) {
    if (have.has(iso(t))) {
      flush();
      continue;
    }
    if (start !== null && (t - start) / DAY_MS >= maxDays) flush();
    if (start === null) start = t;
    last = t;
  }
  flush();
  return out;
}

/** data/weather.json: the days only, no location. */
export function servedWeather(f: WeatherFile): WeatherDay[] {
  return f.days;
}
