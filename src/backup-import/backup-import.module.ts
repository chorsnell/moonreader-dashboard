import { Module } from '@nestjs/common';
import { BibliographyModule } from '../bibliography/bibliography.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { BackupImportService } from './backup-import.service';

@Module({
  imports: [LibraryModule, CoversModule, MetadataModule, BibliographyModule],
  providers: [BackupImportService],
  exports: [BackupImportService],
})
export class BackupImportModule {}
