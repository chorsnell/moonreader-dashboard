import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { localDateTime } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { parseIcal } from './ical';
import {
  emptyLifeEvents,
  fromCalendar,
  LifeEventError,
  type LifeEventsFile,
  normaliseLifeEvents,
  servedLifeEvents,
} from './life-events';

const TIMEOUT_MS = 20_000;
/** A calendar feed bigger than this isn't read. */
export const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;

/**
 * library/life_events.json, the copy the page reads (data/life_events.json, rewritten on
 * every change), and the calendar feed, fetched every LIFE_EVENTS_REFRESH_HOURS.
 */
@Injectable()
export class LifeEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(LifeEventsService.name);
  readonly file: string;
  readonly served: string;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly activity: ActivityLogService,
  ) {
    this.file = join(library.root, 'life_events.json');
    this.served = join(library.data, 'life_events.json');
  }

  async onModuleInit(): Promise<void> {
    await this.publish().catch((e: unknown) => this.log.warn(String(e)));
    const hours = this.config.lifeEventsRefreshHours;
    if (hours > 0) {
      this.timer = setInterval(() => void this.refreshQuietly(), hours * 3_600_000);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async load(): Promise<LifeEventsFile> {
    try {
      return normaliseLifeEvents(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return emptyLifeEvents();
    }
  }

  /** Loads, changes and saves, one change at a time. Returns what `change` did. */
  update<T>(change: (f: LifeEventsFile) => { file: LifeEventsFile; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const { file, result } = change(await this.load());
      await writeAtomic(this.file, JSON.stringify(file, null, 1));
      await this.publish(file);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Writes data/life_events.json, or removes it when there are no events. */
  async publish(file?: LifeEventsFile): Promise<void> {
    const f = file ?? (await this.load());
    const rows = servedLifeEvents(f);
    if (!rows.length) {
      await rm(this.served, { force: true });
      return;
    }
    await mkdir(this.library.data, { recursive: true });
    await writeAtomic(this.served, JSON.stringify(rows));
  }

  /**
   * Fetches the calendar and replaces its events. A failure keeps the events of the last
   * good fetch and records why, for the admin page.
   */
  async refresh(trigger = 'admin'): Promise<{ events: number; error: string | null }> {
    const { calendar } = await this.load();
    if (!calendar.url) return { events: 0, error: null };
    const url = calendar.url;
    try {
      const events = fromCalendar(parseIcal(await fetchCalendar(url)));
      await this.update(
        (f) =>
          f.calendar.url === url
            ? {
                file: { ...f, calendar: { url, pulled: localDateTime(), error: null, events } },
                result: null,
              }
            : { file: f, result: null }, // the address changed meanwhile
      );
      this.activity.record({
        type: 'settings',
        message: `Calendar for life events read: ${events.length} event(s)`,
        trigger,
      });
      return { events: events.length, error: null };
    } catch (e) {
      const error =
        e instanceof LifeEventError ? e.message : `Couldn't read the calendar (${String(e)})`;
      await this.update((f) =>
        f.calendar.url === url
          ? { file: { ...f, calendar: { ...f.calendar, error } }, result: null }
          : { file: f, result: null },
      );
      this.activity.record({
        type: 'settings',
        message: 'Calendar for life events could not be read',
        outcome: 'failed',
        error,
        trigger,
      });
      return { events: 0, error };
    }
  }

  private async refreshQuietly(): Promise<void> {
    try {
      await this.refresh('schedule');
    } catch (e) {
      this.log.warn(`life events calendar: ${String(e)}`);
    }
  }
}

/** The feed's text; throws LifeEventError with something to show the admin. */
async function fetchCalendar(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'text/calendar, */*;q=0.5' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    throw new LifeEventError(
      name === 'TimeoutError'
        ? 'The calendar took too long to answer.'
        : "Couldn't reach the calendar (offline, or a wrong address?).",
    );
  }
  if (!res.ok) throw new LifeEventError(`The calendar answered HTTP ${res.status}.`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_CALENDAR_BYTES) {
    throw new LifeEventError('The calendar is too large (5 MB at most).');
  }
  const text = await res.text();
  if (text.length > MAX_CALENDAR_BYTES) {
    throw new LifeEventError('The calendar is too large (5 MB at most).');
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new LifeEventError("That address doesn't give an iCalendar (.ics) feed.");
  }
  return text;
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await writeFile(`${path}.tmp`, text, 'utf8');
  await rename(`${path}.tmp`, path);
}
