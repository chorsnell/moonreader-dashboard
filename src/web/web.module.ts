import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { WebController } from './web.controller';

@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [WebController],
})
export class WebModule {}
