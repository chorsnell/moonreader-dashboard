import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { LifeEventsController } from './life-events.controller';
import { LifeEventsService } from './life-events.service';

/** Holidays, trips and life events: library/life_events.json, a calendar feed, data/life_events.json. */
@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [LifeEventsController],
  providers: [LifeEventsService],
  exports: [LifeEventsService],
})
export class LifeEventsModule {}
