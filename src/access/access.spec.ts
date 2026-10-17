import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppConfig, type AppConfig } from '../config/app.config';
import { AccessSettingsService, checkPassword, hashPassword } from './access-settings.service';
import { SessionService } from './session.service';

// made by the Python server, so installs that already have a read password or a signed-in
// browser keep working after the switch
const PYTHON_HASH =
  'pbkdf2_sha256$1000$00112233445566778899aabbccddeeff$d0fb3c5776dfa1c2b59d42ed8723437b37a64d86ef230a38c139357dcfe2afbd';
const PYTHON_ADMIN_SESSION =
  'admin.4102444800.0a0b238c0a6c43ddfc6948066d241602c7f1c12392efbbd2f572eecc404a2605';

describe('read passwords', () => {
  it('checks hashes the Python server made', () => {
    expect(checkPassword('friends', PYTHON_HASH)).toBe(true);
    expect(checkPassword('enemies', PYTHON_HASH)).toBe(false);
    expect(checkPassword('friends', 'not a hash')).toBe(false);
  });

  it('salts every hash', () => {
    const a = hashPassword('friends', undefined, 1000);
    expect(a).not.toBe(hashPassword('friends', undefined, 1000));
    expect(checkPassword('friends', a)).toBe(true);
  });
});

describe('SessionService', () => {
  let lib: string;
  let sessions: SessionService;

  beforeEach(async () => {
    lib = await mkdtemp(join(tmpdir(), 'sessions-'));
    await writeFile(
      join(lib, '.session-key'),
      Buffer.from(Array.from({ length: 32 }, (_, i) => i)),
    );
    const config: AppConfig = { ...loadAppConfig({}), library: lib, uploadToken: 'test-token' };
    sessions = new SessionService(config, new AccessSettingsService(config));
    await sessions.onModuleInit();
  });

  afterEach(() => rm(lib, { recursive: true, force: true }));

  it('accepts a session the Python server signed', async () => {
    expect(await sessions.verify(PYTHON_ADMIN_SESSION)).toBe('admin');
  });

  it('refuses forged, tampered and reader sessions without a read password', async () => {
    expect(await sessions.verify('admin.9999999999.forged')).toBeNull();
    expect(await sessions.verify(PYTHON_ADMIN_SESSION.replace('admin', 'reader'))).toBeNull();
    const { value } = await sessions.create('admin');
    expect(await sessions.verify(value)).toBe('admin');
    expect(await sessions.verify(`${value}0`)).toBeNull();
  });
});
