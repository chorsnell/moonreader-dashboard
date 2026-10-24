import { Module } from '@nestjs/common';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { BibliographyLookupService } from './bibliography-lookup.service';
import { BibliographyStore } from './bibliography-store.service';

@Module({
  imports: [LibraryModule, CoversModule, MetadataModule],
  providers: [BibliographyStore, BibliographyLookupService],
  exports: [BibliographyStore, BibliographyLookupService],
})
export class BibliographyModule {}
