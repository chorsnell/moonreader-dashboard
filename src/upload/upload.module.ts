import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { UploadController } from './upload.controller';

@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [UploadController],
})
export class UploadModule {}
