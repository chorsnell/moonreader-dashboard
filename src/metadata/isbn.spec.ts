import {
  compactIsbn,
  firstIsbn,
  isbn10To13,
  isbn13To10,
  isValidIsbn10,
  isValidIsbn13,
  parseIsbn,
} from './isbn';

describe('ISBNs', () => {
  it('strips hyphens, spaces and prefixes', () => {
    expect(compactIsbn('978-0-14-143951-8')).toBe('9780141439518');
    expect(compactIsbn('ISBN 0 14 143951 3')).toBe('0141439513');
    expect(compactIsbn('ISBN-13: 978 0141439518')).toBe('9780141439518');
    expect(compactIsbn('urn:isbn:080442957x')).toBe('080442957X');
  });

  it('checks the check digit', () => {
    expect(isValidIsbn13('9780141439518')).toBe(true);
    expect(isValidIsbn13('9780141439519')).toBe(false);
    expect(isValidIsbn13('9771234567898')).toBe(false); // not a book prefix
    expect(isValidIsbn10('0141439513')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isValidIsbn10('0804429570')).toBe(false);
    expect(isValidIsbn10('12345')).toBe(false);
  });

  it('converts between ISBN-10 and ISBN-13', () => {
    expect(isbn10To13('0141439513')).toBe('9780141439518');
    expect(isbn13To10('9780141439518')).toBe('0141439513');
    expect(isbn10To13('080442957X')).toBe('9780804429573');
    expect(isbn13To10('9780804429573')).toBe('080442957X');
    expect(isbn13To10('9791032305690')).toBeNull(); // 979 has no ISBN-10
  });

  it('parses either form into both', () => {
    expect(parseIsbn('0-14-143951-3')).toEqual({ isbn13: '9780141439518', isbn10: '0141439513' });
    expect(parseIsbn('979-10-323-0569-0')).toEqual({ isbn13: '9791032305690', isbn10: null });
    expect(parseIsbn(9780141439518)).toEqual({ isbn13: '9780141439518', isbn10: '0141439513' });
    expect(parseIsbn('not an isbn')).toBeNull();
    expect(parseIsbn(null)).toBeNull();
  });

  it('picks the first valid ISBN-13 from a list', () => {
    expect(firstIsbn(['bad', '0141439513', '9780141439600'])?.isbn13).toBe('9780141439600');
    expect(firstIsbn(['bad', '0141439513'])?.isbn13).toBe('9780141439518');
    expect(firstIsbn([])).toBeNull();
    expect(firstIsbn(undefined)).toBeNull();
  });
});
