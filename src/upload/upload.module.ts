import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { MediaCoreModule } from '../media/media-core.module';
import { UploadController } from './upload.controller';

@Module({
  imports: [AccessModule, LibraryModule, MediaCoreModule],
  controllers: [UploadController],
})
export class UploadModule {}
