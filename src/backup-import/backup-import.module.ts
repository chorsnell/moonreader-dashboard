import { Module } from '@nestjs/common';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { BackupImportService } from './backup-import.service';

@Module({
  imports: [LibraryModule, CoversModule, MetadataModule],
  providers: [BackupImportService],
  exports: [BackupImportService],
})
export class BackupImportModule {}
