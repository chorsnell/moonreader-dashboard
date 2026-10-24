import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { WantToReadController } from './want-to-read.controller';

/** The owner's own want-to-read list (BOO-102). WantStore lives in LibraryModule. */
@Module({
  imports: [AccessModule, LibraryModule, CoversModule],
  controllers: [WantToReadController],
})
export class WantToReadModule {}
