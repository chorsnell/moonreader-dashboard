/**
 * Regenerates the README screenshots in docs/screenshots/ from the demo build.
 *
 *   npm run screenshots                 # build the demo into ./site, then take every shot
 *   npm run screenshots -- --no-build   # reuse the demo already in ./site
 *
 * Every tab (found on the page, so tabs added by feature scripts are picked up), a book,
 * author and year page and Wrapped, in light and dark at desktop width, plus a couple at
 * phone width. Motion is turned off (reduced motion) and the clock is fixed, so the same
 * DEMO_TODAY gives the same pictures.
 *
 * Environment:
 *   DEMO_TODAY=YYYY-MM-DD      the demo's "today" (default: the real today)
 *   COVER_LOOKUP=off           skip the Open Library cover lookup (no network needed)
 *   SCREENSHOT_SITE=dir        where the demo is built (default: site)
 *   PLAYWRIGHT_CHROMIUM_PATH   a Chromium to use instead of Playwright's own download
 *
 * Any console or page error fails the run.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const SITE = resolve(ROOT, process.env.SCREENSHOT_SITE || 'site');
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const TODAY =
  process.env.DEMO_TODAY || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const TZ = 'UTC'; // the demo build and the browser agree on the day

// desktop shots are cropped to these heights, like the hand-taken ones were
const DESKTOP = { width: 1280, height: 1100 };
const HEIGHTS = { overview: 1180, speed: 1300, checks: 800 };
const PHONE = { width: 390, height: 844 };

if (!process.argv.includes('--no-build')) {
  console.log(`Building the demo into ${SITE} for ${TODAY}…`);
  const r = spawnSync('npm', ['run', 'demo', '--', SITE], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, DEMO_TODAY: TODAY, TZ },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// the demo is a static site: serve it as GitHub Pages would
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(SITE, p);
  if (!file.startsWith(SITE)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/json' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// detail pages: a book, its author and the last full year
const books = JSON.parse(await readFile(join(SITE, 'data', 'books.json'), 'utf8'));
const list = Array.isArray(books) ? books : (books.books ?? Object.values(books));
const book = list.find((b) => b.title === 'Pride and Prejudice') ?? list[0];
const lastYear = Number(TODAY.slice(0, 4)) - 1;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const errors = [];

async function open(scheme, size, scale, hash) {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: scale,
    colorScheme: scheme,
    reducedMotion: 'reduce',
    timezoneId: TZ,
    locale: 'en-GB',
    isMobile: scale > 1,
    hasTouch: scale > 1,
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00Z`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${hash}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${hash}: ${e.message}`));
  await page.goto(BASE + (hash ? `#${hash}` : ''), { waitUntil: 'networkidle' });
  await settle(page);
  return page;
}

// wait until every card has drawn, the fonts and images are in and nothing is moving
async function settle(page) {
  await page.waitForFunction(
    () => ![...document.querySelectorAll('.dash-skeleton')].some((e) => e.checkVisibility()),
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  // lazy covers below the fold never load in a headless page, so load them all now
  await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach((i) => (i.loading = 'eager')));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.waitForTimeout(600);
}

async function shoot(page, name, scheme) {
  const file = join(OUT, `${name}${scheme === 'dark' ? '-dark' : ''}.png`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log('  ' + file.slice(ROOT.length + 1));
}

await mkdir(OUT, { recursive: true });
const probe = await open('light', DESKTOP, 1, '');
const tabs = await probe.$$eval('[role="tab"][data-tab]', (els) => els.map((e) => e.dataset.tab));
await probe.context().close();

const desktop = [
  ...tabs.map((t) => ({ name: t, hash: t })),
  { name: 'book', hash: `book/${encodeURIComponent(book.id)}` },
  { name: 'author', hash: `author/${encodeURIComponent(book.author)}` },
  { name: 'year', hash: `year/${lastYear}` },
  { name: 'wrapped', hash: `year/${lastYear}`, wrapped: true },
];
const phone = [
  { name: 'mobile', hash: '' },
  { name: 'mobile-book', hash: `book/${encodeURIComponent(book.id)}` },
];

for (const scheme of ['light', 'dark']) {
  console.log(`${scheme}:`);
  for (const s of desktop) {
    const size = { ...DESKTOP, height: HEIGHTS[s.name] ?? DESKTOP.height };
    const page = await open(scheme, size, 1, s.hash);
    if (s.wrapped) {
      await page.click('.wr-play');
      await page.waitForSelector('dialog[open]');
      await settle(page);
    }
    await shoot(page, s.name, scheme);
    await page.context().close();
  }
  for (const s of phone) {
    const page = await open(scheme, PHONE, 2, s.hash);
    await shoot(page, s.name, scheme);
    await page.context().close();
  }
}

await browser.close();
server.close();
if (errors.length) {
  console.error(`\n${errors.length} page error(s):\n` + errors.join('\n'));
  process.exit(1);
}
