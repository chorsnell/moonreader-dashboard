import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module';
import { AccessSettingsService } from './access-settings.service';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { AdminGuard } from './admin.guard';
import { DavAuthGuard } from './dav-auth.guard';
import { ReaderGuard } from './reader.guard';
import { SessionService } from './session.service';
import { UploadTokenService } from './upload-token.service';
import { PrivacyService } from '../privacy/privacy.service';

/** Who may see the dashboard and who may change it: sign-in, sessions and the guards. */
@Module({
  imports: [LibraryModule],
  controllers: [AccessController],
  providers: [
    UploadTokenService,
    AccessSettingsService,
    SessionService,
    AccessService,
    AdminGuard,
    DavAuthGuard,
    ReaderGuard,
    PrivacyService,
  ],
  exports: [
    UploadTokenService,
    AccessSettingsService,
    AccessService,
    AdminGuard,
    DavAuthGuard,
    ReaderGuard,
    PrivacyService,
  ],
})
export class AccessModule {}
