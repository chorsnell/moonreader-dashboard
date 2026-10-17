import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { FriendsModule } from '../friends/friends.module';
import { LibraryModule } from '../library/library.module';
import { StatsModule } from '../stats/stats.module';
import { NotifyWatchService } from './notify-watch.service';
import { NotifyController } from './notify.controller';
import { NotifierService } from './notifier.service';

/**
 * Notifications (BOO-72). Import this module and inject NotifierService to send your own
 * events: notifier.send({ kind, title, message, url?, tags?, priority?, data? }).
 */
@Module({
  imports: [AccessModule, LibraryModule, StatsModule, FriendsModule],
  controllers: [NotifyController],
  providers: [NotifierService, NotifyWatchService],
  exports: [NotifierService],
})
export class NotifyModule {}
