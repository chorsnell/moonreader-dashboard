import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { KoreaderSyncModule } from '../koreader-sync/koreader-sync.module';
import { LibraryModule } from '../library/library.module';
import { DavController } from './dav.controller';
import { DavService } from './dav.service';

@Module({
  imports: [AccessModule, LibraryModule, KoreaderSyncModule],
  controllers: [DavController],
  providers: [DavService],
})
export class DavModule {}
