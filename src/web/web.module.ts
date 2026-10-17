import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { ShareService } from '../share/share.service';
import { StatsModule } from '../stats/stats.module';
import { WebController } from './web.controller';

@Module({
  imports: [AccessModule, LibraryModule, CoversModule, StatsModule],
  controllers: [WebController],
  providers: [ShareService],
})
export class WebModule {}
