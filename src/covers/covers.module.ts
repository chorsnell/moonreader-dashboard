import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module';
import { CoverLookupService } from './cover-lookup.service';
import { CoverStore } from './cover-store.service';
import { OpenLibraryClient } from './open-library.client';

@Module({
  imports: [LibraryModule],
  providers: [CoverStore, CoverLookupService, OpenLibraryClient],
  exports: [CoverStore, CoverLookupService],
})
export class CoversModule {}
