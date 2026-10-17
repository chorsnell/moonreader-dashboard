import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessService } from './access.service';
import { UploadTokenService } from './upload-token.service';

/**
 * For WebDAV: any username, UPLOAD_TOKEN as the password (or the admin sign-in cookie, for
 * a browser). OPTIONS is always allowed, so clients can discover the server before they log in.
 */
@Injectable()
export class DavAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: UploadTokenService,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === 'OPTIONS') return true;
    if (!this.tokens.enabled) {
      throw new NotFoundException('WebDAV is turned off. Set UPLOAD_TOKEN to turn it on.');
    }
    if (!(await this.access.isAdmin(req))) {
      throw new UnauthorizedException(
        'Log in with any username and your UPLOAD_TOKEN as the password.',
      );
    }
    return true;
  }
}
