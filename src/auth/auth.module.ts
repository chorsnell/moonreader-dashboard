import { Module } from '@nestjs/common';
import { DavAuthGuard } from './dav-auth.guard';
import { UploadTokenGuard } from './upload-token.guard';
import { UploadTokenService } from './upload-token.service';

@Module({
  providers: [UploadTokenService, UploadTokenGuard, DavAuthGuard],
  exports: [UploadTokenService, UploadTokenGuard, DavAuthGuard],
})
export class AuthModule {}
