import {
  locate,
  moonPlace,
  moonToXpointer,
  parseLayout,
  samePlace,
  xpointerOffset,
  furtherInChapter,
} from './layout';

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

  it('goes by chapter and character, however far out the percentage is', () => {
    expect(moonToXpointer(layout, moon(1, 3100, 99))).toBe(
      '/body/DocFragment[2]/body/p[20]/text().0',
    );
  });

  it('goes by the percentage only for a chapter the book does not have', () => {
    expect(locate(layout, moon(9, 0, 61))).toMatchObject({
      xp: '/body/DocFragment[3]/body/p[1]/text().0',
      method: 'percent',
    });
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
  });

  it('otherwise uses the page of that spine item at the percentage', () => {
    expect(xpointerOffset(layout, '/body/DocFragment[2]/body/p[12]/text().0', 0.35)).toBe(1500);
    expect(xpointerOffset(layout, '/body/DocFragment[7]/body', 0.9)).toBe(0);
  });
});

/** A book of spine items so many pages long, 1000 characters to a page. */
const book = (sizes: number[], toc: [number, number][] = []) => {
  const count = sizes.reduce((s, n) => s + n, 0);
  let n = 0;
  return parseLayout({
    md5: MD5,
    pages: sizes.flatMap((size, f) =>
      Array.from({ length: size }, (_, p) => ({
        xp: at(f + 1, p * 1000),
        offset: p * 1000,
        pct: ++n / count,
      })),
    ),
    toc: toc.map(([fragment, offset]) => ({ fragment, offset })),
    lengths: sizes.slice(0, -1).map((size) => size * 1000),
  });
};
const at = (fragment: number, offset: number) =>
  `/body/DocFragment[${fragment}]/body/p[${offset / 1000 + 1}]/text().0`;
const split = (chapter: number, part: number, offset: number, percent: number) => ({
  ...moon(chapter, offset, percent),
  split: part,
});
// a cover and a title page the contents don't list, then two chapters
const novel = book(
  [1, 1, 10, 10],
  [
    [3, 0],
    [4, 0],
  ],
);

describe("which chapters are Moon+'s", () => {
  it('keeps the contents and file lengths the plugin sends', () => {
    expect(novel.toc).toEqual([
      { fragment: 3, offset: 0 },
      { fragment: 4, offset: 0 },
    ]);
    expect(novel.lengths).toEqual([1000, 1000, 10000]);
    expect(book([2]).toc).toBeUndefined();
  });

  it("reads the contents' chapters, with front matter as chapter 0", () => {
    expect(locate(novel, moon(1, 4500, 30))).toMatchObject({
      xp: at(3, 4000),
      method: 'exact',
      mapping: 'toc',
      decisive: true,
    });
  });

  it('reads the spine when only that fits the percentage', () => {
    expect(locate(novel, moon(3, 4000, 74))).toMatchObject({
      xp: at(4, 4000),
      mapping: 'spine',
      decisive: true,
    });
  });

  it('writes by the same mapping, not always the spine', () => {
    expect(moonPlace(novel, at(3, 4000), 0.32)).toEqual({ chapter: 1, split: 0, offset: 4000 });
    expect(moonPlace(novel, at(3, 4000), 0.32, 'spine')).toEqual({
      chapter: 2,
      split: 0,
      offset: 4000,
    });
  });

  it('keeps what fitted before when short chapters let both fit', () => {
    // thirty one-page files, the contents starting at the third
    const short = book(
      Array.from({ length: 30 }, () => 1),
      Array.from({ length: 28 }, (_, i) => [i + 3, 0] as [number, number]),
    );
    expect(locate(short, moon(10, 0, 38))).toMatchObject({ mapping: 'toc', decisive: false });
    expect(locate(short, moon(10, 0, 38), 'spine')).toMatchObject({
      xp: at(11, 0),
      mapping: 'spine',
      decisive: false,
    });
  });

  it("doesn't believe a chapter too short to hold the character", () => {
    // 3% apart, which the percentage alone would let pass
    const b = book(
      [30, 1, 30, 39],
      [
        [3, 0],
        [4, 0],
      ],
    );
    expect(locate(b, moon(1, 20000, 51))).toMatchObject({ xp: at(3, 20000), mapping: 'toc' });
  });

  it('starts a chapter at a contents entry inside a file', () => {
    const one = book(
      [10],
      [
        [1, 0],
        [1, 5000],
      ],
    );
    expect(moonToXpointer(one, moon(1, 2000, 75))).toBe(at(1, 7000));
    expect(moonPlace(one, at(1, 7000), 0.8)).toEqual({ chapter: 1, split: 0, offset: 2000 });
  });

  it('counts on through files the contents merge into one chapter', () => {
    const merged = book(
      [2, 2, 2],
      [
        [1, 0],
        [3, 0],
      ],
    );
    expect(moonToXpointer(merged, moon(0, 3500, 60))).toBe(at(2, 1000));
    expect(moonPlace(merged, at(2, 1000), 0.66)).toEqual({ chapter: 0, split: 0, offset: 3001 });
  });
});

describe("Moon+'s split chapters", () => {
  const long = book([1, 200], [[2, 0]]);

  it('counts a split from the start of its part, both ways', () => {
    expect(locate(long, split(1, 2, 500, 80))).toMatchObject({
      xp: at(2, 160000),
      method: 'exact',
    });
    expect(moonPlace(long, at(2, 161000), 0.81)).toEqual({ chapter: 1, split: 2, offset: 1000 });
    expect(moonPlace(long, at(2, 5000), 0.03)).toEqual({ chapter: 1, split: 0, offset: 5000 });
  });

  it('stays in a chapter too short for the character', () => {
    const two = book([100, 100]);
    // by the percentage where that's inside the chapter, otherwise its end
    expect(locate(two, split(0, 3, 0, 30))).toMatchObject({
      xp: at(1, 59000),
      method: 'chapter',
    });
    expect(locate(two, split(0, 3, 0, 90))).toMatchObject({
      xp: at(1, 99000),
      method: 'chapter',
    });
  });

  it('goes by percentage alone when no chapter fits', () => {
    expect(locate(novel, moon(40, 0, 50))).toMatchObject({ method: 'percent' });
  });
});

describe('without a layout', () => {
  it("reckons on within a chapter from the dashboard's own write", () => {
    expect(furtherInChapter(moon(4, 9000, 55), moon(4, 0, 58))).toEqual({
      split: 0,
      offset: 15000,
    });
    expect(furtherInChapter(moon(4, 9000, 55), moon(4, 0, 50))).toBeNull();
    expect(furtherInChapter(moon(4, 9000, 55), moon(5, 0, 70))).toBeNull();
  });
});
