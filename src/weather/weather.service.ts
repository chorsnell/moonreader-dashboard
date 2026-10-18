import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { appConfig, type AppConfigType } from '../config/app.config';
import { localDate, localDateTime } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import { LIBRARY_REBUILT } from '../library/library.events';
import { LibraryService } from '../library/library.service';
import {
  emptyWeather,
  fromArchive,
  fromGeocoding,
  mergeDays,
  missingRanges,
  normaliseWeather,
  parseCoordinates,
  servedWeather,
  type WeatherDay,
  type WeatherFile,
  type WeatherLocation,
  WeatherError,
} from './weather';

const TIMEOUT_MS = 30_000;
const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,daylight_duration';

/**
 * library/weather.json and the copy the page reads (data/weather.json). Weather is fetched
 * from Open-Meteo after every rebuild, once a day, and when the admin asks; offline, the
 * cached days stay and the error is kept for the admin page.
 */
@Injectable()
export class WeatherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WeatherService.name);
  readonly file: string;
  readonly served: string;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private running: Promise<unknown> | null = null;

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly activity: ActivityLogService,
  ) {
    this.file = join(library.root, 'weather.json');
    this.served = join(library.data, 'weather.json');
  }

  get enabled(): boolean {
    return this.config.weatherLookup;
  }

  async onModuleInit(): Promise<void> {
    await this.publish().catch((e: unknown) => this.log.warn(String(e)));
    if (this.enabled) {
      this.timer = setInterval(() => void this.refreshQuietly('schedule'), 86_400_000);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  @OnEvent(LIBRARY_REBUILT)
  onRebuilt(): void {
    void this.refreshQuietly('rebuild');
  }

  async load(): Promise<WeatherFile> {
    try {
      return normaliseWeather(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return emptyWeather();
    }
  }

  update<T>(change: (f: WeatherFile) => { file: WeatherFile; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const { file, result } = change(await this.load());
      await writeAtomic(this.file, JSON.stringify(file));
      await this.publish(file);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Writes data/weather.json, or removes it when there's no weather. */
  async publish(file?: WeatherFile): Promise<void> {
    const rows = servedWeather(file ?? (await this.load()));
    if (!rows.length) {
      await rm(this.served, { force: true });
      return;
    }
    await mkdir(this.library.data, { recursive: true });
    await writeAtomic(this.served, JSON.stringify(rows));
  }

  /** "lat, lon" as is, or a place name looked up with Open-Meteo's geocoding. */
  async resolve(query: string): Promise<WeatherLocation> {
    const q = query.trim().slice(0, 200);
    if (!q) throw new WeatherError('Enter a place or "latitude, longitude".');
    const c = parseCoordinates(q);
    if (c) return { name: `${c.lat}, ${c.lon}`, ...c };
    const url = `${this.config.weatherGeocodingUrl}/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(q)}`;
    const place = fromGeocoding(await getJson(url));
    if (!place) throw new WeatherError(`No place called "${q}" was found.`);
    return place;
  }

  /** Sets the home location (null removes it); the cached weather goes with the old one. */
  async setLocation(location: WeatherLocation | null): Promise<void> {
    await this.update(() => ({
      file: { ...emptyWeather(), location },
      result: null,
    }));
  }

  /**
   * Asks the archive for the days from the first logged day to yesterday that aren't
   * cached. Returns how many days were added, or the error (also saved for the admin page).
   */
  refresh(trigger = 'admin'): Promise<{ added: number; error: string | null }> {
    // one at a time: a rebuild and the admin's button can come together
    const run = (this.running ?? Promise.resolve()).then(() => this.pull(trigger));
    this.running = run.catch(() => undefined);
    return run;
  }

  private async pull(trigger: string): Promise<{ added: number; error: string | null }> {
    const f = await this.load();
    if (!f.location) return { added: 0, error: null };
    const first = await this.firstDay();
    if (!first) return { added: 0, error: null };
    const yesterday = localDate(new Date(Date.now() - 86_400_000));
    const loc = f.location;
    const ranges = missingRanges(f.days, first, yesterday);
    if (!ranges.length) return { added: 0, error: null };
    const fresh: WeatherDay[] = [];
    let error: string | null = null;
    for (const [start, end] of ranges) {
      const url =
        `${this.config.weatherArchiveUrl}/v1/archive?latitude=${loc.lat}&longitude=${loc.lon}` +
        `&start_date=${start}&end_date=${end}&daily=${DAILY}&timezone=auto`;
      try {
        fresh.push(...fromArchive(await getJson(url)));
      } catch (e) {
        error = e instanceof WeatherError ? e.message : String(e);
        break; // keep what came in so far
      }
    }
    const added = await this.update((cur) => {
      if (cur.location?.lat !== loc.lat || cur.location?.lon !== loc.lon) {
        return { file: cur, result: 0 }; // moved meanwhile
      }
      const days = mergeDays(cur.days, fresh);
      return {
        file: { ...cur, days, pulled: localDateTime(), error },
        result: days.length - cur.days.length,
      };
    });
    if (error || added) {
      this.activity.record({
        type: 'metadata',
        message: error
          ? 'Weather could not be fetched'
          : `Weather fetched: ${added} day(s) for ${loc.name}`,
        outcome: error ? 'failed' : 'ok',
        ...(error ? { error } : {}),
        trigger,
      });
    }
    return { added, error };
  }

  private async refreshQuietly(trigger: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.refresh(trigger);
    } catch (e) {
      this.log.warn(`weather: ${String(e)}`);
    }
  }

  /** The first day anything was read or watched. */
  private async firstDay(): Promise<string | null> {
    let first: string | null = null;
    for (const name of ['daily.json', 'media_daily.json']) {
      try {
        const rows: unknown = JSON.parse(await readFile(join(this.library.data, name), 'utf8'));
        if (!Array.isArray(rows)) continue;
        for (const r of rows as { date?: unknown }[]) {
          if (typeof r?.date === 'string' && (!first || r.date < first)) first = r.date;
        }
      } catch {
        // not there yet
      }
    }
    return first;
  }
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new WeatherError(
      e instanceof Error && e.name === 'TimeoutError'
        ? 'Open-Meteo took too long to answer.'
        : "Couldn't reach Open-Meteo (offline?).",
    );
  }
  if (!res.ok) {
    let reason = '';
    try {
      reason = String(((await res.json()) as { reason?: unknown }).reason ?? '');
    } catch {
      // not JSON
    }
    throw new WeatherError(`Open-Meteo answered HTTP ${res.status}${reason ? `: ${reason}` : ''}.`);
  }
  try {
    return await res.json();
  } catch {
    throw new WeatherError("Open-Meteo's answer wasn't JSON.");
  }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await writeFile(`${path}.tmp`, text, 'utf8');
  await rename(`${path}.tmp`, path);
}
