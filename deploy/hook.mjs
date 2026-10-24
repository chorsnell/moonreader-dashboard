/**
 * Deploy hook: GitHub Actions calls this after it pushes a new image, and it pulls that
 * image and restarts the dashboard. Nothing polls; the server only acts when told.
 *
 *   POST /deploy   body: {"sha": "...", "ts": <unix seconds>}
 *                  header: X-Signature: sha256=<hex HMAC-SHA256 of the body with DEPLOY_SECRET>
 *   GET  /healthz
 *
 * A request is refused unless the signature matches and ts is within five minutes of now,
 * so a captured request cannot be replayed later. Deploys run one at a time; a request that
 * arrives during one queues a single follow-up run.
 *
 * Environment:
 *   DEPLOY_SECRET    the shared secret (the same value as the DEPLOY_SECRET Actions secret)
 *   DEPLOY_DIR       the folder holding docker-compose.yml (mounted at the same path as on the host)
 *   DEPLOY_SERVICE   the compose service to update (default: moonreader-dashboard)
 *   PORT             default 9000
 */
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const SECRET = process.env.DEPLOY_SECRET || '';
const DIR = process.env.DEPLOY_DIR || '';
const SERVICE = process.env.DEPLOY_SERVICE || 'moonreader-dashboard';
const PORT = Number(process.env.PORT || 9000);
const MAX_SKEW_SECONDS = 300;
const MAX_BODY = 4096;

if (SECRET.length < 16 || !DIR) {
  console.error('DEPLOY_SECRET (16+ characters) and DEPLOY_DIR must be set');
  process.exit(1);
}

const log = (...args) => console.log(new Date().toISOString(), ...args);

function signatureOk(body, header) {
  const expected = Buffer.from('sha256=' + createHmac('sha256', SECRET).update(body).digest('hex'));
  const given = Buffer.from(String(header || ''));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', '--project-directory', DIR, ...args], {
      cwd: DIR,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`docker compose ${args.join(' ')} exited ${code}`))));
  });
}

let running = false;
let again = false;

async function deploy(sha) {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      log(`deploying ${sha || '(no sha)'}`);
      await run(['pull', SERVICE]);
      await run(['up', '-d', '--no-build', SERVICE]);
      log('deployed');
    } while (again);
  } catch (err) {
    log('deploy failed:', err.message);
  } finally {
    running = false;
  }
}

createServer((req, res) => {
  const reply = (status, text) => {
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end(text + '\n');
  };

  if (req.method === 'GET' && req.url === '/healthz') return reply(200, 'ok');
  if (req.method !== 'POST' || req.url !== '/deploy') return reply(404, 'not found');

  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      reply(413, 'too large');
      req.destroy();
    } else chunks.push(chunk);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks);
    if (!signatureOk(body, req.headers['x-signature'])) {
      log('refused: bad signature');
      return reply(401, 'bad signature');
    }
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return reply(400, 'bad json');
    }
    if (!Number.isFinite(payload.ts) || Math.abs(Date.now() / 1000 - payload.ts) > MAX_SKEW_SECONDS) {
      log('refused: stale timestamp');
      return reply(401, 'stale');
    }
    reply(202, 'deploying');
    void deploy(typeof payload.sha === 'string' ? payload.sha.slice(0, 40) : '');
  });
}).listen(PORT, () => log(`deploy hook listening on :${PORT}, updating ${SERVICE} in ${DIR}`));
