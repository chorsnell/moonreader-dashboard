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
import { MAX_CHANNELS, NotifyError, publicSettings, toChannel, withOptions } from './notify';
import { NotifyWatchService } from './notify-watch.service';
import { NotifierService } from './notifier.service';

/**
 * Admin → Notifications (BOO-72): where events go and which ones. Admin only, and channel
 * URLs and tokens are never sent back: only their type, name and host.
 */
@Controller('api/admin/notify')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class NotifyController {
  constructor(
    private readonly notifier: NotifierService,
    private readonly watch: NotifyWatchService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get() {
    return publicSettings(await this.notifier.load());
  }

  /** {events?, streak_hour?, streak_min?} */
  @Put()
  @HttpCode(200)
  async options(@Body() body: unknown) {
    const next = withOptions(await this.notifier.load(), body);
    await this.notifier.save(next);
    return { ok: true, ...publicSettings(next) };
  }

  /** {type, name?, url, token?}: a new channel. */
  @Post('channels')
  @HttpCode(200)
  async add(@Body() body: unknown) {
    const s = await this.notifier.load();
    if (s.channels.length >= MAX_CHANNELS) {
      throw new BadRequestException({ error: `${MAX_CHANNELS} channels at most.` });
    }
    let channel;
    try {
      channel = toChannel(body);
    } catch (e) {
      if (e instanceof NotifyError) throw new BadRequestException({ error: e.message });
      throw e;
    }
    s.channels.push(channel);
    await this.notifier.save(s);
    this.activity.record({
      type: 'settings',
      message: `Added a notification channel: ${channel.name} (${channel.type})`,
      trigger: 'admin',
    });
    return { ok: true, id: channel.id, ...publicSettings(s) };
  }

  @Delete('channels/:id')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    const s = await this.notifier.load();
    const i = s.channels.findIndex((c) => c.id === id);
    if (i < 0) throw new NotFoundException({ error: 'No such channel.' });
    const [gone] = s.channels.splice(i, 1);
    await this.notifier.save(s);
    this.activity.record({
      type: 'settings',
      message: `Removed the notification channel ${gone.name}`,
      trigger: 'admin',
    });
    return { ok: true, ...publicSettings(s) };
  }

  /** Sends a test message to one channel, and says whether it went. */
  @Post('channels/:id/test')
  @HttpCode(200)
  async test(@Param('id') id: string) {
    const r = await this.notifier.sendTo(id, {
      kind: 'test',
      title: 'Test from your reading dashboard',
      message: 'If you can read this, notifications reach you here.',
      tags: ['books'],
    });
    if (!r) throw new NotFoundException({ error: 'No such channel.' });
    return r;
  }

  /** Looks for events now (as after a rebuild): what was sent. */
  @Post('check')
  @HttpCode(200)
  async check() {
    const sent = await this.watch.check('admin');
    return { ok: true, sent: sent.map((e) => ({ kind: e.kind, title: e.title })) };
  }
}
