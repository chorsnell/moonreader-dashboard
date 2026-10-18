import type { WeatherDay } from '../weather/weather';
import { Random } from './random';
import type { DemoDay } from './simulate';

const DAY_MS = 86_400_000;
const LAT = 51.5; // somewhere like London

/** Hours from sunrise to sunset at LAT on a day of the year (the usual astronomical formula). */
export function daylightHours(dayOfYear: number, lat = LAT): number {
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81)) * (Math.PI / 180);
  const x = -Math.tan((lat * Math.PI) / 180) * Math.tan(decl);
  return (2 * Math.acos(Math.max(-1, Math.min(1, x))) * 180) / Math.PI / 15;
}

/**
 * Made-up daily weather for the demo, from firstDay to lastDay (days since 1970): a mild,
 * damp climate with seasons, a few runs of rain and the odd heatwave. Rain is a little
 * likelier on days with a lot of reading, so the demo's "Reading and the weather" card has
 * something to show. Uses its own random numbers so the rest of the demo stays the same.
 */
export function demoWeather(
  log: Map<string, DemoDay[]>,
  firstDay: number,
  lastDay: number,
  seed: number,
): WeatherDay[] {
  const rng = new Random(seed + 303);
  const minutes = new Map<number, number>();
  for (const entries of log.values()) {
    for (const e of entries)
      minutes.set(firstDay + e.day, (minutes.get(firstDay + e.day) ?? 0) + e.minutes);
  }
  const out: WeatherDay[] = [];
  let wetSpell = 0;
  for (let d = firstDay; d <= lastDay; d++) {
    const date = new Date(d * DAY_MS);
    const doy = Math.floor((d * DAY_MS - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
    // warmest in late July, coldest in late January
    const season = Math.cos(((2 * Math.PI) / 365) * (doy - 205));
    const mean = 11 + 7.5 * season + rng.uniform(-3.5, 3.5);
    const spread = 6 + 3 * season + rng.uniform(-1.5, 1.5);
    const read = minutes.get(d) ?? 0;
    // rain comes in spells; a long reading day is a bit more likely to be a wet one
    if (wetSpell > 0) wetSpell--;
    else if (rng.random() < 0.08 + 0.04 * (1 - season)) wetSpell = rng.randint(1, 5);
    const pRain = (wetSpell > 0 ? 0.75 : 0.25) + (read > 45 ? 0.15 : read === 0 ? -0.08 : 0);
    const precip =
      rng.random() < pRain ? Math.round(rng.uniform(0.2, wetSpell > 0 ? 14 : 6) * 10) / 10 : 0;
    out.push({
      date: date.toISOString().slice(0, 10),
      t_max: Math.round((mean + spread / 2) * 10) / 10,
      t_min: Math.round((mean - spread / 2) * 10) / 10,
      precip_mm: precip,
      daylight_h: Math.round(daylightHours(doy) * 10) / 10,
    });
  }
  return out;
}
