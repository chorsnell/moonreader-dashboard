import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { KoreaderSyncModule } from '../koreader-sync/koreader-sync.module';
import { LibraryModule } from '../library/library.module';
import { KosyncController } from './kosync.controller';
import { LayoutController } from './layout.controller';
import { LayoutStore } from './layout-store';
import { ProgressStore } from './progress-store';
import { ProgressSyncService } from './progress-sync.service';

/** Reading-position sync between KOReader (its progress sync) and Moon+ Reader (.po files). */
@Module({
  imports: [AccessModule, LibraryModule, KoreaderSyncModule],
  controllers: [KosyncController, LayoutController],
  providers: [ProgressStore, LayoutStore, ProgressSyncService],
  exports: [ProgressSyncService],
})
export class ProgressSyncModule {}
