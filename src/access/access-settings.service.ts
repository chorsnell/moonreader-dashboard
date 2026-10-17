import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { toPrivacySettings, type PrivacySettings } from '../privacy/privacy';

export type Access = 'public' | 'password';

/** library/settings.json: who can see the dashboard. The admin changes it from the page. */
export interface AccessSettings {
  access: Access;
  /** A pbkdf2 hash of the read password, or ''. */
  read_password: string;
  /** What visitors who aren't the admin may see. */
  privacy: PrivacySettings;
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
  private saving: Promise<unknown> = Promise.resolve();

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
    return { access, read_password: readPassword, privacy: toPrivacySettings(raw.privacy) };
  }

  /** Saves one at a time, through a .part file, keeping the file's other sections. */
  save(settings: AccessSettings): Promise<void> {
    return this.write((raw) => ({ ...raw, ...settings }));
  }

  /** Another feature's own section of settings.json (e.g. "arr"), or undefined. */
  async section(name: string): Promise<unknown> {
    return (await this.raw())[name];
  }

  /** Replaces (or, with undefined, removes) one section of settings.json. */
  saveSection(name: string, value: unknown): Promise<void> {
    return this.write((raw) => {
      const next = { ...raw };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  }

  private async raw(): Promise<Record<string, unknown>> {
    try {
      const o = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private write(change: (raw: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
    const run = this.saving.then(async () => {
      const next = change(await this.raw());
      await writeFile(`${this.file}.part`, JSON.stringify(next, null, 2), 'utf8');
      await rename(`${this.file}.part`, this.file);
    });
    this.saving = run.catch(() => undefined);
    return run;
  }
}
