import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccessSettingsService } from '../access/access-settings.service';
import { AccessService } from '../access/access.service';
import { ReaderGuard } from '../access/reader.guard';
import { UploadTokenService } from '../access/upload-token.service';
import { CoverStore } from '../covers/cover-store.service';
import { LibraryService } from '../library/library.service';
import { StatusService } from '../library/status.service';
import { filterCovers, filterDataFile } from '../privacy/privacy';
import { PrivacyService } from '../privacy/privacy.service';

/** Small JSON endpoints for Docker's health check and for the page. */
@Controller()
export class StatusController {
  constructor(
    private readonly status: StatusService,
    private readonly library: LibraryService,
    private readonly covers: CoverStore,
    private readonly tokens: UploadTokenService,
    private readonly access: AccessService,
    private readonly settings: AccessSettingsService,
    private readonly privacy: PrivacyService,
  ) {}

  /** Says nothing private: anyone can reach it. */
  @Get('healthz')
  health() {
    return { ok: true, building: this.status.snapshot().building };
  }

  /**
   * Who you're signed in as and whether you can read the dashboard; then, if you can, the
   * last rebuild. Only the admin sees the upload button and build errors.
   */
  @Get('api/config')
  @Header('Cache-Control', 'no-store')
  async config(@Req() req: Request) {
    const role = await this.access.role(req);
    const { access } = await this.settings.load();
    const who = {
      access,
      role,
      admin: this.tokens.enabled,
      can_read: access === 'public' || role !== null,
    };
    if (!who.can_read) return who;
    const { building, last_build, last_error } = this.status.snapshot();
    const admin = role === 'admin';
    const viewer = await this.privacy.viewer(req);
    const ctx = await this.privacy.context(viewer);
    const meta = await this.library.meta();
    return {
      ...who,
      uploads: admin,
      webdav: admin,
      has_data: await this.library.hasData(),
      meta: ctx ? filterDataFile('meta.json', meta, ctx) : meta,
      // what's hidden from this viewer (null: nothing), and the role an admin is previewing as
      privacy: await this.privacy.summary(viewer, ctx),
      preview: viewer.preview,
      building,
      last_build: admin ? last_build : null, // its time of day is the last sync's
      last_error: admin ? last_error : null,
    };
  }

  /** {book id: cover URL} for every saved cover. */
  @Get('api/covers')
  @Header('Cache-Control', 'no-cache')
  @UseGuards(ReaderGuard)
  async coverUrls(@Req() req: Request) {
    const ctx = await this.privacy.context(await this.privacy.viewer(req));
    const urls = await this.covers.urls();
    return ctx ? filterCovers(urls, ctx) : urls;
  }
}
