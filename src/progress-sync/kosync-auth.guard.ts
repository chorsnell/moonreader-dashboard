import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { appConfig, type AppConfigType } from '../config/app.config';

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** KOSync's answer to a wrong user or password (koreader-sync-server's error 2001). */
export const UNAUTHORIZED = { code: 2001, message: 'Unauthorized' };

/** Whether `key` is what KOReader sends for the password `token`: its MD5, in hex. */
export function keyMatches(key: string, token: string): boolean {
  if (!token) return false;
  return timingSafeEqual(sha(key.trim().toLowerCase()), sha(md5(token)));
}

/**
 * KOReader's progress sync logs in with x-auth-user (any name here) and x-auth-key, the MD5
 * of the password. The password is UPLOAD_TOKEN, like WebDAV's.
 */
@Injectable()
export class KosyncAuthGuard implements CanActivate {
  constructor(@Inject(appConfig.KEY) private readonly config: AppConfigType) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.uploadToken) {
      throw new NotFoundException({
        code: 2001,
        message: 'Progress sync is turned off. Set UPLOAD_TOKEN to turn it on.',
      });
    }
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.headers['x-auth-user'];
    const key = req.headers['x-auth-key'];
    if (typeof user !== 'string' || !user.trim() || typeof key !== 'string') {
      throw new UnauthorizedException(UNAUTHORIZED);
    }
    if (!keyMatches(key, this.config.uploadToken)) throw new UnauthorizedException(UNAUTHORIZED);
    return true;
  }
}
