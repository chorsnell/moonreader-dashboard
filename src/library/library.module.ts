import { Module } from '@nestjs/common';
import { ImportsStore } from '../imports/imports.store';
import { ActivityLogService } from './activity-log.service';
import { LibraryService } from './library.service';
import { StatusService } from './status.service';

@Module({
  providers: [ActivityLogService, LibraryService, StatusService, ImportsStore],
  exports: [ActivityLogService, LibraryService, StatusService, ImportsStore],
})
export class LibraryModule {}
