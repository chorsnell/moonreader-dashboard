import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { appConfig } from './config/app.config';
import { DavModule } from './dav/dav.module';
import { MediaModule } from './media/media.module';
import { RebuildModule } from './rebuild/rebuild.module';
import { StatusModule } from './status/status.module';
import { UploadModule } from './upload/upload.module';
import { WebModule } from './web/web.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [appConfig] }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    RebuildModule,
    StatusModule,
    UploadModule,
    AdminModule,
    MediaModule,
    DavModule,
    // last: its catch-all route for the page's files must come after every other route
    WebModule,
  ],
})
export class AppModule {}
