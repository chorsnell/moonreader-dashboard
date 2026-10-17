import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { imageExt, shrinkPng } from './png';

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('shrinkPng', () => {
  it('scales a large PNG down and keeps its colours', () => {
    // red on the left half, blue on the right, rows stored with the "Sub" filter
    const w = 400;
    const h = 30;
    const colour = (x: number) => (x < w / 2 ? [255, 0, 0] : [0, 0, 255]);
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      const prev = x ? colour(x - 1) : [0, 0, 0];
      row.push(...colour(x).map((c, i) => (c - prev[i]) & 255));
    }
    const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.from([1, ...row])));
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const png = Buffer.concat([
      SIGNATURE,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    const small = shrinkPng(png, 160);
    expect([small.readUInt32BE(16), small.readUInt32BE(20)]).toEqual([133, 10]);
    const start = small.indexOf('IDAT') + 4;
    const pixels = inflateSync(small.subarray(start, small.length - 16));
    expect([...pixels.subarray(1, 4)]).toEqual([255, 0, 0]); // first pixel still red
    expect([...pixels.subarray(-3)]).toEqual([0, 0, 255]); // last pixel still blue
  });

  it('leaves anything it cannot read alone', () => {
    const notReally = Buffer.concat([SIGNATURE, Buffer.alloc(32)]);
    expect(shrinkPng(notReally)).toBe(notReally);
  });
});

describe('imageExt', () => {
  it('recognises JPEG and PNG only', () => {
    expect(imageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(imageExt(SIGNATURE)).toBe('png');
    expect(imageExt(Buffer.from('GIF89a'))).toBeNull();
  });
});
