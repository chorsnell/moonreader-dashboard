import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** Covers from the backup are scaled down to this width (sharp at the large size). */
export const COVER_WIDTH = 240;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ImageExt = 'jpg' | 'png';

export function imageExt(data: Buffer): ImageExt | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.subarray(0, 8).equals(SIGNATURE)) return 'png';
  return null;
}

/** Bytes per pixel for the 8-bit colour types we can read. */
const BYTES_PER_PIXEL: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface Header {
  width: number;
  height: number;
  depth: number;
  colourType: number;
  interlace: number;
}

/**
 * Scales a PNG down to `maxWidth` (Moon+ keeps covers up to 1500px wide and 3 MB). It only
 * handles the common 8-bit, non-interlaced kinds, and returns anything else unchanged.
 */
export function shrinkPng(data: Buffer, maxWidth = COVER_WIDTH): Buffer {
  try {
    return shrink(data, maxWidth) ?? data;
  } catch {
    return data;
  }
}

function shrink(data: Buffer, maxWidth: number): Buffer | null {
  let header: Header | null = null;
  const idat: Buffer[] = [];
  let palette: Buffer = Buffer.alloc(0);
  let transparency: Buffer = Buffer.alloc(0);
  for (let pos = 8; pos < data.length;) {
    const length = data.readUInt32BE(pos);
    const type = data.toString('latin1', pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colourType: body[9],
        interlace: body[12],
      };
      if (header.colourType === undefined || header.interlace === undefined) return null;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IEND') break;
  }
  if (!header) return null;
  const { width: w, height: h, depth, colourType, interlace } = header;
  const bpp = BYTES_PER_PIXEL[colourType];
  if (w <= maxWidth || depth !== 8 || interlace || bpp === undefined) return null;

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  if (raw.length < h * (stride + 1)) return null;
  const rows = unfilter(raw, w, h, bpp);
  const alpha =
    colourType === 4 || colourType === 6 || (colourType === 3 && transparency.length > 0);

  const pixel = (x: number, y: number): [number, number, number, number] => {
    const r = rows[y];
    switch (colourType) {
      case 2:
        return [r[x * 3], r[x * 3 + 1], r[x * 3 + 2], 255];
      case 6:
        return [r[x * 4], r[x * 4 + 1], r[x * 4 + 2], r[x * 4 + 3]];
      case 3: {
        const i = r[x];
        if (i * 3 + 2 >= palette.length) throw new Error('palette index out of range');
        const a = i < transparency.length ? transparency[i] : 255;
        return [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], a];
      }
      default: {
        const g = r[x * bpp];
        return [g, g, g, colourType === 4 ? r[x * 2 + 1] : 255];
      }
    }
  };

  // each new pixel averages a few samples from a k x k block
  const k = Math.ceil(w / maxWidth);
  const nw = Math.floor(w / k);
  const nh = Math.floor(h / k);
  const taps =
    k >= 3
      ? [0, 1, 2].map((j) => Math.floor((k * (2 * j + 1)) / 6))
      : Array.from({ length: k }, (_, i) => i);
  const channels = alpha ? 4 : 3;
  const out = Buffer.alloc(nh * (1 + nw * channels));
  let o = 0;
  for (let y = 0; y < nh; y++) {
    out[o++] = 0; // filter type: none
    for (let x = 0; x < nw; x++) {
      const sum = [0, 0, 0, 0];
      for (const dy of taps) {
        for (const dx of taps) {
          const px = pixel(x * k + dx, y * k + dy);
          for (let c = 0; c < 4; c++) sum[c] += px[c];
        }
      }
      const n = taps.length * taps.length;
      for (let c = 0; c < channels; c++) out[o++] = Math.floor(sum[c] / n);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(nw, 0);
  ihdr.writeUInt32BE(nh, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(out, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Undoes the PNG row filters, giving one buffer of raw bytes per row. */
function unfilter(raw: Buffer, w: number, h: number, bpp: number): Buffer[] {
  const stride = w * bpp;
  const rows: Buffer[] = [];
  let prev: Buffer = Buffer.alloc(stride);
  for (let y = 0, p = 0; y < h; y++, p += 1 + stride) {
    const filter = raw[p];
    const line = Buffer.from(raw.subarray(p + 1, p + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    rows.push(line);
    prev = line;
  }
  return rows;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
