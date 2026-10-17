import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AccessService } from './access.service';

/**
 * Reading data: anyone when the dashboard is public, otherwise only people signed in (with
 * the read password or as the admin). The page itself is always served, to show the
 * password box.
 */
@Injectable()
export class ReaderGuard implements CanActivate {
  constructor(private readonly access: AccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!(await this.access.canRead(req))) {
      throw new UnauthorizedException({ error: 'Sign in to see this dashboard.' });
    }
    return true;
  }
}
