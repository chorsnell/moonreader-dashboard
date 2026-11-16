import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module';
import { KosyncController } from './kosync.controller';
import { ProgressStore } from './progress-store';
import { ProgressSyncService } from './progress-sync.service';

/** Reading-position sync between KOReader (its progress sync) and Moon+ Reader (.po files). */
@Module({
  imports: [LibraryModule],
  controllers: [KosyncController],
  providers: [ProgressStore, ProgressSyncService],
  exports: [ProgressSyncService],
})
export class ProgressSyncModule {}
