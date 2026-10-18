/**
 * Runs stats jobs in a worker thread (stats-worker.ts), or on the main thread when the worker
 * is off (STATS_WORKER=off) or keeps failing. A big library's calcs take a while; in the
 * worker they don't hold up other requests, and the page's scripts are loaded there exactly
 * as on the main thread (loadPageCalcs), so new feature scripts are picked up the same way.
 *
 * If the worker dies (a crash, out of memory), the jobs it had are worked out on the main
 * thread instead and it is started again for the next one; after a few crashes it stays off.
 * A job that runs too long stops the worker and fails, rather than tying up the main thread.
 */
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Logger } from '@nestjs/common';
import {
  describePage,
  runStatsJob,
  type PageInfo,
  type StatsJob,
  type StatsJobResult,
} from './stats-job';
import type { WorkerReply, WorkerRequest } from './stats-worker';

/** After this many crashes the worker stays off and jobs run on the main thread. */
export const MAX_CRASHES = 3;

export interface StatsRunnerOptions {
  /** Use a worker thread (default true). */
  worker?: boolean;
  /** How long one job may take in the worker before it's stopped, in ms. */
  timeoutMs?: number;
  /** The worker's script (tests point it at one that misbehaves). */
  script?: string;
}

/** The worker stopped while it had the job: it can be worked out on the main thread instead. */
class WorkerGone extends Error {}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * The worker's script. When running from the TypeScript sources (the tests) the worker gets
 * a small loader that compiles them as it goes, as ts-jest does for the main thread.
 */
function workerSource(script: string): { source: string | URL; eval: boolean } {
  if (extname(script) !== '.ts') return { source: script, eval: false };
  const ts = createRequire(script).resolve('typescript');
  const boot = `
    const { registerHooks } = require('node:module');
    const { readFileSync } = require('node:fs');
    const { fileURLToPath } = require('node:url');
    const ts = require(${JSON.stringify(ts)});
    registerHooks({
      resolve(spec, ctx, next) {
        try { return next(spec, ctx); } catch (e) {
          if (/^\\.\\.?\\//.test(spec)) return next(spec + '.ts', ctx);
          throw e;
        }
      },
      load(url, ctx, next) {
        if (!url.endsWith('.ts') || url.includes('/node_modules/')) return next(url, ctx);
        const file = fileURLToPath(url);
        const out = ts.transpileModule(readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
        });
        return { format: 'commonjs', source: out.outputText, shortCircuit: true };
      },
    });
    require(${JSON.stringify(script)});
  `;
  return { source: boot, eval: true };
}

export class StatsRunner {
  private readonly log = new Logger('StatsWorker');
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private crashes = 0;
  private enabled: boolean;
  private closed = false;
  private readonly timeoutMs: number;
  private readonly script: string;

  constructor(options: StatsRunnerOptions = {}) {
    this.enabled = options.worker ?? true;
    this.timeoutMs = options.timeoutMs ?? 10 * 60_000;
    this.script = options.script ?? join(__dirname, `stats-worker${extname(__filename)}`);
  }

  /** Whether jobs go to the worker thread (false: the main thread). */
  get usingWorker(): boolean {
    return this.enabled && !this.closed;
  }

  run(job: StatsJob): Promise<StatsJobResult> {
    return this.send({ kind: 'run', arg: job }, () => runStatsJob(job)) as Promise<StatsJobResult>;
  }

  describe(webDir: string): Promise<PageInfo> {
    return this.send({ kind: 'describe', arg: webDir }, () =>
      describePage(webDir),
    ) as Promise<PageInfo>;
  }

  /** Stops the worker; anything still to work out is done on the main thread. */
  async close(): Promise<void> {
    this.closed = true;
    const w = this.worker;
    this.worker = null;
    this.failAll(new WorkerGone('the stats worker was stopped'));
    if (w) await w.terminate();
  }

  private async send(
    msg: Omit<WorkerRequest, 'id'>,
    inline: () => Promise<unknown>,
  ): Promise<unknown> {
    if (!this.usingWorker) return inline();
    try {
      return await this.post(msg);
    } catch (e) {
      if (!(e instanceof WorkerGone)) throw e;
      if (!this.closed) this.log.warn(`${e.message}; working the stats out on the main thread`);
      return inline();
    }
  }

  private post(msg: Omit<WorkerRequest, 'id'>): Promise<unknown> {
    const worker = this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // stuck (or a calc that never ends): stop it rather than wait for ever
        this.pending.delete(id);
        reject(new Error(`the stats took longer than ${Math.round(this.timeoutMs / 1000)} s`));
        this.crashed(worker, 'the stats worker took too long and was stopped');
        void worker.terminate();
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      worker.ref(); // keep the process alive while it has work
      worker.postMessage({ ...msg, id } as WorkerRequest);
    });
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const { source, eval: isEval } = workerSource(this.script);
    const worker = new Worker(source, { eval: isEval, stdout: false, stderr: false });
    worker.unref();
    worker.on('message', (m: WorkerReply) => {
      if ('ready' in m) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
      if (!this.pending.size) worker.unref(); // idle: don't keep the process alive
    });
    worker.on('error', (e) => this.crashed(worker, `the stats worker failed: ${e.message}`));
    worker.on('exit', (code) => this.crashed(worker, `the stats worker stopped (exit ${code})`));
    this.worker = worker;
    return worker;
  }

  /** The worker died (or was stopped for taking too long): its jobs go back to the caller. */
  private crashed(worker: Worker, why: string): void {
    if (this.worker !== worker) return; // already handled, or replaced
    this.worker = null;
    this.failAll(new WorkerGone(why));
    if (this.closed) return;
    this.crashes++;
    if (this.crashes >= MAX_CRASHES) {
      this.enabled = false;
      this.log.error(`${why}; ${this.crashes} times now, so the stats run on the main thread`);
    } else {
      this.log.warn(why);
    }
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }
}
