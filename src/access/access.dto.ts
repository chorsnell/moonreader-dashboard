import { BadRequestException } from '@nestjs/common';
import type { Access } from './access-settings.service';

/**
 * The JSON bodies of the sign-in endpoints. Bodies are only parsed when sent as
 * application/json (see app.setup.ts), so another site can't post them from a visitor's
 * browser without a CORS preflight, which is refused. Anything else arrives as {}.
 */
export interface LoginDto {
  password: string;
}

export interface ChangeAccessDto {
  access: Access;
  /** A new read password, or '' to keep the current one. */
  password: string;
}

const asObject = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

const asString = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

export function toLoginDto(body: unknown): LoginDto {
  return { password: asString(asObject(body).password) };
}

export function toChangeAccessDto(body: unknown): ChangeAccessDto {
  const b = asObject(body);
  if (b.access !== 'public' && b.access !== 'password') {
    throw new BadRequestException({ error: 'Choose public or password.' });
  }
  return { access: b.access, password: asString(b.password) };
}
