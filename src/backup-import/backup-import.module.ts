import { Module } from '@nestjs/common';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { BackupImportService } from './backup-import.service';

@Module({
  imports: [LibraryModule, CoversModule],
  providers: [BackupImportService],
  exports: [BackupImportService],
})
export class BackupImportModule {}
