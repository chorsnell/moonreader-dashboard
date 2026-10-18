import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';

/** Reading challenges (BOO-80): set by the admin, shown to everyone on the Overview. */
@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [ChallengesController],
  providers: [ChallengesService],
})
export class ChallengesModule {}
