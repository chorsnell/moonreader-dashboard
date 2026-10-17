/**
 * The picture a shared link shows: a grid of book covers, 1200 x 630 (the size Facebook,
 * Slack, Discord, iMessage and X all crop to), as a JPEG.
 */
import { decode, encode } from 'jpeg-js';
import { imageExt, readPng } from '../covers/png';

export const COLLAGE_WIDTH = 1200;
export const COLLAGE_HEIGHT = 630;
const GAP = 10;
/** The page's dark background, so the gaps and margins read as a shelf. */
const BACKGROUND: RGB = [0x17, 0x16, 0x15];
/** Book covers are about 2:3. */
const COVER_RATIO = 2 / 3;

type RGB = [number, number, number];

interface Picture {
  width: number;
  height: number;
  /** [r, g, b] with any transparency laid over the background. */
  rgb: (x: number, y: number) => RGB;
}

/** A cover as pixels, or null when it isn't a JPEG or PNG we can read. */
function picture(data: Buffer): Picture | null {
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
        rgb: (x, y) => {
          const i = (y * img.width + x) * 4;
          return [d[i], d[i + 1], d[i + 2]];
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
      rgb: (x, y) => {
        const [r, g, b, a] = img.pixel(x, y);
        const k = a / 255;
        return [
          Math.round(r * k + BACKGROUND[0] * (1 - k)),
          Math.round(g * k + BACKGROUND[1] * (1 - k)),
          Math.round(b * k + BACKGROUND[2] * (1 - k)),
        ];
      },
    };
  }
  return null;
}

/** How many rows of covers, and at most how many in each, for this many covers. */
export function layout(n: number): { rows: number; perRow: number; w: number; h: number } {
  const rows = n >= 24 ? 3 : n >= 3 ? 2 : 1;
  const h = Math.floor((COLLAGE_HEIGHT - (rows + 1) * GAP) / rows);
  const w = Math.floor(h * COVER_RATIO);
  const fit = Math.floor((COLLAGE_WIDTH - GAP) / (w + GAP));
  return { rows, perRow: Math.min(fit, Math.ceil(n / rows)), w, h };
}

/**
 * Lays the covers out in rows, in the order given, each centred, scaled to fill its slot
 * (cropping a cover that isn't 2:3). Covers that can't be read are skipped; null when none
 * can. Uses as many as fit: up to 24.
 */
export function collage(covers: Buffer[]): Buffer | null {
  const pictures: Picture[] = [];
  for (const c of covers) {
    const p = picture(c);
    if (p && p.width > 0 && p.height > 0) pictures.push(p);
    if (pictures.length >= 24) break;
  }
  if (!pictures.length) return null;
  const { rows, perRow, w, h } = layout(pictures.length);
  const shown = pictures.slice(0, rows * perRow);
  const used = Math.ceil(shown.length / perRow);

  const out = Buffer.alloc(COLLAGE_WIDTH * COLLAGE_HEIGHT * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = BACKGROUND[0];
    out[i + 1] = BACKGROUND[1];
    out[i + 2] = BACKGROUND[2];
    out[i + 3] = 255;
  }
  const top = Math.floor((COLLAGE_HEIGHT - used * h - (used - 1) * GAP) / 2);
  for (let row = 0; row < used; row++) {
    const inRow = shown.slice(row * perRow, (row + 1) * perRow);
    const left = Math.floor((COLLAGE_WIDTH - inRow.length * w - (inRow.length - 1) * GAP) / 2);
    inRow.forEach((p, col) => draw(out, p, left + col * (w + GAP), top + row * (h + GAP), w, h));
  }
  return encode({ width: COLLAGE_WIDTH, height: COLLAGE_HEIGHT, data: out }, 85).data;
}

/** Draws a picture into a w x h slot, filling it, each pixel the average of the ones it covers. */
function draw(out: Buffer, p: Picture, x0: number, y0: number, w: number, h: number): void {
  const scale = Math.max(w / p.width, h / p.height);
  const cropX = (p.width - w / scale) / 2;
  const cropY = (p.height - h / scale) / 2;
  const span = 1 / scale; // source pixels per output pixel
  const taps = Math.min(4, Math.max(1, Math.ceil(span)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let ty = 0; ty < taps; ty++) {
        const sy = Math.min(p.height - 1, Math.floor(cropY + (y + (ty + 0.5) / taps) * span));
        for (let tx = 0; tx < taps; tx++) {
          const sx = Math.min(p.width - 1, Math.floor(cropX + (x + (tx + 0.5) / taps) * span));
          const px = p.rgb(sx, sy);
          r += px[0];
          g += px[1];
          b += px[2];
        }
      }
      const n = taps * taps;
      const i = ((y0 + y) * COLLAGE_WIDTH + x0 + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
    }
  }
}
