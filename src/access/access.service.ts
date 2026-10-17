import type { IncomingMessage } from 'node:http';
import { Injectable } from '@nestjs/common';
import { AccessSettingsService } from './access-settings.service';
import { SessionService, type Role } from './session.service';
import { UploadTokenService } from './upload-token.service';

export const SESSION_COOKIE = 'mrd_session';

export function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Who is asking. The admin proves it with UPLOAD_TOKEN (upload scripts, WebDAV) or the admin
 * sign-in cookie; a reader with the read-password sign-in cookie.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly tokens: UploadTokenService,
    private readonly sessions: SessionService,
    private readonly settings: AccessSettingsService,
  ) {}

  /** The role from the sign-in cookie alone. */
  async sessionRole(req: IncomingMessage): Promise<Role | null> {
    const value = cookie(req, SESSION_COOKIE);
    return value ? this.sessions.verify(value) : null;
  }

  async isAdmin(req: IncomingMessage): Promise<boolean> {
    return this.tokens.matches(req.headers) || (await this.sessionRole(req)) === 'admin';
  }

  /** 'admin' with the token or the admin cookie, else the cookie's role. */
  async role(req: IncomingMessage): Promise<Role | null> {
    return this.tokens.matches(req.headers) ? 'admin' : this.sessionRole(req);
  }

  async canRead(req: IncomingMessage): Promise<boolean> {
    return (await this.settings.load()).access === 'public' || (await this.role(req)) !== null;
  }
}
