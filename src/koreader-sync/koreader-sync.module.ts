import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { RebuildModule } from '../rebuild/rebuild.module';
import { KoreaderSyncController } from './koreader-sync.controller';
import { KoreaderSyncService } from './koreader-sync.service';

/** The KOReader plugin's sync (koreader/API.md), also used by WebDAV and the Imports upload. */
@Module({
  imports: [AccessModule, LibraryModule, RebuildModule],
  controllers: [KoreaderSyncController],
  providers: [KoreaderSyncService],
  exports: [KoreaderSyncService],
})
export class KoreaderSyncModule {}
