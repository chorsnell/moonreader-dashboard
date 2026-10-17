import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { appConfig, type AppConfigType } from '../config/app.config';
import { logTimestamp } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import { LIBRARY_CHANGED } from '../library/library.events';
import { MediaBuildService } from './media-build.service';
import { MediaFiles } from './media-files.service';
import { TautulliClient, type PullResult } from './sources/tautulli.client';

const POLL_INTERVAL = 'media-poll';
const TAUTULLI_INTERVAL = 'tautulli-poll';

export interface MediaStatus {
  building: boolean;
  last_build: string | null;
  last_error: string | null;
  last_lines: string[];
  tautulli: {
    pulling: boolean;
    last_pull: string | null;
    last_error: string | null;
    last_new: number;
  };
}

/**
 * Rebuilds the media data when an upload, the media catalogue or the media settings change.
 * It runs beside the book rebuild, never inside it, so a broken Moon+ backup can't stop it
 * (and a Netflix file can't stop the books).
 */
@Injectable()
export class MediaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private running: Promise<void> | null = null;
  private again = false;
  private force = false;
  /** When the inputs last changed before a build that failed: not retried until they change again. */
  private failedInputs = 0;
  private readonly stop = new AbortController();
  private readonly state: MediaStatus = {
    building: false,
    last_build: null,
    last_error: null,
    last_lines: [],
    tautulli: { pulling: false, last_pull: null, last_error: null, last_new: 0 },
  };
  private pulling: Promise<PullResult | null> | null = null;

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly builder: MediaBuildService,
    private readonly activity: ActivityLogService,
    private readonly scheduler: SchedulerRegistry,
    private readonly files: MediaFiles,
    private readonly tautulli: TautulliClient,
  ) {}

  onApplicationBootstrap(): void {
    const timer = setInterval(() => void this.check(), this.config.pollSeconds * 1000);
    this.scheduler.addInterval(POLL_INTERVAL, timer);
    const pull = setInterval(() => void this.pullTautulli(), this.config.mediaPollMinutes * 60_000);
    this.scheduler.addInterval(TAUTULLI_INTERVAL, pull);
    void this.check();
    void this.pullTautulli();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stop.abort();
    await Promise.all([this.running, this.pulling]);
  }

  /**
   * Pulls new plays from Tautulli, when it's set up; the watcher then rebuilds because the
   * cache changed. Resolves with what was pulled, or null when Tautulli isn't set up.
   */
  pullTautulli(): Promise<PullResult | null> {
    this.pulling ??= (async () => {
      const conn = await this.files.tautulli();
      if (!conn || this.stop.signal.aborted) return null;
      const t = this.state.tautulli;
      t.pulling = true;
      try {
        const r = await this.tautulli.pull(conn, this.stop.signal);
        t.last_pull = logTimestamp();
        t.last_error = null;
        t.last_new = r.new_rows;
        if (r.new_rows) {
          this.activity.log(`Pulled ${r.new_rows} new play(s) from Tautulli (${r.total} in all)`);
          void this.check();
        }
        return r;
      } catch (e) {
        const why = (e as Error).message;
        if (t.last_error !== why && !this.stop.signal.aborted) {
          this.activity.log(`Tautulli pull failed: ${why}`);
        }
        t.last_error = why;
        return null;
      } finally {
        t.pulling = false;
      }
    })().finally(() => (this.pulling = null));
    return this.pulling;
  }

  status(): MediaStatus {
    return {
      ...this.state,
      last_lines: [...this.state.last_lines],
      tautulli: { ...this.state.tautulli },
    };
  }

  /** Rebuilds now, even if nothing changed. */
  rebuildNow(): Promise<void> {
    this.force = true;
    return this.check();
  }

  @OnEvent(LIBRARY_CHANGED)
  check(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        const forced = this.force;
        this.force = false;
        try {
          const inputs = await this.builder.inputsChanged();
          const due = (await this.builder.needsBuild()) && inputs !== this.failedInputs;
          if (forced || due) await this.build(inputs);
        } catch (e) {
          if (!this.stop.signal.aborted) this.activity.log(`media watcher error: ${String(e)}`);
        }
      } while (this.again && !this.stop.signal.aborted);
    })().finally(() => (this.running = null));
    return this.running;
  }

  private async build(inputs: number): Promise<void> {
    this.state.building = true;
    this.activity.log('Rebuilding other media');
    try {
      const summary = await this.builder.build(this.stop.signal);
      for (const line of summary.lines) this.activity.log(`  ${line}`);
      this.state.last_build = logTimestamp();
      this.state.last_error = null;
      this.state.last_lines = summary.lines;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      this.activity.log(`  Media build failed, kept the previous data: ${why}`);
      this.state.last_error = why;
      this.failedInputs = inputs;
    } finally {
      this.state.building = false;
    }
  }
}
