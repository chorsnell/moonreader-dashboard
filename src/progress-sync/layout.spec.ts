import { moonToXpointer, parseLayout, samePlace, xpointerOffset } from './layout';

const MD5 = '0123456789abcdef0123456789abcdef';
// three spine items: 1 is one page, 2 is three pages, 3 is two pages
const layout = parseLayout({
  md5: MD5,
  file: 'Dune.epub',
  pages: [
    { xp: '/body/DocFragment[1]/body/h1/text().0', offset: 0, pct: 0 },
    { xp: '/body/DocFragment[2]/body/p[1]/text().0', offset: 0, pct: 0.2 },
    { xp: '/body/DocFragment[2]/body/p[9]/text().12', offset: 1500, pct: 0.3 },
    { xp: '/body/DocFragment[2]/body/p[20]/text().0', offset: 3100, pct: 0.4 },
    { xp: '/body/DocFragment[3]/body/p[1]/text().0', offset: 0, pct: 0.6 },
    { xp: '/body/DocFragment[3]/body/p[7]/text().3', offset: 1400, pct: 0.8 },
  ],
});
const moon = (chapter: number, offset: number, percent: number) => ({
  time: 1,
  chapter,
  split: 0,
  offset,
  percent,
});

describe('parseLayout', () => {
  it('keeps pages with an xpointer and works out their spine item', () => {
    expect(layout.pages).toHaveLength(6);
    expect(layout.pages[2]).toMatchObject({ fragment: 2, offset: 1500 });
    const some = parseLayout({
      md5: MD5.toUpperCase(),
      pages: [
        { xp: 'nope', offset: 1, pct: 0 },
        { xp: '/body/DocFragment[4]', offset: -3, pct: 2 },
      ],
    });
    expect(some).toEqual({
      md5: MD5,
      file: null,
      pages: [{ xp: '/body/DocFragment[4]', fragment: 4, offset: 0, pct: 1 }],
    });
  });

  it('refuses what is not a layout', () => {
    expect(() => parseLayout({ md5: 'x', pages: [] })).toThrow('md5');
    expect(() => parseLayout({ md5: MD5, pages: [] })).toThrow('pages');
    expect(() => parseLayout({ md5: MD5, pages: [{ xp: 'p' }] })).toThrow('xpointer');
  });
});

describe('moonToXpointer', () => {
  it("opens the page of the chapter holding Moon+'s character", () => {
    expect(moonToXpointer(layout, moon(1, 2000, 32))).toBe(
      '/body/DocFragment[2]/body/p[9]/text().12',
    );
    expect(moonToXpointer(layout, moon(1, 3100, 41))).toBe(
      '/body/DocFragment[2]/body/p[20]/text().0',
    );
  });

  it("goes by the percentage when Moon+'s chapters don't line up with the spine", () => {
    // Moon+ says chapter 0, but 85% through: it split the book differently
    expect(moonToXpointer(layout, moon(0, 50, 85))).toBe('/body/DocFragment[3]/body/p[7]/text().3');
    // a chapter the book doesn't have
    expect(moonToXpointer(layout, moon(9, 0, 61))).toBe('/body/DocFragment[3]/body/p[1]/text().0');
  });
});

describe('xpointerOffset', () => {
  it('is exact for the top of a measured page', () => {
    expect(xpointerOffset(layout, '/body/DocFragment[3]/body/p[7]/text().3', 0.8)).toBe(1400);
  });

  it('is exact within the text a measured page starts in', () => {
    expect(xpointerOffset(layout, '/body/DocFragment[2]/body/p[9]/text().57', 0.3)).toBe(1545);
    expect(xpointerOffset(layout, '/body/DocFragment[2]/body/p[9]/text().0', 0.3)).toBe(1488);
  });

  it('allows for KOReader rounding its percentage down', () => {
    // page 2 of 3 is 0.66666…, which KOReader sends as 0.6666
    const thirds = parseLayout({
      md5: MD5,
      pages: [1, 2, 3].map((n) => ({
        xp: `/body/DocFragment[1]/body/p[${n}]/text().0`,
        offset: (n - 1) * 100,
        pct: n / 3,
      })),
    });
    expect(xpointerOffset(thirds, '/body/DocFragment[1]/body/div/text().0', 0.6666)).toBe(100);
  });

  it('knows when Moon+ is already on the page', () => {
    const xp = '/body/DocFragment[2]/body/p[9]/text().12';
    expect(samePlace(layout, moon(1, 2000, 32), xp, moon(1, 1500, 30))).toBe(true);
    expect(samePlace(layout, moon(1, 3100, 40), xp, moon(1, 1500, 30))).toBe(false);
    expect(samePlace(layout, moon(2, 0, 60), xp, moon(1, 1500, 30))).toBe(false);
    expect(samePlace(null, moon(1, 3100, 40), xp, moon(1, 0, 30))).toBe(true);
  });

  it('otherwise uses the page of that spine item at the percentage', () => {
    expect(xpointerOffset(layout, '/body/DocFragment[2]/body/p[12]/text().0', 0.35)).toBe(1500);
    expect(xpointerOffset(layout, '/body/DocFragment[7]/body', 0.9)).toBe(0);
  });
});
