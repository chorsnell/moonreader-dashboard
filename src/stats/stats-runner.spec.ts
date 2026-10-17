import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { WEB_DIR } from '../paths';
import { MAX_CRASHES, StatsRunner } from './stats-runner';
import type { StatsJob } from './stats-job';

jest.setTimeout(30_000);

let tmp: string;
let job: StatsJob;
const runners: StatsRunner[] = [];

/** A worker script (plain JS) that does `body` with each message. */
async function script(name: string, body: string): Promise<string> {
  const file = join(tmp, `${name}.js`);
  await writeFile(
    file,
    `const { parentPort } = require('node:worker_threads');
     parentPort.on('message', (msg) => { ${body} });`,
  );
  return file;
}

function runner(options: ConstructorParameters<typeof StatsRunner>[0]): StatsRunner {
  const r = new StatsRunner(options);
  runners.push(r);
  return r;
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'stats-runner-'));
  const web = join(tmp, 'web');
  await mkdir(join(web, 'vendor'), { recursive: true });
  await mkdir(join(tmp, 'data'));
  await copyFile(join(WEB_DIR, 'vendor', 'd3.min.js'), join(web, 'vendor', 'd3.min.js'));
  await writeFile(
    join(web, 'index.html'),
    '<script src="vendor/d3.min.js"></script><script src="calcs.js"></script>',
  );
  await writeFile(
    join(web, 'calcs.js'),
    `dash.calc('count', { inputs: ['books'], fn: (b) => [{ n: b.length }] });`,
  );
  await writeFile(join(tmp, 'data', 'books.json'), JSON.stringify([{ id: 'a' }, { id: 'b' }]));
  job = { webDir: web, dataDir: join(tmp, 'data'), ctx: null, version: 'v1', generated: null };
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(runners.splice(0).map((r) => r.close()));
});

afterAll(async () => {
  jest.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

describe('the stats runner', () => {
  it('works stats out in the worker thread', async () => {
    const r = runner({ worker: true });
    const out = await r.run(job);
    expect(r.usingWorker).toBe(true);
    expect(JSON.parse(out.rows.count)).toEqual([{ n: 2 }]);
    expect(JSON.parse(Buffer.from(out.bundles.all.json).toString())).toEqual({
      version: 'v1',
      generated: null,
      calcs: { count: [{ n: 2 }] },
    });
    expect((await r.describe(job.webDir)).files.map((f) => f.id)).toEqual([
      'books',
      'reads',
      'daily',
    ]);
  });

  it('works them out on the main thread when the worker is off', async () => {
    const r = runner({ worker: false });
    expect(r.usingWorker).toBe(false);
    expect(JSON.parse((await r.run(job)).rows.count)).toEqual([{ n: 2 }]);
  });

  it('falls back to the main thread when the worker crashes, then stops using it', async () => {
    const r = runner({ worker: true, script: await script('crash', 'process.exit(3);') });
    for (let i = 0; i < MAX_CRASHES; i++) {
      expect(r.usingWorker).toBe(true);
      // the job still gets its answer, worked out here instead
      expect(JSON.parse((await r.run(job)).rows.count)).toEqual([{ n: 2 }]);
    }
    expect(r.usingWorker).toBe(false);
    expect(JSON.parse((await r.run(job)).rows.count)).toEqual([{ n: 2 }]);
  });

  it('passes on an error from a job, without dropping the worker', async () => {
    const body = `parentPort.postMessage({ id: msg.id, ok: false, error: 'no such file' });`;
    const r = runner({ worker: true, script: await script('fails', body) });
    await expect(r.run(job)).rejects.toThrow('no such file');
    await expect(r.run(job)).rejects.toThrow('no such file');
    expect(r.usingWorker).toBe(true);
  });

  it('stops a worker that takes too long, and fails the job cleanly', async () => {
    const r = runner({ worker: true, timeoutMs: 300, script: await script('hangs', '') });
    await expect(r.run(job)).rejects.toThrow(/longer than/);
    expect(r.usingWorker).toBe(true); // a fresh one for the next job
  });

  it('works out what was in the worker on the main thread when closed', async () => {
    const r = runner({ worker: true, script: await script('slow', '') });
    const pending = r.run(job);
    await r.close();
    expect(JSON.parse((await pending).rows.count)).toEqual([{ n: 2 }]);
    expect(r.usingWorker).toBe(false);
  });
});
