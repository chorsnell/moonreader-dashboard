import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { RebuildModule } from '../rebuild/rebuild.module';
import { AdminController } from './admin.controller';
import { CatalogueService } from './catalogue.service';

/** What the admin page reads and changes, besides uploads and who can see the dashboard. */
@Module({
  imports: [AccessModule, LibraryModule, CoversModule, RebuildModule],
  controllers: [AdminController],
  providers: [CatalogueService],
})
export class AdminModule {}
