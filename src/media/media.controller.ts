import { join } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
} from '@nestjs/common';
import { AdminOnly } from '../access/admin.guard';
import { appConfig, type AppConfigType } from '../config/app.config';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { MEDIA_META, MediaBuildService } from './media-build.service';
import { MediaFiles, readJson, toSubscriptions } from './media-files.service';
import { MediaService } from './media.service';
import { TautulliClient, type TautulliConnection } from './sources/tautulli.client';

const isStringList = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((s) => typeof s === 'string') && x.length <= 50;

/** The admin's settings for other media: Netflix profiles, the TMDB key, and the build status. */
@Controller('api/admin/media')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class MediaController {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly files: MediaFiles,
    private readonly builder: MediaBuildService,
    private readonly media: MediaService,
    private readonly library: LibraryService,
    private readonly activity: ActivityLogService,
    private readonly tautulli: TautulliClient,
  ) {}

  /** What's been uploaded, which Netflix profiles are imported, and the last media build. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async status() {
    const settings = await this.files.settings();
    const inbox = await this.builder.netflixInbox();
    const found = [...new Set(inbox.flatMap((f) => f.profiles))].sort();
    return {
      ...this.media.status(),
      meta: await readJson<Record<string, unknown>>(join(this.library.data, MEDIA_META), {}),
      netflix: { files: inbox, profiles_found: found, profiles: settings.netflix.profiles },
      tautulli: {
        url: settings.tautulli.url || this.config.tautulliUrl,
        user_id: settings.tautulli.user_id,
        has_key: Boolean(settings.tautulli.api_key || this.config.tautulliApiKey),
        from_env: !settings.tautulli.url && Boolean(this.config.tautulliUrl),
        poll_minutes: this.config.mediaPollMinutes,
      },
      subscriptions: settings.subscriptions,
      tmdb: {
        configured: Boolean(settings.tmdb.api_key || this.config.tmdbApiKey),
        from_env: !settings.tmdb.api_key && Boolean(this.config.tmdbApiKey),
      },
    };
  }

  /** Which Netflix profiles are yours: none is imported until chosen (one-profile exports are). */
  @Post('netflix')
  @HttpCode(200)
  async netflix(@Body() body: unknown) {
    const profiles = (body as { profiles?: unknown } | null)?.profiles;
    if (!isStringList(profiles))
      throw new BadRequestException({ error: 'Send a list of profile names.' });
    await this.files.update((s) => (s.netflix.profiles = [...new Set(profiles)].sort()));
    this.activity.log(`Netflix profiles to import: ${profiles.join(', ') || 'none'}`);
    this.library.changed();
    return { ok: true, profiles };
  }

  /** The TMDB key for posters and genres. An empty key falls back to TMDB_API_KEY. */
  @Post('tmdb')
  @HttpCode(200)
  async tmdb(@Body() body: unknown) {
    const key = (body as { api_key?: unknown } | null)?.api_key;
    if (typeof key !== 'string' || key.length > 1000) {
      throw new BadRequestException({ error: 'Send the key as api_key.' });
    }
    await this.files.update((s) => (s.tmdb.api_key = key.trim()));
    this.activity.log(key.trim() ? 'Saved a TMDB key' : 'Removed the TMDB key');
    void this.media.rebuildNow();
    return { ok: true };
  }

  /** Checks a Tautulli address and key (or the saved ones) and lists its Plex users. */
  @Post('tautulli/test')
  @HttpCode(200)
  async testTautulli(@Body() body: unknown) {
    const conn = await this.connection(body);
    try {
      return { ok: true, users: await this.tautulli.test(conn) };
    } catch (e) {
      throw new BadRequestException({ error: (e as Error).message });
    }
  }

  /**
   * Saves Tautulli's address, key and the Plex user to import, then pulls. A blank key keeps
   * the saved one. Switching server or user forgets the plays pulled before.
   */
  @Post('tautulli')
  @HttpCode(200)
  async saveTautulli(@Body() body: unknown) {
    const conn = await this.connection(body);
    const before = await this.files.tautulli();
    await this.files.update((s) => (s.tautulli = { ...conn }));
    if (before && (before.url !== conn.url || before.user_id !== conn.user_id)) {
      await this.tautulli.clearCache();
    }
    this.activity.log(`Saved the Tautulli settings (${conn.url})`);
    void this.media.pullTautulli();
    return { ok: true };
  }

  /** Pulls new plays from Tautulli now ("Sync Plex now"). */
  @Post('tautulli/sync')
  @HttpCode(200)
  async syncTautulli() {
    if (!(await this.files.tautulli())) {
      throw new BadRequestException({ error: 'Set up Tautulli first.' });
    }
    const r = await this.media.pullTautulli();
    const error = this.media.status().tautulli.last_error;
    if (!r && error) throw new BadRequestException({ error });
    return { ok: true, new_rows: r?.new_rows ?? 0, total: r?.total ?? 0 };
  }

  /** The connection in a request, with the saved (or env) values for what it leaves out. */
  private async connection(body: unknown): Promise<TautulliConnection> {
    const b = (body ?? {}) as Record<string, unknown>;
    const saved = await this.files.tautulli();
    const settings = (await this.files.settings()).tautulli;
    const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
    const url = (str(b.url) || saved?.url || '').replace(/\/+$/, '');
    const apiKey = str(b.api_key) || saved?.api_key || '';
    const userId = 'user_id' in b ? str(b.user_id) : settings.user_id;
    if (!/^https?:\/\/[^\s]+$/i.test(url)) {
      throw new BadRequestException({
        error: "Enter Tautulli's address, such as http://tautulli:8181.",
      });
    }
    if (!apiKey)
      throw new BadRequestException({
        error: "Enter Tautulli's API key (Settings → Web Interface).",
      });
    if (userId && !/^\d+$/.test(userId))
      throw new BadRequestException({ error: 'Pick a Plex user.' });
    return { url, api_key: apiKey, user_id: userId };
  }

  /** Streaming subscriptions, for the cost per hour watched. */
  @Post('subscriptions')
  @HttpCode(200)
  async subscriptions(@Body() body: unknown) {
    let list;
    try {
      list = toSubscriptions((body as { subscriptions?: unknown } | null)?.subscriptions);
    } catch (e) {
      throw new BadRequestException({ error: (e as Error).message });
    }
    await this.files.update((s) => (s.subscriptions = list));
    this.activity.log(`Saved ${list.length} streaming subscription(s)`);
    return { ok: true, subscriptions: list };
  }

  /** Rebuilds the media data now. */
  @Post('rebuild')
  @HttpCode(200)
  rebuild() {
    void this.media.rebuildNow();
    return { ok: true };
  }
}
