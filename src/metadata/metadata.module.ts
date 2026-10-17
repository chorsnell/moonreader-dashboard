import { Module } from '@nestjs/common';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { MetadataLookupService } from './metadata-lookup.service';
import { MetadataStore } from './metadata-store.service';
import { WikidataClient } from './wikidata.client';

@Module({
  imports: [LibraryModule, CoversModule],
  providers: [MetadataStore, MetadataLookupService, WikidataClient],
  exports: [MetadataStore, MetadataLookupService],
})
export class MetadataModule {}
