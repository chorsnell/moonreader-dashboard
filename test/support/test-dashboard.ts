import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { appConfig, loadAppConfig, type AppConfig } from '../../src/config/app.config';

export const TOKEN = 'test-token';
export const DAV_AUTH = `Basic ${Buffer.from(`moon:${TOKEN}`).toString('base64')}`;

/** The real app, against a temporary library, set up exactly as main.ts does. */
export class TestDashboard {
  private constructor(
    readonly app: NestExpressApplication,
    readonly lib: string,
  ) {}

  static async start(overrides: Partial<AppConfig> = {}): Promise<TestDashboard> {
    const lib = await mkdtemp(join(tmpdir(), 'dashboard-'));
    const config: AppConfig = {
      ...loadAppConfig({}),
      library: lib,
      uploadToken: TOKEN,
      pollSeconds: 5,
      coverLookup: false,
      metadataLookup: false,
      weatherLookup: false,
      ...overrides,
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(appConfig.KEY)
      .useValue(config)
      .compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    return new TestDashboard(app, lib);
  }

  get server(): Server {
    return this.app.getHttpServer() as Server;
  }

  /**
   * A request sent exactly as written. HTTP client libraries tidy paths like /dav/../x
   * before sending them, which would hide what the server does with them.
   */
  raw(method: string, path: string, body?: Buffer, headers: Record<string, string> = {}) {
    const { port } = this.server.address() as AddressInfo;
    return new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  path(...parts: string[]): string {
    return join(this.lib, ...parts);
  }

  async json<T = unknown>(...parts: string[]): Promise<T> {
    return JSON.parse(await readFile(this.path(...parts), 'utf8')) as T;
  }

  async stop(): Promise<void> {
    await this.app.close();
    await rm(this.lib, { recursive: true, force: true });
  }
}

/** Polls until `predicate` holds, or gives up after `timeoutMs`. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await predicate()) return true;
    } catch {
      // not there yet
    }
    await sleep(200);
  }
  return false;
}

export const fileExists = (path: string) => () => existsSync(path);
