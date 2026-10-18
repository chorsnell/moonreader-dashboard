import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LibraryModule } from '../library/library.module';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';

/** Daily weather at a home location (Open-Meteo), for "Reading and the weather". */
@Module({
  imports: [AccessModule, LibraryModule],
  controllers: [WeatherController],
  providers: [WeatherService],
})
export class WeatherModule {}
