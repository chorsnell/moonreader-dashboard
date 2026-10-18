import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { AdminOnly } from '../access/admin.guard';
import { ActivityLogService } from '../library/activity-log.service';
import {
  calendarHost,
  EVENT_KINDS,
  LifeEventError,
  type LifeEventsFile,
  MAX_EVENTS,
  newEventId,
  toCalendarUrl,
  toManualEvent,
} from './life-events';
import { LifeEventsService } from './life-events.service';

const EVENT_ID = /^[a-z0-9-]{1,60}$/;

function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof LifeEventError) throw new BadRequestException({ error: e.message });
    throw e;
  }
}

/** What the admin page gets: everything but the calendar's full address. */
function forAdmin(f: LifeEventsFile) {
  return {
    events: f.events,
    kinds: EVENT_KINDS,
    calendar: {
      set: Boolean(f.calendar.url),
      host: calendarHost(f.calendar.url),
      pulled: f.calendar.pulled,
      error: f.calendar.error,
      events: f.calendar.events,
    },
  };
}

/** Holidays, trips and life events: the admin's list and calendar feed. Admin only. */
@Controller('api/admin/life-events')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class LifeEventsController {
  constructor(
    private readonly events: LifeEventsService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list() {
    return forAdmin(await this.events.load());
  }

  /** Adds an event marked by hand: {title, kind, start, end}. */
  @Post()
  @HttpCode(200)
  async add(@Body() body: unknown) {
    const event = await this.events.update((f) => {
      if (f.events.length >= MAX_EVENTS) {
        throw new BadRequestException({ error: `At most ${MAX_EVENTS} events.` });
      }
      const e = checked(() =>
        toManualEvent(body, newEventId(f, String((body as { title?: unknown })?.title ?? ''))),
      );
      return { file: { ...f, events: [...f.events, e] }, result: e };
    });
    this.activity.log(`Life event "${event.title}" added from the admin page`);
    return { ok: true, event };
  }

  /** Sets the calendar's address ({url}; '' removes it and its events), then reads it. */
  @Put('calendar')
  @HttpCode(200)
  async setCalendar(@Body() body: unknown) {
    const url = checked(() => toCalendarUrl((body as { url?: unknown })?.url));
    await this.events.update((f) => ({
      file: { ...f, calendar: { url, pulled: null, error: null, events: [] } },
      result: null,
    }));
    this.activity.record({
      type: 'settings',
      message: url ? 'Calendar for life events set' : 'Calendar for life events removed',
      trigger: 'admin',
    });
    const r = url ? await this.events.refresh() : { events: 0, error: null };
    return { ok: true, read: r.events, error: r.error, ...forAdmin(await this.events.load()) };
  }

  /** Reads the calendar again now. */
  @Post('calendar/refresh')
  @HttpCode(200)
  async refresh() {
    const r = await this.events.refresh();
    return { ok: true, read: r.events, error: r.error, ...forAdmin(await this.events.load()) };
  }

  // after the calendar routes, so PUT /calendar isn't taken for an event id
  @Put(':id')
  @HttpCode(200)
  async change(@Param('id') id: string, @Body() body: unknown) {
    if (!EVENT_ID.test(id)) throw new NotFoundException({ error: 'No such event.' });
    const event = await this.events.update((f) => {
      if (!f.events.some((e) => e.id === id)) {
        throw new NotFoundException({ error: 'No such event.' });
      }
      const e = checked(() => toManualEvent(body, id));
      return { file: { ...f, events: f.events.map((x) => (x.id === id ? e : x)) }, result: e };
    });
    this.activity.log(`Life event "${event.title}" changed from the admin page`);
    return { ok: true, event };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    if (!EVENT_ID.test(id)) throw new NotFoundException({ error: 'No such event.' });
    await this.events.update((f) => ({
      file: { ...f, events: f.events.filter((e) => e.id !== id) },
      result: null,
    }));
    this.activity.log(`Life event ${id} removed from the admin page`);
    return { ok: true };
  }
}
