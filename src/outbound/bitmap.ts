/**
 * A one-bit picture for e-ink displays (BOO-73): drawing (rectangles, text in a built-in
 * 5x7 pixel font, dithered images) and a hand-written 1-bit PNG encoder, so no canvas or
 * image library is needed.
 */
import { crc32, deflateSync } from 'node:zlib';
import { decode } from 'jpeg-js';
import { imageExt, readPng } from '../covers/png';

/**
 * The classic 5x7 font (printable ASCII, 0x20 to 0x7e): 5 columns per character, bit 0 the
 * top row. Characters are drawn proportionally: empty columns at the sides are skipped.
 */
// prettier-ignore
const FONT = [
  0x00,0x00,0x00,0x00,0x00, 0x00,0x00,0x5f,0x00,0x00, 0x00,0x07,0x00,0x07,0x00, 0x14,0x7f,0x14,0x7f,0x14,
  0x24,0x2a,0x7f,0x2a,0x12, 0x23,0x13,0x08,0x64,0x62, 0x36,0x49,0x55,0x22,0x50, 0x00,0x05,0x03,0x00,0x00,
  0x00,0x1c,0x22,0x41,0x00, 0x00,0x41,0x22,0x1c,0x00, 0x08,0x2a,0x1c,0x2a,0x08, 0x08,0x08,0x3e,0x08,0x08,
  0x00,0x50,0x30,0x00,0x00, 0x08,0x08,0x08,0x08,0x08, 0x00,0x60,0x60,0x00,0x00, 0x20,0x10,0x08,0x04,0x02,
  0x3e,0x51,0x49,0x45,0x3e, 0x00,0x42,0x7f,0x40,0x00, 0x42,0x61,0x51,0x49,0x46, 0x21,0x41,0x45,0x4b,0x31,
  0x18,0x14,0x12,0x7f,0x10, 0x27,0x45,0x45,0x45,0x39, 0x3c,0x4a,0x49,0x49,0x30, 0x01,0x71,0x09,0x05,0x03,
  0x36,0x49,0x49,0x49,0x36, 0x06,0x49,0x49,0x29,0x1e, 0x00,0x36,0x36,0x00,0x00, 0x00,0x56,0x36,0x00,0x00,
  0x08,0x14,0x22,0x41,0x00, 0x14,0x14,0x14,0x14,0x14, 0x00,0x41,0x22,0x14,0x08, 0x02,0x01,0x51,0x09,0x06,
  0x32,0x49,0x79,0x41,0x3e, 0x7e,0x11,0x11,0x11,0x7e, 0x7f,0x49,0x49,0x49,0x36, 0x3e,0x41,0x41,0x41,0x22,
  0x7f,0x41,0x41,0x22,0x1c, 0x7f,0x49,0x49,0x49,0x41, 0x7f,0x09,0x09,0x01,0x01, 0x3e,0x41,0x41,0x51,0x32,
  0x7f,0x08,0x08,0x08,0x7f, 0x00,0x41,0x7f,0x41,0x00, 0x20,0x40,0x41,0x3f,0x01, 0x7f,0x08,0x14,0x22,0x41,
  0x7f,0x40,0x40,0x40,0x40, 0x7f,0x02,0x04,0x02,0x7f, 0x7f,0x04,0x08,0x10,0x7f, 0x3e,0x41,0x41,0x41,0x3e,
  0x7f,0x09,0x09,0x09,0x06, 0x3e,0x41,0x51,0x21,0x5e, 0x7f,0x09,0x19,0x29,0x46, 0x46,0x49,0x49,0x49,0x31,
  0x01,0x01,0x7f,0x01,0x01, 0x3f,0x40,0x40,0x40,0x3f, 0x1f,0x20,0x40,0x20,0x1f, 0x7f,0x20,0x18,0x20,0x7f,
  0x63,0x14,0x08,0x14,0x63, 0x03,0x04,0x78,0x04,0x03, 0x61,0x51,0x49,0x45,0x43, 0x00,0x7f,0x41,0x41,0x00,
  0x02,0x04,0x08,0x10,0x20, 0x00,0x41,0x41,0x7f,0x00, 0x04,0x02,0x01,0x02,0x04, 0x40,0x40,0x40,0x40,0x40,
  0x00,0x01,0x02,0x04,0x00, 0x20,0x54,0x54,0x54,0x78, 0x7f,0x48,0x44,0x44,0x38, 0x38,0x44,0x44,0x44,0x20,
  0x38,0x44,0x44,0x48,0x7f, 0x38,0x54,0x54,0x54,0x18, 0x08,0x7e,0x09,0x01,0x02, 0x0c,0x52,0x52,0x52,0x3e,
  0x7f,0x08,0x04,0x04,0x78, 0x00,0x44,0x7d,0x40,0x00, 0x20,0x40,0x44,0x3d,0x00, 0x7f,0x10,0x28,0x44,0x00,
  0x00,0x41,0x7f,0x40,0x00, 0x7c,0x04,0x18,0x04,0x78, 0x7c,0x08,0x04,0x04,0x78, 0x38,0x44,0x44,0x44,0x38,
  0x7c,0x14,0x14,0x14,0x08, 0x08,0x14,0x14,0x18,0x7c, 0x7c,0x08,0x04,0x04,0x08, 0x48,0x54,0x54,0x54,0x20,
  0x04,0x3f,0x44,0x40,0x20, 0x3c,0x40,0x40,0x20,0x7c, 0x1c,0x20,0x40,0x20,0x1c, 0x3c,0x40,0x30,0x40,0x3c,
  0x44,0x28,0x10,0x28,0x44, 0x0c,0x50,0x50,0x50,0x3c, 0x44,0x64,0x54,0x4c,0x44, 0x00,0x08,0x36,0x41,0x00,
  0x00,0x00,0x7f,0x00,0x00, 0x00,0x41,0x36,0x08,0x00, 0x02,0x01,0x02,0x04,0x02,
];

const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '«': '"',
  '»': '"',
  '–': '-',
  '—': '-',
  '−': '-',
  '…': '...',
  ' ': ' ',
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  '·': '-',
};

/** Text as the font can draw it: accents dropped, typographic quotes and dashes made plain. */
export function toAscii(s: string): string {
  return [...s.normalize('NFKD').replace(/[̀-ͯ]/g, '')]
    .map((c) => FOLD[c] ?? (c >= ' ' && c <= '~' ? c : c === '\n' ? ' ' : c.trim() ? '?' : ' '))
    .join('');
}

/** A glyph's columns, without empty ones at the sides (a space stays 3 wide). */
function glyph(c: string): number[] {
  const code = c.charCodeAt(0);
  if (code < 0x20 || code > 0x7e) return glyph('?');
  const cols = FONT.slice((code - 0x20) * 5, (code - 0x20) * 5 + 5);
  if (c === ' ') return [0, 0, 0];
  let a = 0;
  let b = 4;
  while (a < b && cols[a] === 0) a++;
  while (b > a && cols[b] === 0) b--;
  return cols.slice(a, b + 1);
}

export class Bitmap {
  /** 1 is black, one byte per pixel while drawing. */
  readonly px: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.px = new Uint8Array(width * height);
  }

  set(x: number, y: number, black = true): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.px[y * this.width + x] = black ? 1 : 0;
  }

  get(x: number, y: number): boolean {
    return this.px[y * this.width + x] === 1;
  }

  fill(x: number, y: number, w: number, h: number, black = true): void {
    for (let j = Math.max(0, y); j < Math.min(this.height, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(this.width, x + w); i++) this.set(i, j, black);
    }
  }

  /** A rectangle's outline, `t` pixels thick. */
  rect(x: number, y: number, w: number, h: number, t = 1): void {
    this.fill(x, y, w, t);
    this.fill(x, y + h - t, w, t);
    this.fill(x, y, t, h);
    this.fill(x + w - t, y, t, h);
  }

  /** Width of text at a scale (each font pixel is scale x scale). */
  static textWidth(s: string, scale: number): number {
    const chars = [...toAscii(s)];
    if (!chars.length) return 0;
    return chars.reduce((a, c) => a + (glyph(c).length + 1) * scale, 0) - scale;
  }

  /** Draws text with its top left at (x, y), 7 x scale pixels tall; returns its width. */
  text(s: string, x: number, y: number, scale: number, bold = false): number {
    let cx = x;
    for (const c of toAscii(s)) {
      const cols = glyph(c);
      cols.forEach((col, i) => {
        for (let row = 0; row < 8; row++) {
          if (col & (1 << row)) {
            this.fill(cx + i * scale, y + row * scale, scale + (bold ? 1 : 0), scale);
          }
        }
      });
      cx += (cols.length + 1) * scale;
    }
    return cx - x - scale;
  }

  /**
   * Breaks text into at most `lines` lines no wider than `max`, the last one cut with "...".
   */
  static wrap(s: string, scale: number, max: number, lines: number): string[] {
    const words = toAscii(s).split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = line ? `${line} ${w}` : w;
      if (Bitmap.textWidth(next, scale) <= max) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = w;
      if (out.length === lines) break;
    }
    if (line && out.length < lines) out.push(line);
    const used = out.join(' ').split(/\s+/).filter(Boolean).length;
    const last = out.length - 1;
    if (last >= 0 && (used < words.length || Bitmap.textWidth(out[last], scale) > max)) {
      let l = out[last];
      while (l.length > 1 && Bitmap.textWidth(`${l}...`, scale) > max) l = l.slice(0, -1);
      out[last] = `${l.trimEnd()}...`;
    }
    return out;
  }

  /**
   * Draws a picture scaled to fill w x h (cropping the overflow), in black and white with
   * Floyd-Steinberg dithering. `gray(x, y)` gives 0 (black) to 255 (white).
   */
  dither(
    src: { width: number; height: number; gray: (x: number, y: number) => number },
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const s = Math.max(w / src.width, h / src.height);
    const ox = (src.width * s - w) / 2;
    const oy = (src.height * s - h) / 2;
    const g = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        // the average of the source pixels under this one
        const x0 = Math.floor((i + ox) / s);
        const y0 = Math.floor((j + oy) / s);
        const x1 = Math.max(x0 + 1, Math.min(src.width, Math.floor((i + 1 + ox) / s)));
        const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((j + 1 + oy) / s)));
        let sum = 0;
        let n = 0;
        for (let v = y0; v < y1; v++) {
          for (let u = x0; u < x1; u++) {
            sum += src.gray(Math.min(u, src.width - 1), Math.min(v, src.height - 1));
            n++;
          }
        }
        g[j * w + i] = sum / n;
      }
    }
    // stretch the contrast: e-ink has only two tones, and covers are often muddy
    let lo = 255;
    let hi = 0;
    for (const v of g) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const k = hi - lo > 16 ? 255 / (hi - lo) : 1;
    for (let i = 0; i < g.length; i++) g[i] = (g[i] - lo) * k;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const old = g[j * w + i];
        const v = old < 128 ? 0 : 255;
        this.set(x + i, y + j, v === 0);
        const e = old - v;
        if (i + 1 < w) g[j * w + i + 1] += (e * 7) / 16;
        if (j + 1 < h) {
          if (i > 0) g[(j + 1) * w + i - 1] += (e * 3) / 16;
          g[(j + 1) * w + i] += (e * 5) / 16;
          if (i + 1 < w) g[(j + 1) * w + i + 1] += (e * 1) / 16;
        }
      }
    }
  }

  /** A 1-bit grayscale PNG (black 0, white 1). */
  png(): Buffer {
    const stride = Math.ceil(this.width / 8);
    const raw = Buffer.alloc((stride + 1) * this.height, 0);
    for (let y = 0; y < this.height; y++) {
      const row = y * (stride + 1);
      raw[row] = 0; // filter: none
      for (let x = 0; x < this.width; x++) {
        if (!this.get(x, y)) raw[row + 1 + (x >> 3)] |= 0x80 >> (x & 7);
      }
      // padding bits at the end of a row are white too
      for (let x = this.width; x < stride * 8; x++) raw[row + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 1; // bit depth
    ihdr[9] = 0; // grayscale
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

/** A JPEG or PNG cover as grayscale pixels (transparency over white), or null. */
export function grayImage(
  data: Buffer,
): { width: number; height: number; gray: (x: number, y: number) => number } | null {
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  const ext = imageExt(data);
  if (ext === 'jpg') {
    try {
      const img = decode(data, {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: true,
        maxResolutionInMP: 40,
        maxMemoryUsageInMB: 256,
      });
      const d = img.data;
      return {
        width: img.width,
        height: img.height,
        gray: (x, y) => {
          const i = (y * img.width + x) * 4;
          return lum(d[i], d[i + 1], d[i + 2]);
        },
      };
    } catch {
      return null;
    }
  }
  if (ext === 'png') {
    const img = readPng(data);
    if (!img) return null;
    return {
      width: img.width,
      height: img.height,
      gray: (x, y) => {
        const [r, g, b, a] = img.pixel(x, y);
        const k = a / 255;
        return lum(r, g, b) * k + 255 * (1 - k);
      },
    };
  }
  return null;
}
