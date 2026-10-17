import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Put,
  Query,
  Redirect,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { AdminOnly } from '../access/admin.guard';
import { appConfig, type AppConfigType } from '../config/app.config';
import { publicPrefix } from '../common/http/public-prefix';
import { RequestBodyError, saveRequestBody } from '../common/http/request-body';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService, safeFileName } from '../library/library.service';
import { MediaInboxService, MediaUploadError } from '../media/media-inbox.service';

/** Every zip file, .mrpro included, starts with "PK". */
const isZip = (chunk: Buffer) => chunk.subarray(0, 2).toString('latin1') === 'PK';

/**
 * The dashboard's "Update data" button: PUT /upload?name=<file>.mrpro with the file as the
 * body. Other media say which source with ?source=, e.g. ?source=netflix&name=ViewingActivity.csv.
 */
@Controller('upload')
export class UploadController {
  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly library: LibraryService,
    private readonly activity: ActivityLogService,
    private readonly media: MediaInboxService,
  ) {}

  /** An old bookmark: open the admin page. */
  @Get()
  @Redirect()
  open(@Headers() headers: IncomingHttpHeaders) {
    return { url: `${publicPrefix(headers, this.config.basePath)}/#admin`, statusCode: 302 };
  }

  @Put()
  @HttpCode(200)
  @AdminOnly({
    denied: 'Sign in as the admin to upload.',
    off: 'Uploads are turned off on this server.',
    slow: true,
  })
  async upload(
    @Req() req: Request,
    @Query('name') name = 'backup.mrpro',
    @Query('source') source = '',
  ) {
    const file = safeFileName(basename(name));
    if (source === 'netflix' || (!source && /\.csv$/i.test(file))) {
      try {
        return { ok: true, ...(await this.media.receiveNetflix(req, file)) };
      } catch (e) {
        if (e instanceof MediaUploadError) throw new BadRequestException({ error: e.message });
        throw e;
      }
    }
    if (source) {
      req.resume();
      throw new BadRequestException({ error: `Unknown source "${source}".` });
    }
    if (!file.toLowerCase().endsWith('.mrpro')) {
      req.resume();
      throw new BadRequestException({ error: "That isn't a .mrpro backup file." });
    }
    const dest = join(this.library.inbox, file);
    try {
      await saveRequestBody(req, dest, { accept: isZip });
    } catch (e) {
      if (!(e instanceof RequestBodyError)) throw e;
      const error = e.problem === 'bad-content' ? "That file isn't a Moon+ backup." : e.message;
      this.activity.record({
        type: 'upload',
        message: `Refused upload ${file}`,
        outcome: 'failed',
        trigger: 'upload',
        error,
        details: { file },
      });
      throw new BadRequestException({ error });
    }
    const { size } = await stat(dest);
    this.activity.record({
      type: 'upload',
      message: `Received upload ${file} (${Math.floor(size / (1024 * 1024))} MB)`,
      trigger: 'upload',
      details: { file, size },
    });
    this.library.changed('upload');
    return { ok: true };
  }
}
