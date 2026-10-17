import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { ArrModule } from './arr/arr.module';
import { appConfig } from './config/app.config';
import { ClubsModule } from './clubs/clubs.module';
import { DavModule } from './dav/dav.module';
import { FederationModule } from './federation/federation.module';
import { FriendsModule } from './friends/friends.module';
import { MediaModule } from './media/media.module';
import { NotifyModule } from './notify/notify.module';
import { OutboundModule } from './outbound/outbound.module';
import { PricesModule } from './prices/prices.module';
import { RebuildModule } from './rebuild/rebuild.module';
import { StatsModule } from './stats/stats.module';
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
    StatsModule,
    UploadModule,
    AdminModule,
    ArrModule,
    MediaModule,
    PricesModule,
    DavModule,
    FriendsModule,
    FederationModule,
    ClubsModule,
    NotifyModule,
    OutboundModule,
    // last: its catch-all route for the page's files must come after every other route
    WebModule,
  ],
})
export class AppModule {}
