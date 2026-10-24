import { Module } from '@nestjs/common';
import { ImportsStore } from '../imports/imports.store';
import { WantStore } from '../want-to-read/want-to-read.store';
import { ActivityLogService } from './activity-log.service';
import { LibraryService } from './library.service';
import { StatusService } from './status.service';

@Module({
  providers: [ActivityLogService, LibraryService, StatusService, ImportsStore, WantStore],
  exports: [ActivityLogService, LibraryService, StatusService, ImportsStore, WantStore],
})
export class LibraryModule {}
