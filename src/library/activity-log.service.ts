import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { logTimestamp } from '../common/time';

/**
 * update.log: what happened on each rebuild, upload and sync, for people to read when
 * something isn't picked up. Every line also goes to the console.
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger('Library');
  private readonly file: string;

  constructor(@Inject(appConfig.KEY) config: AppConfigType) {
    this.file = join(config.library, 'update.log');
  }

  log(message: string): void {
    this.logger.log(message);
    try {
      // synchronous, so lines from overlapping jobs stay whole and in order
      appendFileSync(this.file, `${logTimestamp()} ${message}\n`, 'utf8');
    } catch {
      // the library may not be writable yet; the console still has it
    }
  }
}
