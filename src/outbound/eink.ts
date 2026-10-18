/**
 * The e-ink view (BOO-73): an 800 x 480, one-bit picture of the "now" summary for an
 * always-on display on a shelf (TRMNL, an Inkplate, a Kindle in kiosk mode): the book
 * you're reading with its cover, the streak, this week's minutes, the year against the
 * goal and the quote of the day.
 */
import { Bitmap, grayImage } from './bitmap';
import type { NowSummary } from './now';

export const EINK_WIDTH = 800;
export const EINK_HEIGHT = 480;

const M = 28; // margin
const COVER_W = 176;
const COVER_H = 264;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** "Sat 18 Oct" */
function shortDate(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** The figures in the row of three: a label, a big value, a line under it. */
export function einkStats(now: NowSummary): { label: string; value: string; sub: string }[] {
  const out: { label: string; value: string; sub: string }[] = [];
  if (now.streak) {
    const s = now.streak;
    out.push({
      label: 'STREAK',
      value: plural(s.current, 'day'),
      sub: s.read_today ? 'read today' : s.at_risk ? 'not yet today' : `best ${s.best}`,
    });
  }
  if (now.week_minutes !== null) {
    const m = now.week_minutes;
    out.push({
      label: 'THIS WEEK',
      value: m >= 120 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`,
      sub: now.today_minutes !== null ? `${now.today_minutes} min today` : 'since Monday',
    });
  }
  const y = now.year;
  out.push({
    label: String(y.year),
    value: y.goal ? `${y.finished} / ${y.goal}` : plural(y.finished, 'book'),
    sub:
      y.ahead === null
        ? 'finished'
        : y.ahead >= 0.5
          ? `${plural(Math.round(y.ahead), 'book')} ahead`
          : y.ahead <= -0.5
            ? `${plural(Math.round(-y.ahead), 'book')} behind`
            : 'on pace',
  });
  return out;
}

/** Draws the view; `cover` is the first book's cover file (JPEG or PNG), or null. */
export function einkPicture(now: NowSummary, cover: Buffer | null): Bitmap {
  const bm = new Bitmap(EINK_WIDTH, EINK_HEIGHT);
  const book = now.reading?.[0] ?? null;

  // ---------- the book ----------
  const img = cover ? grayImage(cover) : null;
  const tx = img ? M + COVER_W + 28 : M;
  const tw = EINK_WIDTH - tx - M;
  if (img) {
    bm.dither(img, M, M, COVER_W, COVER_H);
    bm.rect(M - 1, M - 1, COVER_W + 2, COVER_H + 2, 2);
  }
  let y = M + 4;
  bm.text(now.reading === null ? 'READING' : 'READING NOW', tx, y, 2);
  bm.text(shortDate(now.today), EINK_WIDTH - M - Bitmap.textWidth(shortDate(now.today), 2), y, 2);
  y += 30;
  if (!book) {
    bm.text(now.reading === null ? 'Not shared' : 'Nothing on the go', tx, y + 10, 4);
    y += 60;
  } else {
    for (const line of Bitmap.wrap(book.title, 5, tw, 2)) {
      bm.text(line, tx, y, 5, true);
      y += 44;
    }
    if (book.author) {
      bm.text(Bitmap.wrap(book.author, 3, tw, 1)[0] ?? '', tx, y + 2, 3);
      y += 34;
    }
    if (book.progress !== null) {
      y += 12;
      const pct = `${Math.round(book.progress)}%`;
      const pw = Bitmap.textWidth(pct, 3);
      const bw = tw - pw - 16;
      bm.rect(tx, y, bw, 18, 2);
      bm.fill(tx, y, Math.round((bw * Math.max(0, Math.min(100, book.progress))) / 100), 18);
      bm.text(pct, tx + bw + 16, y - 1, 3);
      y += 18;
    }
  }

  // ---------- the figures ----------
  const stats = einkStats(now);
  const top = Math.max(y + 24, img ? M + COVER_H - 74 : 0);
  const x0 = tx;
  const cw = Math.floor(tw / stats.length);
  stats.forEach((s, i) => {
    const x = x0 + i * cw;
    if (i > 0) bm.fill(x - 12, top, 2, 70);
    bm.text(s.label, x, top, 2);
    bm.text(Bitmap.wrap(s.value, 4, cw - 20, 1)[0] ?? '', x, top + 22, 4, true);
    bm.text(Bitmap.wrap(s.sub, 2, cw - 20, 1)[0] ?? '', x, top + 56, 2);
  });

  // ---------- the quote ----------
  const qTop = Math.max(top + 92, M + COVER_H + 24);
  bm.fill(M, qTop, EINK_WIDTH - 2 * M, 2);
  if (now.quote) {
    // the quote's lines, then its source: 20 px a line
    const lines = Math.max(1, Math.floor((EINK_HEIGHT - M - qTop - 16 - 24) / 20));
    let qy = qTop + 16;
    for (const line of Bitmap.wrap(`"${now.quote.text}"`, 2, EINK_WIDTH - 2 * M, lines)) {
      bm.text(line, M, qy, 2);
      qy += 20;
    }
    const src = `- ${now.quote.title}${now.quote.author ? `, ${now.quote.author}` : ''}`;
    const s = Bitmap.wrap(src, 2, EINK_WIDTH - 2 * M, 1)[0] ?? '';
    bm.text(s, EINK_WIDTH - M - Bitmap.textWidth(s, 2), qy + 4, 2);
  } else {
    const line = now.as_of ? `Reading log up to ${shortDate(now.as_of)}` : 'No reading yet';
    bm.text(line, M, qTop + 16, 2);
  }
  return bm;
}

/** A cover on its own, dithered to one bit at w x h (for TRMNL's markup). */
export function einkCover(cover: Buffer, w = 240, h = 360): Bitmap | null {
  const img = grayImage(cover);
  if (!img) return null;
  const bm = new Bitmap(w, h);
  bm.dither(img, 0, 0, w, h);
  return bm;
}
