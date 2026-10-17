import { Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { LibraryService } from './library.service';
import { StatusService } from './status.service';

@Module({
  providers: [ActivityLogService, LibraryService, StatusService],
  exports: [ActivityLogService, LibraryService, StatusService],
})
export class LibraryModule {}
