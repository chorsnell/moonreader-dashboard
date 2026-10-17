import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module';
import { WebController } from './web.controller';

@Module({
  imports: [LibraryModule],
  controllers: [WebController],
})
export class WebModule {}
