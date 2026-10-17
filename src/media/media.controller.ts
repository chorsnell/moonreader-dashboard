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
import { MediaFiles, readJson } from './media-files.service';
import { MediaService } from './media.service';

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

  /** Rebuilds the media data now. */
  @Post('rebuild')
  @HttpCode(200)
  rebuild() {
    void this.media.rebuildNow();
    return { ok: true };
  }
}
