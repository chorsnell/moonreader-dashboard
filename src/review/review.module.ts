import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { NotifyModule } from '../notify/notify.module';
import { ReviewAdminController, ReviewController } from './review.controller';
import { ReviewService } from './review.service';

/** The daily highlight review (BOO-83), sending its morning list through notifications (BOO-72). */
@Module({
  imports: [AccessModule, LibraryModule, NotifyModule],
  controllers: [ReviewController, ReviewAdminController],
  providers: [ReviewService],
})
export class ReviewModule {}
