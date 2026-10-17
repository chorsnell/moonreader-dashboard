import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

/** The page's calcs worked out on the server, and the JSON API that serves them. */
@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
