import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { ArrController } from './arr.controller';
import { ArrService } from './arr.service';

/** Requests to the admin's own *arr book manager (BOO-64). */
@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [ArrController],
  providers: [ArrService],
})
export class ArrModule {}
