import { Controller, Get, Header } from '@nestjs/common';
import { UploadTokenService } from '../auth/upload-token.service';
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
  ) {}

  @Get('healthz')
  health() {
    return { ok: true, ...this.status.snapshot() };
  }

  /** Whether uploads are on, and the last rebuild and any error. */
  @Get('api/config')
  @Header('Cache-Control', 'no-store')
  async config() {
    const { building, last_build, last_error } = this.status.snapshot();
    return {
      uploads: this.tokens.enabled,
      webdav: this.tokens.enabled,
      has_data: await this.library.hasData(),
      meta: await this.library.meta(),
      building,
      last_build,
      last_error,
    };
  }

  /** {book id: cover URL} for every saved cover. */
  @Get('api/covers')
  @Header('Cache-Control', 'no-cache')
  coverUrls() {
    return this.covers.urls();
  }
}
