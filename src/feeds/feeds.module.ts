import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ClubsModule } from '../clubs/clubs.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';

/** Atom and iCal feeds at secret URLs (BOO-74). */
@Module({
  imports: [AccessModule, LibraryModule, CoversModule, ClubsModule],
  controllers: [FeedsController],
  providers: [FeedsService],
  exports: [FeedsService],
})
export class FeedsModule {}
