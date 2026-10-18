import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Put,
} from '@nestjs/common';
import { AdminOnly } from '../access/admin.guard';
import { ActivityLogService } from '../library/activity-log.service';
import { type WeatherFile, WeatherError } from './weather';
import { WeatherService } from './weather.service';

function summary(f: WeatherFile, enabled: boolean) {
  return {
    enabled,
    location: f.location,
    pulled: f.pulled,
    error: f.error,
    days: f.days.length,
    first: f.days[0]?.date ?? null,
    last: f.days.at(-1)?.date ?? null,
  };
}

/** The home location for the weather, and fetching it. Admin only. */
@Controller('api/admin/weather')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class WeatherController {
  constructor(
    private readonly weather: WeatherService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get() {
    return summary(await this.weather.load(), this.weather.enabled);
  }

  /**
   * Sets the home location: {place} ("Leeds", or "53.8, -1.55"); '' removes it. Then
   * fetches its weather.
   */
  @Put('location')
  @HttpCode(200)
  async setLocation(@Body() body: unknown) {
    const place = (body as { place?: unknown })?.place;
    if (typeof place !== 'string') throw new BadRequestException({ error: 'Send {place}.' });
    let location = null;
    if (place.trim()) {
      try {
        location = await this.weather.resolve(place);
      } catch (e) {
        if (e instanceof WeatherError) throw new BadRequestException({ error: e.message });
        throw e;
      }
    }
    await this.weather.setLocation(location);
    this.activity.record({
      type: 'settings',
      message: location
        ? 'Home location for the weather set'
        : 'Home location for the weather removed',
      trigger: 'admin',
    });
    const r =
      location && this.weather.enabled ? await this.weather.refresh() : { added: 0, error: null };
    return { ok: true, ...r, ...summary(await this.weather.load(), this.weather.enabled) };
  }

  /** Fetches any days not yet cached. */
  @Post('refresh')
  @HttpCode(200)
  async refresh() {
    const r = await this.weather.refresh();
    return { ok: true, ...r, ...summary(await this.weather.load(), this.weather.enabled) };
  }
}
