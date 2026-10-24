import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { appConfig, type AppConfigType } from '../config/app.config';
import { BibliographyLookupService } from '../bibliography/bibliography-lookup.service';
import { BackupImportService } from '../backup-import/backup-import.service';
import { CoverLookupService } from '../covers/cover-lookup.service';
import { ActivityLogService } from '../library/activity-log.service';
import { LIBRARY_CHANGED, LIBRARY_REBUILT } from '../library/library.events';
import { IMPORTS_ONLY, LibraryService } from '../library/library.service';
import { ImportsStore } from '../imports/imports.store';
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
  /** Set by rebuildNow: build from the newest backup on the next check, changed or not. */
  private force = false;
  /** Why checks were asked for since the last build (upload, webdav, sync, catalogue…). */
  private readonly reasons = new Set<string>();
  private readonly stop = new AbortController();

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly importer: BackupImportService,
    private readonly covers: CoverLookupService,
    private readonly metadata: MetadataLookupService,
    private readonly bibliography: BibliographyLookupService,
    private readonly status: StatusService,
    private readonly activity: ActivityLogService,
    private readonly scheduler: SchedulerRegistry,
    private readonly imports: ImportsStore,
    private readonly events: EventEmitter2,
  ) {}

  onApplicationBootstrap(): void {
    const timer = setInterval(() => void this.check(), this.config.pollSeconds * 1000);
    this.scheduler.addInterval(POLL_INTERVAL, timer);
    void this.check('startup');
    this.lookUp('startup'); // carry on with any lookups an earlier run didn't finish
  }

  async onApplicationShutdown(): Promise<void> {
    this.stop.abort();
    await this.running;
  }

  /** Looks for something to rebuild now. Resolves when this and any queued check are done. */
  @OnEvent(LIBRARY_CHANGED)
  check(reason?: string): Promise<void> {
    if (reason) this.reasons.add(reason);
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

  /**
   * Looks up missing covers, then missing metadata, then authors' bibliographies (which need
   * the metadata's author ids), in the background, one at a time.
   */
  private lookUp(trigger: string): void {
    void this.covers
      .run(trigger)
      .then(() => this.metadata.run(trigger))
      .then(() => this.bibliography.run(trigger));
  }

  /**
   * Rebuilds from the newest backup (or the imports alone) now, even if nothing changed.
   * False when there's nothing to build from.
   */
  async rebuildNow(): Promise<boolean> {
    if (!(await this.library.backups()).length && !(await this.imports.newest())) return false;
    this.force = true;
    void this.check('admin');
    return true;
  }

  get busy(): boolean {
    return this.running !== null;
  }

  private async checkOnce(): Promise<void> {
    const forced = this.force;
    this.force = false;
    const backup =
      (forced && ((await this.library.backups())[0] ?? IMPORTS_ONLY)) ||
      (await this.library.needsBuild());
    if (!backup) {
      this.reasons.clear();
      return;
    }
    if (backup !== IMPORTS_ONLY) await this.waitUntilCopied(backup);
    // a new file in the inbox that nobody announced was copied there by hand
    const trigger = [...this.reasons].join(', ') || 'inbox';
    this.reasons.clear();
    await this.build(backup, trigger);
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

  private async build(backup: string, trigger: string): Promise<void> {
    const importsOnly = backup === IMPORTS_ONLY;
    const name = importsOnly ? 'imports only' : basename(backup);
    const started = Date.now();
    this.status.buildStarted();
    this.activity.log(`Rebuilding from ${name} (${trigger})`);
    try {
      const summary = await this.importer.importBackup(importsOnly ? null : backup);
      for (const line of summary.lines) this.activity.log(`  ${line}`);
      this.status.buildSucceeded();
      this.activity.record({
        type: 'rebuild',
        message: `Rebuilt from ${name}`,
        trigger,
        duration_ms: Date.now() - started,
        details: {
          backup: name,
          books: summary.books,
          reads: summary.reads,
          reading_days: summary.readingDays,
          highlights: summary.highlights,
          synced_positions: summary.syncedApplied,
          unmatched_positions: summary.unmatchedSyncs.slice(0, 100),
          new_covers: summary.newCovers,
          untagged_count: summary.untagged.length,
          untagged: summary.untagged.slice(0, 100),
          ...(summary.imported ? { imported: summary.imported } : {}),
        },
      });
      this.lookUp('rebuild');
      this.events.emit(LIBRARY_REBUILT, trigger);
    } catch (e) {
      // keep the last good data, and set the bad backup aside so it isn't retried
      const why = e instanceof Error ? e.message : String(e);
      this.status.buildFailed(why);
      const setAside = !importsOnly && (await this.library.setAside(backup));
      this.activity.record({
        type: 'rebuild',
        message: `Rebuild from ${name} failed, kept the previous data`,
        outcome: 'failed',
        trigger,
        duration_ms: Date.now() - started,
        error: why,
        details: { backup: name, set_aside: setAside ? `${name}.failed` : null },
      });
    } finally {
      this.status.buildEnded();
    }
    const removed = (await this.library.pruneBackups()).map((f) => this.library.relative(f));
    if (removed.length) {
      this.activity.record({
        type: 'prune',
        message: `Removed ${removed.length} old backup(s): ${removed.join(', ')}`,
        trigger: 'rebuild',
        details: { files: removed, keep: this.config.keepBackups },
      });
    }
  }
}
