import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { BibliographyModule } from '../bibliography/bibliography.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { ImportsController } from '../imports/imports.controller';
import { MetadataModule } from '../metadata/metadata.module';
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
  ],
  controllers: [AdminController, ImportsController, DiscoveryController],
  providers: [CatalogueService, GenreSuggestionsService],
})
export class AdminModule {}
