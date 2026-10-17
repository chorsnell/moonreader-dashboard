import { setTimeout as sleep } from 'node:timers/promises';
import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessService } from './access.service';
import { UploadTokenService } from './upload-token.service';

/** Slows down guessing passwords. */
export const WRONG_PASSWORD_DELAY_MS = 1000;

export interface AdminOnlyOptions {
  /** The error when someone else asks. */
  denied: string;
  /** When set, a 404 with this error while UPLOAD_TOKEN isn't set (the feature is off). */
  off?: string;
  /** Wait a second before refusing, to slow down guessing. */
  slow?: boolean;
}

const ADMIN_ONLY = 'adminOnly';

/** Only the admin may call this route. Errors are JSON with an `error` the page shows. */
export const AdminOnly = (options: AdminOnlyOptions) =>
  applyDecorators(SetMetadata(ADMIN_ONLY, options), UseGuards(AdminGuard));

/** The admin proves it with UPLOAD_TOKEN (as X-Upload-Token, for scripts) or the admin sign-in cookie. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: UploadTokenService,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<AdminOnlyOptions | undefined>(ADMIN_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? { denied: 'Only the admin can do this.' };
    if (options.off && !this.tokens.enabled) {
      throw new NotFoundException({ error: options.off });
    }
    const req = context.switchToHttp().getRequest<Request>();
    if (!(await this.access.isAdmin(req))) {
      if (options.slow) await sleep(WRONG_PASSWORD_DELAY_MS);
      throw new ForbiddenException({ error: options.denied });
    }
    return true;
  }
}
