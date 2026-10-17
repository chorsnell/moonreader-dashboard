import { setTimeout as sleep } from 'node:timers/promises';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { UploadTokenService } from './upload-token.service';

/** Slows down guessing the token. */
const WRONG_TOKEN_DELAY_MS = 1000;

/** For the dashboard's own upload: the token comes as X-Upload-Token. Errors are JSON. */
@Injectable()
export class UploadTokenGuard implements CanActivate {
  constructor(private readonly tokens: UploadTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.tokens.enabled) {
      throw new NotFoundException({ error: 'Uploads are turned off on this server.' });
    }
    const req = context.switchToHttp().getRequest<Request>();
    if (!this.tokens.matches(req.headers)) {
      await sleep(WRONG_TOKEN_DELAY_MS);
      throw new ForbiddenException({ error: 'Wrong upload token.' });
    }
    return true;
  }
}
