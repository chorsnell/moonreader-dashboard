import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ActivityLogService } from '../library/activity-log.service';
import { AccessService } from './access.service';
import { UploadTokenService } from './upload-token.service';

/** At most one "wrong password" log entry this often, so a client retrying doesn't flood it. */
const AUTH_FAILURE_LOG_MS = 10 * 60_000;

/**
 * For WebDAV: any username, UPLOAD_TOKEN as the password (or the admin sign-in cookie, for
 * a browser). OPTIONS is always allowed, so clients can discover the server before they log in.
 */
@Injectable()
export class DavAuthGuard implements CanActivate {
  private lastFailureLogged = 0;

  constructor(
    private readonly tokens: UploadTokenService,
    private readonly access: AccessService,
    private readonly activity: ActivityLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === 'OPTIONS') return true;
    if (!this.tokens.enabled) {
      throw new NotFoundException('WebDAV is turned off. Set UPLOAD_TOKEN to turn it on.');
    }
    if (!(await this.access.isAdmin(req))) {
      // clients ask without a password first to be told to log in; only a wrong one is news
      if (req.headers.authorization && Date.now() - this.lastFailureLogged > AUTH_FAILURE_LOG_MS) {
        this.lastFailureLogged = Date.now();
        const agent = String(req.headers['user-agent'] ?? '').slice(0, 160) || null;
        this.activity.record({
          type: 'sync',
          message: 'WebDAV: refused a login with the wrong password',
          outcome: 'failed',
          trigger: 'webdav',
          error: 'Wrong password: use your UPLOAD_TOKEN',
          details: { kind: 'auth', method: req.method, path: req.path, device: agent },
        });
      }
      throw new UnauthorizedException(
        'Log in with any username and your UPLOAD_TOKEN as the password.',
      );
    }
    return true;
  }
}
