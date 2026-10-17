import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { FriendsModule } from '../friends/friends.module';
import { LibraryModule } from '../library/library.module';
import { FederationController } from './federation.controller';
import { FederationService } from './federation.service';
import { FederationStore } from './federation.store';

/** Following friends' installations, and letting them follow this one. */
@Module({
  imports: [AccessModule, LibraryModule, FriendsModule],
  controllers: [FederationController],
  providers: [FederationStore, FederationService],
  exports: [FederationStore, FederationService],
})
export class FederationModule {}
