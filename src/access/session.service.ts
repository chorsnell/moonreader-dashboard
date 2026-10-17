import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { AccessSettingsService } from './access-settings.service';

export type Role = 'admin' | 'reader';

/** How long a sign-in lasts. */
const SESSION_DAYS: Record<Role, number> = { admin: 30, reader: 365 };

const isRole = (s: string): s is Role => s === 'admin' || s === 'reader';

/**
 * Sign-ins are stateless cookies: "<role>.<expiry>.<signature>". The signature covers a hash
 * of the secret the role signed in with, so changing the admin token or the read password
 * signs out everyone who used the old one. The cookie format and key file are the same as
 * the Python server's, so sign-ins survive the switch.
 */
@Injectable()
export class SessionService implements OnModuleInit {
  private key: Buffer;
  private readonly keyFile: string;

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly settings: AccessSettingsService,
  ) {
    this.keyFile = join(config.library, '.session-key');
  }

  /** A random key kept in the library, so sign-ins survive restarts. */
  async onModuleInit(): Promise<void> {
    const existing = await readFile(this.keyFile).catch(() => Buffer.alloc(0));
    if (existing.length >= 32) {
      this.key = existing;
      return;
    }
    this.key = randomBytes(32);
    await mkdir(dirname(this.keyFile), { recursive: true });
    await writeFile(this.keyFile, this.key);
    await chmod(this.keyFile, 0o600).catch(() => undefined);
  }

  /** A new session cookie value, and how long it lasts in seconds. */
  async create(role: Role): Promise<{ value: string; maxAge: number }> {
    const maxAge = SESSION_DAYS[role] * 86_400;
    const message = `${role}.${Math.floor(Date.now() / 1000) + maxAge}`;
    return { value: `${message}.${this.sign(message, await this.stamp(role))}`, maxAge };
  }

  /** The role a cookie value signs in as, or null if it's forged, expired or out of date. */
  async verify(value: string): Promise<Role | null> {
    const parts = value.split('.');
    if (parts.length !== 3) return null;
    const [role, exp, sig] = parts;
    if (!isRole(role) || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return null;
    const stamp = await this.stamp(role);
    if (!stamp) return null;
    const good = Buffer.from(this.sign(`${role}.${exp}`, stamp));
    const given = Buffer.from(sig);
    return given.length === good.length && timingSafeEqual(given, good) ? role : null;
  }

  private sign(message: string, stamp: string): string {
    return createHmac('sha256', this.key).update(`${message}.${stamp}`).digest('hex');
  }

  /** A hash of the role's current secret; '' when the role can't sign in at all. */
  private async stamp(role: Role): Promise<string> {
    const secret =
      role === 'admin' ? this.config.uploadToken : (await this.settings.load()).read_password;
    return secret ? createHash('sha256').update(secret).digest('hex') : '';
  }
}
