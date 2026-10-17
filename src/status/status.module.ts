import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { StatusController } from './status.controller';

@Module({
  imports: [AccessModule, CoversModule, LibraryModule],
  controllers: [StatusController],
})
export class StatusModule {}
