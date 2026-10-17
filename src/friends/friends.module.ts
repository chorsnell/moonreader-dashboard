import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { FriendStore } from './friend-store.service';
import { FriendsAccessService } from './friends-access.service';
import { FriendsController } from './friends.controller';
import { ShareService } from './share.service';

/** Friends' reading in your dashboard, and sharing yours with them. */
@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [FriendsController],
  providers: [FriendStore, ShareService, FriendsAccessService],
  exports: [FriendStore, ShareService, FriendsAccessService],
})
export class FriendsModule {}
