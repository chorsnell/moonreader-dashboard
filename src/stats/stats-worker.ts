/**
 * The stats worker thread: works out stats jobs (stats-job.ts) off the main thread, so a big
 * library's calcs don't hold up other requests. It answers {id, ok, result | error} to each
 * {id, kind, arg} it is sent, and says {ready: true} once it's loaded.
 */
import { parentPort } from 'node:worker_threads';
import { describePage, runStatsJob, type StatsJob } from './stats-job';

export type WorkerRequest =
  { id: number; kind: 'run'; arg: StatsJob } | { id: number; kind: 'describe'; arg: string };

export type WorkerReply =
  | { ready: true }
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

if (parentPort) {
  const port = parentPort;
  port.on('message', (msg: WorkerRequest) => {
    const work = msg.kind === 'run' ? runStatsJob(msg.arg) : describePage(msg.arg);
    work.then(
      (result) => port.postMessage({ id: msg.id, ok: true, result } satisfies WorkerReply),
      (e: unknown) =>
        port.postMessage({
          id: msg.id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies WorkerReply),
    );
  });
  port.postMessage({ ready: true } satisfies WorkerReply);
}
