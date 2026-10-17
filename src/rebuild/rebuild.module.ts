import { Module } from '@nestjs/common';
import { BackupImportModule } from '../backup-import/backup-import.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { RebuildService } from './rebuild.service';

@Module({
  imports: [LibraryModule, BackupImportModule, CoversModule],
  providers: [RebuildService],
  exports: [RebuildService],
})
export class RebuildModule {}
