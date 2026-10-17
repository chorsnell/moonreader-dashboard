import { Module } from '@nestjs/common';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { MediaBuildService } from './media-build.service';
import { MediaFiles } from './media-files.service';
import { MediaInboxService } from './media-inbox.service';
import { MediaMetadataService } from './metadata/media-metadata.service';
import { TmdbClient } from './metadata/tmdb.client';
import { TautulliClient } from './sources/tautulli.client';

/** The media build and uploads, without the watcher or the admin routes (the demo uses this). */
@Module({
  imports: [LibraryModule, CoversModule],
  providers: [
    MediaFiles,
    MediaBuildService,
    MediaInboxService,
    MediaMetadataService,
    TmdbClient,
    TautulliClient,
  ],
  exports: [MediaFiles, MediaBuildService, MediaInboxService, TautulliClient],
})
export class MediaCoreModule {}
