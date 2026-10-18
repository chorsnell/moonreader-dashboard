import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Received {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

/**
 * Stands in for ntfy, Gotify, Discord and webhook receivers: records every POST and
 * answers 200 (or `status`, to play a broken one).
 */
export class FakeHooks {
  readonly received: Received[] = [];
  status = 200;
  private server!: Server;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        } catch {
          // not JSON
        }
        this.received.push({ path: req.url ?? '/', headers: req.headers, body });
        res.writeHead(this.status, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** What arrived at a path (e.g. "/message" for Gotify). */
  at(path: string): Received[] {
    return this.received.filter((r) => r.path === path);
  }

  clear(): void {
    this.received.length = 0;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }
}
