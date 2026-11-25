import {
  chapterOfFragment,
  formatMoonPosition,
  fragmentOfChapter,
  fragmentStart,
  moonStamp,
  parseMoonPosition,
  toFraction,
  toPercent,
  xpointerFragment,
} from './positions';

describe('parseMoonPosition', () => {
  it('reads a position with a time in ms', () => {
    expect(parseMoonPosition('1502878256645*28@0#15529:12.3%')).toEqual({
      time: 1502878256645,
      chapter: 28,
      split: 0,
      offset: 15529,
      percent: 12.3,
    });
  });

  it('reads a time in seconds, and no time at all', () => {
    expect(parseMoonPosition('1502878256*1@0#2:3%')?.time).toBe(1502878256000);
    expect(parseMoonPosition('7@1#100:83.5%')).toEqual({
      time: null,
      chapter: 7,
      split: 1,
      offset: 100,
      percent: 83.5,
    });
  });

  it('ignores whitespace around it and rejects what is not a position', () => {
    expect(parseMoonPosition('\n 1*2@0#3:4.5%\r\n')?.chapter).toBe(2);
    expect(parseMoonPosition('')).toBeNull();
    expect(parseMoonPosition('hello')).toBeNull();
    expect(parseMoonPosition('1*2@0#3:250%')).toBeNull();
  });
});

describe('formatMoonPosition', () => {
  it('writes what Moon+ writes, and reads back the same', () => {
    const p = { time: 1700000000123, chapter: 4, split: 0, offset: 812, percent: 37.25 };
    const text = formatMoonPosition(p);
    expect(text).toBe('1700000000123*4@0#812:37.3%');
    expect(parseMoonPosition(text)).toEqual({ ...p, percent: 37.3 });
  });

  it('clamps what it cannot write', () => {
    expect(formatMoonPosition({ time: 1, chapter: -2, split: 0, offset: 3.9, percent: 120 })).toBe(
      '1*0@0#3:100%',
    );
  });
});

describe('moonStamp', () => {
  it('keeps the first number as written', () => {
    expect(moonStamp('1502878256*1@0#2:3%')).toBe('1502878256');
    expect(moonStamp('1*2@0#3:4%')).toBeNull();
    expect(
      formatMoonPosition({ time: 5, chapter: 1, split: 2, offset: 3, percent: 4 }, '1502878256'),
    ).toBe('1502878256*1@2#3:4.0%');
  });
});

describe('xpointers', () => {
  it('finds the spine item an xpointer points into', () => {
    expect(xpointerFragment('/body/DocFragment[12]/body/div/p[5]/text().57')).toBe(12);
    expect(xpointerFragment('/body/DocFragment[3]')).toBe(3);
    expect(xpointerFragment('/body/DocFragment/body/p[5]/text().2')).toBe(1);
    expect(xpointerFragment('/body/DocFragmentX')).toBeNull();
    expect(xpointerFragment('/body/div/p[5]')).toBeNull();
    expect(xpointerFragment('42')).toBeNull();
  });

  it('goes between Moon+ chapters and spine items', () => {
    expect(fragmentStart(fragmentOfChapter(0))).toBe('/body/DocFragment[1]');
    expect(chapterOfFragment(xpointerFragment(fragmentStart(9))!)).toBe(8);
    expect(chapterOfFragment(0)).toBe(0);
  });

  it('converts percentages', () => {
    expect(toPercent(0.425)).toBe(42.5);
    expect(toFraction(42.5)).toBe(0.425);
    expect(toFraction(130)).toBe(1);
  });
});
