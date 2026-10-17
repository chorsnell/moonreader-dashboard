import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LibraryModule } from '../library/library.module';
import { DavController } from './dav.controller';
import { DavService } from './dav.service';

@Module({
  imports: [AuthModule, LibraryModule],
  controllers: [DavController],
  providers: [DavService],
})
export class DavModule {}
