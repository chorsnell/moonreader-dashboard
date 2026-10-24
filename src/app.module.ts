import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { ArrModule } from './arr/arr.module';
import { ChallengesModule } from './challenges/challenges.module';
import { appConfig } from './config/app.config';
import { ClubsModule } from './clubs/clubs.module';
import { DavModule } from './dav/dav.module';
import { FederationModule } from './federation/federation.module';
import { FeedsModule } from './feeds/feeds.module';
import { FriendsModule } from './friends/friends.module';
import { HighlightsModule } from './highlights/highlights.module';
import { LifeEventsModule } from './life-events/life-events.module';
import { MediaModule } from './media/media.module';
import { NotifyModule } from './notify/notify.module';
import { OutboundModule } from './outbound/outbound.module';
import { PricesModule } from './prices/prices.module';
import { RebuildModule } from './rebuild/rebuild.module';
import { ReviewModule } from './review/review.module';
import { StatsModule } from './stats/stats.module';
import { StatusModule } from './status/status.module';
import { UploadModule } from './upload/upload.module';
import { WantToReadModule } from './want-to-read/want-to-read.module';
import { WeatherModule } from './weather/weather.module';
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
    ChallengesModule,
    MediaModule,
    PricesModule,
    LifeEventsModule,
    WeatherModule,
    DavModule,
    FriendsModule,
    FederationModule,
    ClubsModule,
    NotifyModule,
    ReviewModule,
    OutboundModule,
    FeedsModule,
    HighlightsModule,
    WantToReadModule,
    // last: its catch-all route for the page's files must come after every other route
    WebModule,
  ],
})
export class AppModule {}
