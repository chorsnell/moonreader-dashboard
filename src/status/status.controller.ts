import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccessSettingsService } from '../access/access-settings.service';
import { AccessService } from '../access/access.service';
import { ReaderGuard } from '../access/reader.guard';
import { UploadTokenService } from '../access/upload-token.service';
import { CoverStore } from '../covers/cover-store.service';
import { LibraryService } from '../library/library.service';
import { StatusService } from '../library/status.service';

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
    return {
      ...who,
      uploads: admin,
      webdav: admin,
      has_data: await this.library.hasData(),
      has_books: await this.library.hasBooks(),
      has_media: await this.library.hasMedia(),
      meta: await this.library.meta(),
      building,
      last_build,
      last_error: admin ? last_error : null,
    };
  }

  /** {book id: cover URL} for every saved cover. */
  @Get('api/covers')
  @Header('Cache-Control', 'no-cache')
  @UseGuards(ReaderGuard)
  coverUrls() {
    return this.covers.urls();
  }
}
