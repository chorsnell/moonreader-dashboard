import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ActivityLogService } from '../library/activity-log.service';
import { DavPositionLog, REPEAT_QUIET_MS } from './dav-position-log';

const CACHE = '/dav/Apps/Books/.Moon+/Cache';
const PO = `${CACHE}/Dune.epub.po`;
const LINE = '1700000000000*5@0#1200:40.0%';

let root: string;
let lines: string[];
let log: DavPositionLog;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'davlog-'));
  lines = [];
  log = new DavPositionLog({
    log: (line: string) => lines.push(line),
  } as unknown as ActivityLogService);
  await mkdir(dirname(file(PO)), { recursive: true });
  await writeFile(file(PO), `${LINE}\n`);
});
afterEach(() => {
  jest.useRealTimers();
  return rm(root, { recursive: true, force: true });
});

const file = (path: string) => join(root, path);

/** One request: `act` is what handling it does, `status` how it ends. */
async function request(
  method: string,
  path: string,
  status: number,
  headers: Record<string, string> = {},
  act: () => Promise<unknown> = async () => undefined,
) {
  const res = Object.assign(new EventEmitter(), { statusCode: 200, getHeader: () => undefined });
  const req = {
    method,
    headers: { 'user-agent': 'MoonReader', authorization: 'Basic c2VjcmV0', ...headers },
  } as unknown as IncomingMessage;
  const done = await log.watch(req, res as unknown as ServerResponse, path, file(path));
  await act();
  await done();
  res.statusCode = status;
  res.emit('close');
}

it('logs a download with its line, the agent and a 304', async () => {
  await request('GET', PO, 304, { 'if-none-match': '"1c-abc"', cookie: 'admin=secret' });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(
    `WebDAV GET ${PO} -> 304 (not modified: the client keeps its copy) | "${LINE}" | ` +
      'agent "MoonReader"',
  );
  expect(lines[0]).toContain('if-none-match "1c-abc"');
  expect(lines[0]).not.toMatch(/c2VjcmV0|secret|authorization|cookie/i);
});

it('logs what an upload left in the file, or what stayed when refused', async () => {
  await request('PUT', PO, 204, {}, () => writeFile(file(PO), 'new line'));
  await request('PUT', PO, 412, { 'if-match': '"old"' });
  expect(lines[0]).toContain(`WebDAV PUT ${PO} -> 204 | "new line"`);
  expect(lines[1]).toContain('-> 412 (precondition failed) | kept "new line"');
});

it('logs HEAD, a single-file PROPFIND, a missing file and a move onto a .po', async () => {
  await request('HEAD', PO, 200);
  await request('PROPFIND', PO, 207);
  await request('GET', `${CACHE}/Nope.po`, 404);
  await request('MOVE', `${CACHE}/upload.tmp`, 204, {
    destination: `https://user:pass@host${encodeURI(PO)}`,
  });
  expect(lines.map((l) => l.split(' | ')[0])).toEqual([
    `WebDAV HEAD ${PO} -> 200`,
    `WebDAV PROPFIND ${PO} -> 207`,
    `WebDAV GET ${CACHE}/Nope.po -> 404`,
    `WebDAV MOVE ${CACHE}/upload.tmp to ${PO} -> 204`,
  ]);
  expect(lines[2]).toContain('(no file)');
  expect(lines[3]).not.toContain('pass');
});

it("logs one short line for a listing of Moon+'s folder, and nothing for other things", async () => {
  await request('PROPFIND', `${CACHE}/`, 207, { depth: '1' });
  await request('PROPFIND', `${CACHE}/`, 207, { depth: '1' });
  await request('PROPFIND', '/dav/Apps', 207);
  await request('GET', '/dav/backup.mrpro', 200);
  await request('LOCK', PO, 200);
  expect(lines).toEqual([
    `WebDAV PROPFIND folder ${CACHE}/ depth 1 -> 207, 1 .po files | agent "MoonReader"`,
  ]);
});

it('counts identical reads rather than repeating them, but never uploads', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  for (let i = 0; i < 4; i++) await request('GET', PO, 200);
  expect(lines).toHaveLength(1);
  jest.setSystemTime(Date.now() + REPEAT_QUIET_MS + 1);
  await request('GET', PO, 200);
  expect(lines[1]).toContain('(and 3 more like it before)');
  await request('PUT', PO, 204);
  await request('PUT', PO, 204);
  expect(lines).toHaveLength(4);
});
