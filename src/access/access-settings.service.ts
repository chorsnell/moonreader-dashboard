import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';

export type Access = 'public' | 'password';

/** library/settings.json: who can see the dashboard. The admin changes it from the page. */
export interface AccessSettings {
  access: Access;
  /** A pbkdf2 hash of the read password, or ''. */
  read_password: string;
}

const ROUNDS = 200_000;

/** pbkdf2_sha256$<rounds>$<salt>$<hex>, the same format the Python server wrote. */
export function hashPassword(
  password: string,
  salt = randomBytes(16).toString('hex'),
  rounds = ROUNDS,
): string {
  const hash = pbkdf2Sync(password, salt, rounds, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${rounds}$${salt}$${hash}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  const rounds = Number(parts[1]);
  if (parts.length !== 4 || !Number.isInteger(rounds) || rounds <= 0) return false;
  const again = Buffer.from(hashPassword(password, parts[2], rounds));
  const want = Buffer.from(stored);
  return again.length === want.length && timingSafeEqual(again, want);
}

@Injectable()
export class AccessSettingsService {
  private readonly file: string;
  private saving = Promise.resolve();

  constructor(@Inject(appConfig.KEY) config: AppConfigType) {
    this.file = join(config.library, 'settings.json');
  }

  /** Read on every request, so a hand edit takes effect straight away. */
  async load(): Promise<AccessSettings> {
    let raw: Partial<AccessSettings> = {};
    try {
      raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<AccessSettings>;
    } catch {
      // no settings yet: public
    }
    const readPassword = typeof raw.read_password === 'string' ? raw.read_password : '';
    let access: Access = raw.access === 'password' ? 'password' : 'public';
    if (access === 'password' && !readPassword) access = 'public'; // nothing anyone typed would open it
    return { access, read_password: readPassword };
  }

  /** Saves one at a time, through a .part file. */
  save(settings: AccessSettings): Promise<void> {
    this.saving = this.saving.then(async () => {
      await writeFile(`${this.file}.part`, JSON.stringify(settings, null, 2), 'utf8');
      await rename(`${this.file}.part`, this.file);
    });
    return this.saving;
  }
}
