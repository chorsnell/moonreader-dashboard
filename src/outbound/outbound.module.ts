import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { StatsModule } from '../stats/stats.module';
import { BadgesController } from './badges.controller';
import { EinkController } from './eink.controller';
import { NowController } from './now.controller';
import { OutboundService } from './outbound.service';

/**
 * Outbound views of your reading for other things (EP-12): Home Assistant sensors, badges,
 * an e-ink display. OutboundService is exported for other features (notifications) to reuse.
 */
@Module({
  imports: [AccessModule, LibraryModule, CoversModule, StatsModule],
  controllers: [NowController, BadgesController, EinkController],
  providers: [OutboundService],
  exports: [OutboundService],
})
export class OutboundModule {}
