import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { FederationModule } from '../federation/federation.module';
import { FriendsModule } from '../friends/friends.module';
import { LibraryModule } from '../library/library.module';
import { ClubsController } from './clubs.controller';
import { ClubsService } from './clubs.service';

/** Book clubs hosted here, and their spoiler-safe comments. */
@Module({
  imports: [AccessModule, LibraryModule, FriendsModule, FederationModule],
  controllers: [ClubsController],
  providers: [ClubsService],
  exports: [ClubsService],
})
export class ClubsModule {}
