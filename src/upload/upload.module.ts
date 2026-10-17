import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LibraryModule } from '../library/library.module';
import { UploadController } from './upload.controller';

@Module({
  imports: [AuthModule, LibraryModule],
  controllers: [UploadController],
})
export class UploadModule {}
