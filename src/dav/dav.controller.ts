import { All, Controller, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DavAuthGuard } from '../auth/dav-auth.guard';
import { DavExceptionFilter } from './dav-exception.filter';
import { DavService } from './dav.service';

/**
 * WebDAV at /dav/. Every method goes through one handler, because WebDAV is a protocol of
 * its own (PROPFIND, MKCOL, MOVE…) rather than a set of resources.
 */
@Controller('dav')
@UseGuards(DavAuthGuard)
@UseFilters(DavExceptionFilter)
export class DavController {
  constructor(private readonly dav: DavService) {}

  @All(['', '*path'])
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    let path: string;
    try {
      path = decodeURIComponent(req.path);
    } catch {
      req.resume();
      res.status(400).type('text/plain; charset=utf-8').send('Bad path');
      return;
    }
    const result = await this.dav.handle(req, path);
    if (!req.readableEnded) req.resume(); // drop any body the handler didn't read
    res.status(result.status).set(result.headers ?? {});
    if (result.file) res.sendFile(result.file, { dotfiles: 'allow', cacheControl: false });
    else if (result.body !== undefined) res.send(result.body);
    else res.end();
  }
}
