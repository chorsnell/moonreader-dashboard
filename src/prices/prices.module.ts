import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';

/** What each book cost: the admin's price list, its CSV import and data/prices.json. */
@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [PricesController],
  providers: [PricesService],
  exports: [PricesService],
})
export class PricesModule {}
