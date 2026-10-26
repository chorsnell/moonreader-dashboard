import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { BibliographyModule } from '../bibliography/bibliography.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { ImportsController } from '../imports/imports.controller';
import { KoreaderSyncModule } from '../koreader-sync/koreader-sync.module';
import { MetadataModule } from '../metadata/metadata.module';
import { SearchLinksController } from '../search-links/search-links.controller';
import { RebuildModule } from '../rebuild/rebuild.module';
import { AdminController } from './admin.controller';
import { CatalogueService } from './catalogue.service';
import { DiscoveryController } from './discovery.controller';
import { GenreSuggestionsService } from './genre-suggestions.service';

/** What the admin page reads and changes, besides uploads and who can see the dashboard. */
@Module({
  imports: [
    AccessModule,
    LibraryModule,
    CoversModule,
    MetadataModule,
    RebuildModule,
    BibliographyModule,
    KoreaderSyncModule,
  ],
  controllers: [AdminController, ImportsController, DiscoveryController, SearchLinksController],
  providers: [CatalogueService, GenreSuggestionsService],
})
export class AdminModule {}
