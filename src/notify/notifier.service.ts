import { Injectable } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { localDateTime } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import {
  KIND,
  NOTIFY_EVENTS,
  requestFor,
  toNotifySettings,
  type Channel,
  type NotifyEvent,
  type NotifySettings,
} from './notify';

const TIMEOUT_MS = 10_000;

/** How sending an event went, per channel. */
export interface SendResult {
  /** False when the admin switched this kind of event off (nothing was sent). */
  enabled: boolean;
  sent: number;
  failed: { channel: string; error: string }[];
}

/**
 * Sends notifications to the owner's channels (ntfy, Gotify, Discord, webhooks), set in
 * Admin → Notifications. Exported for any feature with something to tell the owner:
 *
 *   constructor(private readonly notifier: NotifierService) {}
 *   await this.notifier.send({ kind: 'highlight_review', title: '…', message: '…' });
 *
 * Give a new kind a toggle in admin with registerKind. URLs and tokens never leave this
 * service: errors name the channel, not its address.
 */
@Injectable()
export class NotifierService {
  constructor(
    private readonly settings: AccessSettingsService,
    private readonly activity: ActivityLogService,
  ) {}

  /** The settings, with their secrets: for the server only. */
  async load(): Promise<NotifySettings> {
    return toNotifySettings(await this.settings.section('notify'));
  }

  save(s: NotifySettings): Promise<void> {
    return this.settings.saveSection('notify', s);
  }

  /** Adds a kind of event to the toggles in admin (on unless the admin turns it off). */
  registerKind(kind: string, label: string, note = ''): void {
    if (!KIND.test(kind) || NOTIFY_EVENTS.some((e) => e.kind === kind)) return;
    NOTIFY_EVENTS.push({ kind, label, note });
  }

  /** Whether this kind of event is switched on and there's somewhere to send it. */
  async wants(kind: string): Promise<boolean> {
    const s = await this.load();
    return s.channels.length > 0 && s.events[kind] !== false;
  }

  /** Sends an event to every channel, unless its kind is switched off. Never throws. */
  async send(event: NotifyEvent): Promise<SendResult> {
    const s = await this.load();
    if (s.events[event.kind] === false) return { enabled: false, sent: 0, failed: [] };
    const results = await Promise.all(s.channels.map((c) => this.deliver(c, event)));
    const failed = results.filter((r): r is { channel: string; error: string } => r !== null);
    const sent = results.length - failed.length;
    if (s.channels.length) {
      this.activity.record({
        type: 'notify',
        message: failed.length
          ? `Couldn't send "${event.title}" to ${failed.map((f) => f.channel).join(', ')}`
          : `Sent "${event.title}"`,
        outcome: failed.length && !sent ? 'failed' : 'ok',
        trigger: event.kind,
        ...(failed.length
          ? { error: failed.map((f) => `${f.channel}: ${f.error}`).join('; ') }
          : {}),
        details: { kind: event.kind, sent, failed: failed.length },
      });
    }
    return { enabled: true, sent, failed };
  }

  /** Sends to one channel, whatever the toggles say: the "Send test" button. */
  async sendTo(
    channelId: string,
    event: NotifyEvent,
  ): Promise<{ ok: boolean; error?: string } | null> {
    const c = (await this.load()).channels.find((x) => x.id === channelId);
    if (!c) return null;
    const failed = await this.deliver(c, event);
    return failed ? { ok: false, error: failed.error } : { ok: true };
  }

  /** null when it went, else why not (never with the channel's address or token). */
  private async deliver(
    c: Channel,
    event: NotifyEvent,
  ): Promise<{ channel: string; error: string } | null> {
    const req = requestFor(c, event, localDateTime());
    try {
      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.arrayBuffer().catch(() => undefined);
      if (!res.ok) return { channel: c.name, error: `HTTP ${res.status}` };
      return null;
    } catch (e) {
      const why =
        e instanceof Error && e.name === 'TimeoutError'
          ? 'no answer in 10 s'
          : e instanceof Error && e.cause instanceof Error
            ? e.cause.message.replace(/https?:\/\/\S+/g, '…')
            : 'could not connect';
      return { channel: c.name, error: why };
    }
  }
}
