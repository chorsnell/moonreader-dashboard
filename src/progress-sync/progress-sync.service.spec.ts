import type { PoFile } from './moonplus-files';
import { kosyncToMoon, moonToKosync, newPoPath, parseUpdate } from './progress-sync.service';

const po = (path: string): PoFile => ({
  path,
  bookFile: path.split('/').pop()!.slice(0, -3),
  text: '',
  mtimeMs: 0,
});

describe('conversions', () => {
  it('turns a Moon+ position into the start of its chapter for KOReader', () => {
    expect(
      moonToKosync({ time: 1, chapter: 4, split: 0, offset: 99, percent: 30 }, 2_500_000),
    ).toEqual({
      progress: '/body/DocFragment[5]',
      percentage: 0.3,
      device: 'Moon+ Reader',
      device_id: 'moonplus',
      timestamp: 2500,
    });
  });

  it("turns a KOReader xpointer into Moon+'s chapter", () => {
    expect(kosyncToMoon('/body/DocFragment[5]/body/p[2]/text().4', 0.305, 9)).toEqual({
      time: 9,
      chapter: 4,
      split: 0,
      offset: 0,
      percent: 30.5,
    });
    expect(kosyncToMoon('12', 0.3, 9)).toBeNull();
  });
});

describe('newPoPath', () => {
  it("goes next to most of Moon+'s .po files", () => {
    const files = [po('/d/a/x.epub.po'), po('/d/b/y.epub.po'), po('/d/b/z.epub.po')];
    expect(newPoPath('/mnt/onboard/Foundation.epub', files)).toBe('/d/b/Foundation.epub.po');
  });

  it("isn't made for PDFs, unknown files or when Moon+ never synced", () => {
    expect(newPoPath('Scan.pdf', [po('/d/x.epub.po')])).toBeNull();
    expect(newPoPath(null, [po('/d/x.epub.po')])).toBeNull();
    expect(newPoPath('Foundation.epub', [])).toBeNull();
  });
});

describe('parseUpdate', () => {
  it('keeps the fields KOSync sends and clamps the percentage', () => {
    expect(
      parseUpdate({ document: 'abc', progress: 7, percentage: '1.5', device: 'K', device_id: 'x' }),
    ).toEqual({ document: 'abc', progress: '7', percentage: 1, device: 'K', device_id: 'x' });
    expect(() => parseUpdate({ document: '../x', progress: '1', percentage: 0 })).toThrow();
  });
});
