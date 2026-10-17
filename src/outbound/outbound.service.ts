import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Injectable } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { AccessService } from '../access/access.service';
import { localDate } from '../common/time';
import { CoverStore } from '../covers/cover-store.service';
import { ActivityLogService } from '../library/activity-log.service';
import { filterCovers } from '../privacy/privacy';
import { PrivacyService, type Viewer } from '../privacy/privacy.service';
import { StatsService, type StatsAudience, type StatsSet } from '../stats/stats.service';
import { nowSummary, type NowSummary } from './now';

/** settings.json's "outbound" section. The token itself is never kept, only its hash. */
export interface OutboundSettings {
  /** Books to finish each year, or null for no goal. */
  goal: number | null;
  /** sha256 of the device token (Home Assistant, an e-ink display…), or null when off. */
  device_token_hash: string | null;
  /** When the token was made, for the admin page. */
  device_token_created: string | null;
  /**
   * Whose view the device token gets: the admin's (everything, private books too) or a
   * visitor role's (filtered by its policy), for a display others can see.
   */
  device_audience: StatsAudience;
}

export const MAX_GOAL = 1000;

const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Where a device token can come from: a bearer header, X-Device-Token, or ?token=. */
export function deviceTokenOf(req: IncomingMessage): string {
  const auth = req.headers.authorization ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const header = req.headers['x-device-token'];
  if (typeof header === 'string' && header) return header.trim();
  const query = new URL(req.url ?? '/', 'http://x').searchParams.get('token');
  return query?.trim() ?? '';
}

/** Who a summary is for: the audience, and the viewer to filter covers with. */
export interface OutboundViewer {
  audience: StatsAudience;
  viewer: Viewer;
}

/**
 * The shared service behind the outbound views (Home Assistant sensors, badges, the e-ink
 * display, notifications): the "now" summary for an audience, the year goal and the device
 * token. Everything comes from the stats service's per-audience data, so nothing here says
 * more than that audience's page would.
 */
@Injectable()
export class OutboundService {
  constructor(
    private readonly stats: StatsService,
    private readonly settings: AccessSettingsService,
    private readonly privacy: PrivacyService,
    private readonly access: AccessService,
    private readonly covers: CoverStore,
    private readonly activity: ActivityLogService,
  ) {}

  async config(): Promise<OutboundSettings> {
    const raw = ((await this.settings.section('outbound')) ?? {}) as Partial<OutboundSettings>;
    const goal = Number(raw.goal);
    return {
      goal: Number.isInteger(goal) && goal > 0 && goal <= MAX_GOAL ? goal : null,
      device_token_hash:
        typeof raw.device_token_hash === 'string' && /^[0-9a-f]{64}$/.test(raw.device_token_hash)
          ? raw.device_token_hash
          : null,
      device_token_created:
        typeof raw.device_token_created === 'string' ? raw.device_token_created : null,
      device_audience: (['admin', 'public', 'reader', 'friends'] as string[]).includes(
        String(raw.device_audience),
      )
        ? (raw.device_audience as StatsAudience)
        : 'admin',
    };
  }

  async setGoal(goal: number | null): Promise<OutboundSettings> {
    const next = { ...(await this.config()), goal };
    await this.settings.saveSection('outbound', next);
    this.activity.record({
      type: 'settings',
      message: goal ? `Reading goal set to ${goal} books a year` : 'Reading goal removed',
      trigger: 'admin',
    });
    return next;
  }

  async setDeviceAudience(audience: StatsAudience): Promise<OutboundSettings> {
    const next = { ...(await this.config()), device_audience: audience };
    await this.settings.saveSection('outbound', next);
    this.activity.record({
      type: 'settings',
      message: `Device token now gets the ${audience} view`,
      trigger: 'admin',
    });
    return next;
  }

  /** Makes a new device token (replacing any old one) and returns it: it's shown only once. */
  async newDeviceToken(): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await this.settings.saveSection('outbound', {
      ...(await this.config()),
      device_token_hash: hash(token),
      device_token_created: new Date().toISOString().slice(0, 19),
    });
    this.activity.record({ type: 'settings', message: 'New device token made', trigger: 'admin' });
    return token;
  }

  async revokeDeviceToken(): Promise<void> {
    await this.settings.saveSection('outbound', {
      ...(await this.config()),
      device_token_hash: null,
      device_token_created: null,
    });
    this.activity.record({ type: 'settings', message: 'Device token revoked', trigger: 'admin' });
  }

  /** Whether the request carries the device token. */
  async hasDeviceToken(req: IncomingMessage): Promise<boolean> {
    const given = deviceTokenOf(req);
    const { device_token_hash: want } = await this.config();
    if (!given || !want) return false;
    const a = Buffer.from(hash(given), 'hex');
    const b = Buffer.from(want, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Who is asking for a device view: with the device token, the audience the admin chose
   * for it (by default the admin's own view, everything); else as
   * for the dashboard (the admin, or a visitor with their role's policy). Null when the
   * dashboard is behind a password and they aren't signed in.
   */
  async viewerFor(req: IncomingMessage): Promise<OutboundViewer | null> {
    if (await this.hasDeviceToken(req)) return this.as((await this.config()).device_audience);
    if (!(await this.access.canRead(req))) return null;
    const viewer = await this.privacy.viewer(req);
    return { audience: this.stats.audience(viewer), viewer };
  }

  /** The viewer for an audience, as the stats service works it out. */
  async as(audience: StatsAudience): Promise<OutboundViewer> {
    if (audience === 'admin') {
      return { audience, viewer: { role: 'admin', preview: null, policy: null } };
    }
    const { privacy } = await this.settings.load();
    return { audience, viewer: { role: audience, preview: null, policy: privacy[audience] } };
  }

  /** The audience's stats (data files and calcs), for views built on more than the summary. */
  set(who: OutboundViewer): Promise<StatsSet> {
    return this.stats.get(who.audience);
  }

  /** {book id: cover path} as this viewer may see them. */
  async coverUrls(who: OutboundViewer): Promise<Record<string, string>> {
    const urls = await this.covers.urls();
    const ctx = await this.privacy.context(who.viewer);
    return ctx ? filterCovers(urls, ctx) : urls;
  }

  /** The "now" summary for this viewer. */
  async now(who: OutboundViewer, today = localDate()): Promise<NowSummary> {
    const [set, covers, { goal }] = await Promise.all([
      this.set(who),
      this.coverUrls(who),
      this.config(),
    ]);
    return nowSummary({
      books: set.inputs.get('books'),
      reads: set.inputs.get('reads'),
      daily: set.inputs.get('daily'),
      current: set.rows.current,
      quotes: set.rows.quote_pool,
      asOf: set.rows.as_of,
      generated: set.generated,
      covers,
      policy: who.viewer.policy,
      goal,
      today,
    });
  }
}
