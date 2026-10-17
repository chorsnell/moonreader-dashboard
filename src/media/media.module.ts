import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { MediaCoreModule } from './media-core.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/** Other media (TV and film): the media build's watcher and the admin's settings. */
@Module({
  imports: [AccessModule, LibraryModule, MediaCoreModule],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
