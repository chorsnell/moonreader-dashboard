import { inflateSync } from 'node:zlib';
import { encode } from 'jpeg-js';
import { Bitmap, toAscii } from './bitmap';
import { einkCover, einkPicture, einkStats, EINK_HEIGHT, EINK_WIDTH } from './eink';
import type { NowSummary } from './now';

const now: NowSummary = {
  today: '2026-10-18',
  as_of: '2026-10-17',
  generated: null,
  reading: [
    {
      id: 'a',
      title: 'Les Misérables',
      author: 'Victor Hugo',
      genre: null,
      progress: 40,
      last_read: null,
      cover: 'covers/a.jpg',
    },
  ],
  today_minutes: 25,
  week_minutes: 150,
  streak: { current: 4, best: 9, last_day: '2026-10-17', read_today: false, at_risk: true },
  year: { year: 2026, finished: 9, goal: 24, percent: 38, expected: 19, ahead: -10 },
  quote: { text: '“Quoted” text', note: null, book_id: 'a', title: 'Emma', author: 'Jane Austen' },
};

/** Reads back a 1-bit grayscale PNG's size and how many pixels are black. */
function decode1bit(png: Buffer): { width: number; height: number; black: number } {
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(1); // bit depth
  expect(png[25]).toBe(0); // grayscale
  let pos = 8;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.subarray(pos + 4, pos + 8).toString();
    if (type === 'IDAT') idat.push(png.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(width / 8);
  expect(raw.length).toBe((stride + 1) * height);
  let black = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!(raw[y * (stride + 1) + 1 + (x >> 3)] & (0x80 >> (x & 7)))) black++;
    }
  }
  return { width, height, black };
}

describe('Bitmap', () => {
  it('writes a valid 1-bit PNG, padding bits white', () => {
    const bm = new Bitmap(10, 3);
    bm.fill(0, 0, 10, 1);
    bm.set(9, 2);
    expect(decode1bit(bm.png())).toEqual({ width: 10, height: 3, black: 11 });
  });

  it('draws text and measures it the same', () => {
    const bm = new Bitmap(200, 30);
    const w = bm.text('Hello, e-ink!', 2, 2, 2);
    expect(w).toBe(Bitmap.textWidth('Hello, e-ink!', 2));
    expect(decode1bit(bm.png()).black).toBeGreaterThan(50);
  });

  it('folds text to what the font has', () => {
    expect(toAscii('Les Misérables — “Fantine” …')).toBe('Les Miserables - "Fantine" ...');
    expect(toAscii('Ærø straße 漢')).toBe('AEro strasse ?');
  });

  it('wraps to lines that fit, ending with ... when cut', () => {
    const lines = Bitmap.wrap('one two three four five six seven eight', 2, 80, 2);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(Bitmap.textWidth(l, 2)).toBeLessThanOrEqual(80);
    expect(lines[1].endsWith('...')).toBe(true);
    expect(Bitmap.wrap('short', 2, 80, 2)).toEqual(['short']);
  });

  it('dithers a mid-grey to about half black', () => {
    const bm = new Bitmap(40, 40);
    bm.dither({ width: 4, height: 4, gray: (x) => (x < 2 ? 100 : 160) }, 0, 0, 40, 40);
    const black = decode1bit(bm.png()).black;
    expect(black).toBeGreaterThan(400);
    expect(black).toBeLessThan(1200);
  });
});

describe('the e-ink view', () => {
  it('is 800 x 480 with the figures that are shared', () => {
    expect(einkStats(now).map((s) => s.label)).toEqual(['STREAK', 'THIS WEEK', '2026']);
    expect(einkStats(now)[1].value).toBe('2.5 h');
    expect(einkStats(now)[2]).toMatchObject({ value: '9 / 24', sub: '10 books behind' });
    const hidden = { ...now, streak: null, week_minutes: null };
    expect(einkStats(hidden).map((s) => s.label)).toEqual(['2026']);
    const png = einkPicture(now, null).png();
    const d = decode1bit(png);
    expect([d.width, d.height]).toEqual([EINK_WIDTH, EINK_HEIGHT]);
    expect(d.black).toBeGreaterThan(2000);
  });

  it('draws the cover dithered, and copes with nothing shared', () => {
    const data = Buffer.alloc(30 * 45 * 4, 90);
    const jpeg = encode({ width: 30, height: 45, data }, 90).data;
    const withCover = decode1bit(einkPicture(now, jpeg).png()).black;
    expect(withCover).toBeGreaterThan(decode1bit(einkPicture(now, null).png()).black);
    const cover = einkCover(jpeg)!;
    expect([cover.width, cover.height]).toEqual([240, 360]);
    expect(einkCover(Buffer.from('not an image'))).toBeNull();
    const none = { ...now, reading: null, streak: null, week_minutes: null, quote: null };
    expect(decode1bit(einkPicture(none, null).png()).width).toBe(800);
  });
});
