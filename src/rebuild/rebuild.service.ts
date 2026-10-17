import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { appConfig, type AppConfigType } from '../config/app.config';
import { BackupImportService } from '../backup-import/backup-import.service';
import { CoverLookupService } from '../covers/cover-lookup.service';
import { ActivityLogService } from '../library/activity-log.service';
import { LIBRARY_CHANGED } from '../library/library.events';
import { LibraryService } from '../library/library.service';
import { StatusService } from '../library/status.service';
import { MetadataLookupService } from '../metadata/metadata-lookup.service';

/** How long to wait between size checks while a backup is still being copied in. */
const SETTLE_MS = 2000;
const POLL_INTERVAL = 'library-poll';

/**
 * Rebuilds the page's data whenever a newer backup arrives, catalogue.json is edited or a
 * reading position is synced. It checks every POLL_SECONDS, and straight away when an
 * upload or sync says something changed. Only one check runs at a time.
 */
@Injectable()
export class RebuildService implements OnApplicationBootstrap, OnApplicationShutdown {
  private running: Promise<void> | null = null;
  private again = false;
  private readonly stop = new AbortController();

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly importer: BackupImportService,
    private readonly covers: CoverLookupService,
    private readonly metadata: MetadataLookupService,
    private readonly status: StatusService,
    private readonly activity: ActivityLogService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const timer = setInterval(() => void this.check(), this.config.pollSeconds * 1000);
    this.scheduler.addInterval(POLL_INTERVAL, timer);
    void this.check();
    this.lookUp(); // carry on with any lookups an earlier run didn't finish
  }

  async onApplicationShutdown(): Promise<void> {
    this.stop.abort();
    await this.running;
  }

  /** Looks for something to rebuild now. Resolves when this and any queued check are done. */
  @OnEvent(LIBRARY_CHANGED)
  check(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          await this.checkOnce();
        } catch (e) {
          if (!this.stop.signal.aborted) this.activity.log(`watcher error: ${String(e)}`);
        }
      } while (this.again && !this.stop.signal.aborted);
    })().finally(() => (this.running = null));
    return this.running;
  }

  /** Looks up missing covers, then missing metadata, in the background, one service at a time. */
  private lookUp(): void {
    void this.covers.run().then(() => this.metadata.run());
  }

  private async checkOnce(): Promise<void> {
    const backup = await this.library.needsBuild();
    if (!backup) return;
    await this.waitUntilCopied(backup);
    await this.build(backup);
  }

  /** Waits until a backup that's still being copied in stops growing. */
  private async waitUntilCopied(path: string): Promise<void> {
    let size = -1;
    for (;;) {
      const now = (await stat(path)).size;
      if (now === size) return;
      size = now;
      await sleep(SETTLE_MS, undefined, { signal: this.stop.signal });
    }
  }

  private async build(backup: string): Promise<void> {
    this.status.buildStarted();
    this.activity.log(`Rebuilding from ${basename(backup)}`);
    try {
      const summary = await this.importer.importBackup(backup);
      for (const line of summary.lines) this.activity.log(`  ${line}`);
      this.status.buildSucceeded();
      this.lookUp();
    } catch (e) {
      // keep the last good data, and set the bad backup aside so it isn't retried
      const why = e instanceof Error ? e.message : String(e);
      this.activity.log(`  ${why}`);
      this.status.buildFailed(why);
      if (await this.library.setAside(backup)) {
        this.activity.log(
          `  Build failed, kept the previous data. Renamed it to ${basename(backup)}.failed`,
        );
      }
    } finally {
      this.status.buildEnded();
    }
    for (const old of await this.library.pruneBackups()) {
      this.activity.log(`Removed old backup ${this.library.relative(old)}`);
    }
  }
}
