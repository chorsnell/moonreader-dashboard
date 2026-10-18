/**
 * Embeddable SVG badges and cards (BOO-75): "currently reading", "books this year" and a
 * mini heatmap, to drop into a blog, a README or a forum signature. Pure functions of the
 * public's "now" summary and data files: they never show what the public may not see.
 *
 * Self-contained SVG (no external fonts, images or scripts), because GitHub's image proxy
 * and most forums serve SVG as an image: anything linked from it wouldn't load.
 */
import type { NowSummary } from './now';

export type Theme = 'light' | 'dark';

interface Palette {
  bg: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  track: string;
  empty: string;
  label: string;
}

/** The page's own colours (web/index.html), light and dark. */
export const PALETTES: Record<Theme, Palette> = {
  light: {
    bg: '#ffffff',
    border: '#e4e1da',
    fg: '#1f1e1c',
    muted: '#6b6862',
    accent: '#2a78d6',
    track: '#ece9e2',
    empty: '#ece9e2',
    label: '#555350',
  },
  dark: {
    bg: '#211f1d',
    border: '#34312d',
    fg: '#ecebe8',
    muted: '#a29e96',
    accent: '#3987e5',
    track: '#34312d',
    empty: '#2d2a27',
    label: '#4a4641',
  },
};

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const DAY_MS = 86_400_000;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Rough width of text in a sans-serif at `size` px (no font metrics in SVG served as an image). */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const c of s) {
    if (/[ilj.,:;'|!]/.test(c)) w += 0.3;
    else if (/[mwMW@]/.test(c)) w += 0.85;
    else if (/[A-Z0-9#%&]/.test(c)) w += 0.66;
    else if (c === ' ') w += 0.3;
    else w += 0.55;
  }
  return w * size;
}

/** Cuts text to fit `max` px at `size`, with an ellipsis. */
export function fit(s: string, size: number, max: number): string {
  if (textWidth(s, size) <= max) return s;
  let out = s;
  while (out.length > 1 && textWidth(`${out}…`, size) > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

function frame(w: number, h: number, p: Palette, title: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(title)}">` +
    `<title>${escapeXml(title)}</title>` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="${p.bg}" stroke="${p.border}"/>` +
    `<g font-family="${FONT}">${body}</g></svg>`
  );
}

export interface ReadingCardInput {
  now: NowSummary;
  /** The first book's cover as a data: URI, or null. */
  cover: string | null;
  theme: Theme;
  /** The card's heading. */
  heading?: string;
}

/** "Currently reading": cover, title, author and progress, up to three books. */
export function readingCard({ now, cover, theme, heading }: ReadingCardInput): string {
  const p = PALETTES[theme];
  const W = 420;
  const head = heading?.trim() || 'Currently reading';
  const books = (now.reading ?? []).slice(0, 3);
  let body = `<text x="20" y="30" font-size="13" fill="${p.muted}">${escapeXml(fit(head, 13, W - 40))}</text>`;
  if (now.reading === null || !books.length) {
    const msg = now.reading === null ? 'Not shared' : 'Nothing on the go';
    body += `<text x="20" y="62" font-size="16" fill="${p.fg}">${msg}</text>`;
    return frame(W, 84, p, `${head}: ${msg}`, body);
  }
  const [first, ...rest] = books;
  const coverW = 64;
  const coverH = 96;
  const tx = cover ? 20 + coverW + 16 : 20;
  const tw = W - tx - 20;
  if (cover) {
    body +=
      `<clipPath id="c"><rect x="20" y="44" width="${coverW}" height="${coverH}" rx="4"/></clipPath>` +
      `<rect x="20" y="44" width="${coverW}" height="${coverH}" rx="4" fill="${p.track}"/>` +
      `<image href="${cover}" x="20" y="44" width="${coverW}" height="${coverH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>`;
  }
  body += `<text x="${tx}" y="64" font-size="17" font-weight="600" fill="${p.fg}">${escapeXml(fit(first.title, 17, tw))}</text>`;
  if (first.author) {
    body += `<text x="${tx}" y="86" font-size="13" fill="${p.muted}">${escapeXml(fit(first.author, 13, tw))}</text>`;
  }
  const bar = (y: number, x: number, w: number, pct: number | null) => {
    if (pct === null) return '';
    const v = Math.max(0, Math.min(100, pct));
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="6" rx="3" fill="${p.track}"/>` +
      (v > 0
        ? `<rect x="${x}" y="${y}" width="${Math.max(6, (w * v) / 100).toFixed(1)}" height="6" rx="3" fill="${p.accent}"/>`
        : '')
    );
  };
  const pctText = (v: number | null) => (v === null ? '' : `${Math.round(v)}%`);
  body += bar(106, tx, tw - 44, first.progress);
  body += `<text x="${W - 20}" y="112" font-size="12" text-anchor="end" fill="${p.muted}">${pctText(first.progress)}</text>`;
  let y = Math.max(cover ? 44 + coverH : 120, 120) + 22;
  for (const b of rest) {
    body += `<text x="20" y="${y}" font-size="13" fill="${p.fg}">${escapeXml(fit(b.title, 13, W - 170))}</text>`;
    body += bar(y - 6, W - 140, 76, b.progress);
    body += `<text x="${W - 20}" y="${y}" font-size="12" text-anchor="end" fill="${p.muted}">${pctText(b.progress)}</text>`;
    y += 24;
  }
  const H = y - 4;
  const label = `${head}: ${books.map((b) => b.title).join('; ')}`;
  return frame(W, H, p, label, body);
}

export interface YearInput {
  now: NowSummary;
  /** Hours read this year, or null when not shared. */
  hours: number | null;
  theme: Theme;
  style: 'badge' | 'card';
  heading?: string;
}

/** "Books this year": a shields-style badge, or a small card with the goal and hours. */
export function yearBadge({ now, hours, theme, style, heading }: YearInput): string {
  const p = PALETTES[theme];
  const { year, finished, goal } = now.year;
  const value = goal ? `${finished} / ${goal}` : String(finished);
  const head = heading?.trim() || `Books in ${year}`;
  if (style === 'badge') {
    const lw = Math.round(textWidth(head, 11) + 16);
    const vw = Math.round(textWidth(value, 11) + 16);
    const W = lw + vw;
    const title = `${head}: ${value}`;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20" viewBox="0 0 ${W} 20" role="img" aria-label="${escapeXml(title)}">` +
      `<title>${escapeXml(title)}</title>` +
      `<clipPath id="r"><rect width="${W}" height="20" rx="3"/></clipPath>` +
      `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="${p.label}"/><rect x="${lw}" width="${vw}" height="20" fill="${p.accent}"/></g>` +
      `<g fill="#fff" font-family="${FONT}" font-size="11" text-anchor="middle">` +
      `<text x="${lw / 2}" y="14">${escapeXml(head)}</text><text x="${lw + vw / 2}" y="14" font-weight="600">${escapeXml(value)}</text></g></svg>`
    );
  }
  const W = 300;
  let body = `<text x="20" y="30" font-size="13" fill="${p.muted}">${escapeXml(fit(head, 13, W - 40))}</text>`;
  body += `<text x="20" y="66" font-size="30" font-weight="600" fill="${p.fg}">${finished}</text>`;
  const nx = 20 + textWidth(String(finished), 30) + 10;
  const sub = goal
    ? `of ${goal} ${goal === 1 ? 'book' : 'books'}`
    : finished === 1
      ? 'book'
      : 'books';
  body += `<text x="${nx}" y="66" font-size="14" fill="${p.muted}">${escapeXml(sub)}</text>`;
  let H = 86;
  if (goal) {
    const v = Math.min(1, finished / goal);
    body += `<rect x="20" y="80" width="${W - 40}" height="6" rx="3" fill="${p.track}"/>`;
    if (v > 0) {
      body += `<rect x="20" y="80" width="${Math.max(6, (W - 40) * v).toFixed(1)}" height="6" rx="3" fill="${p.accent}"/>`;
    }
    const pace =
      now.year.ahead === null
        ? ''
        : now.year.ahead >= 0.5
          ? `${plural(Math.round(now.year.ahead), 'book')} ahead of pace`
          : now.year.ahead <= -0.5
            ? `${plural(Math.round(-now.year.ahead), 'book')} behind pace`
            : 'on pace';
    if (pace) body += `<text x="20" y="106" font-size="12" fill="${p.muted}">${pace}</text>`;
    H = pace ? 120 : 102;
  }
  if (hours !== null) {
    body += `<text x="${W - 20}" y="66" font-size="13" text-anchor="end" fill="${p.muted}">${plural(Math.round(hours), 'hour')}</text>`;
  }
  return frame(
    W,
    H,
    p,
    `${head}: ${value}${hours !== null ? `, ${Math.round(hours)} hours` : ''}`,
    body,
  );
}

export interface HeatmapInput {
  /** Daily rows as the public gets them: {date, minutes}. Dates may be weeks or months. */
  daily: unknown;
  /** The last day to show (YYYY-MM-DD). */
  end: string;
  /** How the public's dates are rounded. */
  dates: 'day' | 'week' | 'month';
  weeks: number;
  theme: Theme;
  heading?: string;
}

/** Minutes per day for the last `weeks` weeks, GitHub-style; or per week when only weeks are shared. */
export function heatmap({ daily, end, dates, weeks, theme, heading }: HeatmapInput): string | null {
  if (dates === 'month') return null;
  const p = PALETTES[theme];
  const rows = Array.isArray(daily) ? (daily as Record<string, unknown>[]) : [];
  const mins = new Map<string, number>();
  for (const r of rows) {
    const d = typeof r.date === 'string' ? r.date.slice(0, 10) : '';
    const m = typeof r.minutes === 'number' && Number.isFinite(r.minutes) ? r.minutes : 0;
    if (d) mins.set(d, (mins.get(d) ?? 0) + m);
  }
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(e)) return null;
  const monday = e - ((new Date(e).getUTCDay() + 6) % 7) * DAY_MS;
  const first = monday - (weeks - 1) * 7 * DAY_MS;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const cell = 11;
  const gap = 2;
  const step = cell + gap;
  const left = 20;
  const top = 44;
  const perDay = dates === 'day';
  const cells: { t: number; v: number }[] = [];
  for (let w = 0; w < weeks; w++) {
    const wk = first + w * 7 * DAY_MS;
    if (perDay) {
      for (let d = 0; d < 7; d++) {
        const t = wk + d * DAY_MS;
        if (t <= e) cells.push({ t, v: mins.get(iso(t)) ?? 0 });
      }
    } else {
      cells.push({ t: wk, v: mins.get(iso(wk)) ?? 0 });
    }
  }
  const values = cells
    .map((c) => c.v)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const max = values.length
    ? values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]
    : 1;
  const opacity = (v: number) => Math.min(1, 0.18 + 0.82 * Math.sqrt(Math.min(v, max) / max));
  const W = left * 2 + weeks * step - gap;
  const gridH = perDay ? 7 * step - gap : cell * 2;
  const H = top + gridH + 34;
  const total = cells.reduce((a, c) => a + c.v, 0);
  const days = cells.filter((c) => c.v > 0).length;
  const head = heading?.trim() || 'Reading';
  const summary = perDay
    ? `${plural(days, 'day')} · ${plural(Math.round(total / 60), 'hour')} in ${weeks} weeks`
    : `${plural(days, 'week')} with reading · ${plural(Math.round(total / 60), 'hour')}`;
  let body = `<text x="${left}" y="30" font-size="13" fill="${p.muted}">${escapeXml(fit(head, 13, W / 2))}</text>`;
  for (const c of cells) {
    const w = Math.floor((c.t - first) / (7 * DAY_MS));
    const d = perDay ? Math.round((c.t - (first + w * 7 * DAY_MS)) / DAY_MS) : 0;
    const x = left + w * step;
    const y = top + d * step;
    const h = perDay ? cell : gridH;
    body +=
      c.v > 0
        ? `<rect x="${x}" y="${y}" width="${cell}" height="${h}" rx="2" fill="${p.accent}" fill-opacity="${opacity(c.v).toFixed(2)}"/>`
        : `<rect x="${x}" y="${y}" width="${cell}" height="${h}" rx="2" fill="${p.empty}"/>`;
  }
  body += `<text x="${left}" y="${top + gridH + 22}" font-size="12" fill="${p.muted}">${escapeXml(summary)}</text>`;
  return frame(W, H, p, `${head}: ${summary}`, body);
}
