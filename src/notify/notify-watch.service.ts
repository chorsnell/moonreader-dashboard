import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AccessSettingsService } from '../access/access-settings.service';
import { localDate, localDateTime } from '../common/time';
import { appConfig, type AppConfigType } from '../config/app.config';
import { FriendStore } from '../friends/friend-store.service';
import { LIBRARY_REBUILT } from '../library/library.events';
import { LibraryService } from '../library/library.service';
import { OutboundService } from '../outbound/outbound.service';
import { PrivacyService } from '../privacy/privacy.service';
import { StatsService } from '../stats/stats.service';
import {
  detect,
  streakWarning,
  toState,
  type FriendReads,
  type NotifyEvent,
  type NotifyState,
  type RecordRow,
  type Snapshot,
} from './notify';
import { NotifierService } from './notifier.service';

const TICK = 'notify-tick';
/** How often the clock-based checks (streak at risk) and friends' data are looked at. */
export const TICK_MS = 10 * 60_000;

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

/**
 * Finds the events worth a notification by comparing the data with what was already
 * notified (library/notify-state.json), after each rebuild and every 10 minutes (for the
 * streak check and friends' data refreshed in the meantime). The first run only takes note
 * of how things are, so nothing old is sent; a restart or a rebuild of the same data finds
 * nothing new.
 */
@Injectable()
export class NotifyWatchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(NotifyWatchService.name);
  readonly file: string;
  private running: Promise<NotifyEvent[]> | null = null;
  private again = false;

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly notifier: NotifierService,
    private readonly stats: StatsService,
    private readonly friends: FriendStore,
    private readonly privacy: PrivacyService,
    private readonly settings: AccessSettingsService,
    private readonly scheduler: SchedulerRegistry,
    private readonly outbound: OutboundService,
  ) {
    this.file = join(library.root, 'notify-state.json');
  }

  onApplicationBootstrap(): void {
    const timer = setInterval(() => void this.check('tick'), TICK_MS);
    timer.unref();
    this.scheduler.addInterval(TICK, timer);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.running?.catch(() => undefined);
  }

  @OnEvent(LIBRARY_REBUILT)
  onRebuilt(): Promise<NotifyEvent[]> {
    return this.check('rebuild');
  }

  /** Looks for events and sends them; one check at a time. Resolves with what was sent. */
  check(reason: string, now = new Date()): Promise<NotifyEvent[]> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      const sent: NotifyEvent[] = [];
      do {
        this.again = false;
        try {
          sent.push(...(await this.checkOnce(now)));
        } catch (e) {
          this.log.warn(`notification check (${reason}) failed: ${String(e)}`);
        }
      } while (this.again);
      return sent;
    })().finally(() => (this.running = null));
    return this.running;
  }

  private async checkOnce(now: Date): Promise<NotifyEvent[]> {
    const s = await this.notifier.load();
    if (!(await this.library.hasData())) return [];
    const prev = await this.readState();
    // nowhere to send them: keep up to date, so turning them on later doesn't send old news
    const snap = await this.snapshot(localDate(now));
    const { goal } = await this.outbound.config();
    const { events, next } = detect(prev, snap, goal);
    const streak = streakWarning(
      rows(snap.daily),
      { date: localDate(now), hour: now.getHours() },
      s,
      prev?.streak_warned ?? null,
    );
    // only once it's really sent, so switching it on later the same evening still warns
    if (streak && prev && s.channels.length && s.events.streak_at_risk !== false) {
      events.push(streak);
      next.streak_warned = localDate(now);
    }
    const sending = s.channels.length ? events : [];
    // remember first, so a crash while sending can't send the same thing twice
    await this.writeState({ ...next, updated: localDateTime(now) });
    const out: NotifyEvent[] = [];
    for (const e of sending) {
      if ((await this.notifier.send(e)).enabled) out.push(e);
    }
    return out;
  }

  private async snapshot(today: string): Promise<Snapshot & { daily: unknown }> {
    const set = await this.stats.get('admin');
    const { privacy } = await this.settings.load();
    const ctx = await this.privacy.context({
      role: 'public',
      preview: null,
      policy: privacy.public,
    });
    const friends: FriendReads[] = [];
    for (const p of await this.friends.list()) {
      const parse = async (name: string) => {
        try {
          return rows(JSON.parse((await this.friends.file(p.slug, name)) ?? '[]'));
        } catch {
          return [];
        }
      };
      friends.push({
        slug: p.slug,
        name: p.name,
        reads: await parse('reads.json'),
        books: await parse('books.json'),
      });
    }
    const home = this.config.publicUrl ? `${this.config.publicUrl}/` : null;
    return {
      today,
      reads: rows(set.inputs.get('reads')),
      books: rows(set.inputs.get('books')),
      daily: set.inputs.get('daily'),
      records: rows(set.rows.records) as unknown as RecordRow[],
      friends,
      private: new Set(ctx ? ctx.private.keys() : []),
      home,
    };
  }

  private async readState(): Promise<NotifyState | null> {
    try {
      return toState(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return null;
    }
  }

  private async writeState(state: NotifyState): Promise<void> {
    await writeFile(`${this.file}.part`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${this.file}.part`, this.file);
    await chmod(this.file, 0o600).catch(() => undefined);
  }
}
