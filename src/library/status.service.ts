import { Injectable } from '@nestjs/common';
import { logTimestamp } from '../common/time';

/** The JSON shape /healthz and /api/config report (snake_case, as the page expects). */
export interface StatusSnapshot {
  last_build: string | null;
  last_error: string | null;
  building: boolean;
  last_sync: string | null;
}

/** What the server is doing right now, kept in memory. */
@Injectable()
export class StatusService {
  private lastBuild: string | null = null;
  private lastError: string | null = null;
  private lastSync: string | null = null;
  private building = false;

  buildStarted(): void {
    this.building = true;
  }

  buildSucceeded(): void {
    this.lastBuild = logTimestamp();
    this.lastError = null;
  }

  buildFailed(why: string): void {
    this.lastError = why;
  }

  buildEnded(): void {
    this.building = false;
  }

  positionSynced(): void {
    this.lastSync = logTimestamp();
  }

  snapshot(): StatusSnapshot {
    return {
      last_build: this.lastBuild,
      last_error: this.lastError,
      building: this.building,
      last_sync: this.lastSync,
    };
  }
}
