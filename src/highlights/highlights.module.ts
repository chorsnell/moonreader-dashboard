import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { HighlightsExportController } from './highlights-export.controller';
import { HighlightsExportService } from './highlights-export.service';

/** Highlights beyond the page: exports to Obsidian, Logseq and Readwise (BOO-82). */
@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [HighlightsExportController],
  providers: [HighlightsExportService],
  exports: [HighlightsExportService],
})
export class HighlightsModule {}
