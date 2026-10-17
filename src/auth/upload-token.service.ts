import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/**
 * UPLOAD_TOKEN guards uploads and WebDAV. The dashboard sends it as X-Upload-Token; WebDAV
 * clients send it as the password of HTTP Basic auth, with any username.
 */
@Injectable()
export class UploadTokenService {
  constructor(@Inject(appConfig.KEY) private readonly config: AppConfigType) {}

  get enabled(): boolean {
    return this.config.uploadToken !== '';
  }

  matches(headers: IncomingHttpHeaders): boolean {
    if (!this.enabled) return false;
    const token = headers['x-upload-token'];
    if (typeof token === 'string' && token) return this.same(token);
    const auth = headers.authorization ?? '';
    if (auth.toLowerCase().startsWith('basic ')) {
      const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      return this.same(colon < 0 ? '' : decoded.slice(colon + 1));
    }
    return false;
  }

  /** Constant-time comparison; hashing first makes the lengths equal. */
  private same(given: string): boolean {
    return timingSafeEqual(digest(given), digest(this.config.uploadToken));
  }
}
