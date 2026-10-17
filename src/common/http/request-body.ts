import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { once } from 'node:events';

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB

export type RequestBodyProblem = 'missing-length' | 'too-large' | 'bad-content' | 'cut-short';

const MESSAGES: Record<RequestBodyProblem, string> = {
  'missing-length': 'Missing Content-Length.',
  'too-large': 'Upload too large.',
  'bad-content': 'The file is not what was expected.',
  'cut-short': 'Upload was cut short.',
};

export class RequestBodyError extends Error {
  constructor(readonly problem: RequestBodyProblem) {
    super(MESSAGES[problem]);
  }
}

export interface SaveBodyOptions {
  maxBytes?: number;
  /** Checks the first chunk, e.g. for a file signature. Returning false refuses the upload. */
  accept?: (firstChunk: Buffer) => boolean;
}

/**
 * Streams a request body into `dest`, through `dest.part` so a half-written file is never
 * seen. Throws a RequestBodyError when the body is refused or incomplete. After a refusal
 * the rest of the body is drained, so the connection can still carry the error response.
 */
export async function saveRequestBody(
  req: IncomingMessage,
  dest: string,
  { maxBytes = MAX_UPLOAD_BYTES, accept }: SaveBodyOptions = {},
): Promise<void> {
  const length = req.headers['content-length'];
  const chunked = (req.headers['transfer-encoding'] ?? '').toLowerCase().includes('chunked');
  if (length === undefined && !chunked) throw drained(req, 'missing-length');
  if (length !== undefined && Number(length) > maxBytes) throw drained(req, 'too-large');

  const tmp = `${dest}.part`;
  const out = createWriteStream(tmp);
  let total = 0;
  let first = true;
  try {
    // destroyOnReturn: false keeps the socket open when we stop reading early
    for await (const chunk of req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
      if (first && accept && !accept(chunk)) throw drained(req, 'bad-content');
      first = false;
      total += chunk.length;
      if (total > maxBytes) throw drained(req, 'too-large');
      if (!out.write(chunk)) await once(out, 'drain');
    }
    if (length !== undefined && total < Number(length)) throw new RequestBodyError('cut-short');
    out.end();
    await once(out, 'finish');
    await rename(tmp, dest);
  } catch (e) {
    out.destroy();
    await rm(tmp, { force: true });
    throw e instanceof RequestBodyError ? e : new RequestBodyError('cut-short');
  }
}

/** Reads a whole (smallish) request body into memory, or throws a RequestBodyError. */
export async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const length = req.headers['content-length'];
  if (length !== undefined && Number(length) > maxBytes) throw drained(req, 'too-large');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) throw drained(req, 'too-large');
    chunks.push(chunk);
  }
  if (length !== undefined && total < Number(length)) throw new RequestBodyError('cut-short');
  return Buffer.concat(chunks);
}

function drained(req: IncomingMessage, problem: RequestBodyProblem): RequestBodyError {
  req.resume();
  return new RequestBodyError(problem);
}
