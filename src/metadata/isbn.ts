/** ISBNs: tidying, checking and converting between ISBN-10 and ISBN-13. */

/** An ISBN's digits (and a final X for an ISBN-10), without hyphens, spaces or a prefix. */
export function compactIsbn(s: string): string {
  return s
    .replace(/^\s*(?:urn:)?isbn(?:-?1[03])?:?\s*/i, '')
    .replace(/[\s\-‐-―.]/g, '')
    .toUpperCase();
}

export function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

export function isValidIsbn13(s: string): boolean {
  return /^97[89]\d{10}$/.test(s) && isbn13CheckDigit(s.slice(0, 12)) === s[12];
}

function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

function isbn10CheckDigit(first9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(first9[i]) * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return c === 10 ? 'X' : String(c);
}

/** An ISBN-10 as an ISBN-13 (every ISBN-10 has one, starting 978). */
export function isbn10To13(isbn10: string): string {
  const core = `978${isbn10.slice(0, 9)}`;
  return core + isbn13CheckDigit(core);
}

/** An ISBN-13 as an ISBN-10, or null for a 979 one, which has no ISBN-10. */
export function isbn13To10(isbn13: string): string | null {
  if (!isbn13.startsWith('978')) return null;
  const core = isbn13.slice(3, 12);
  return core + isbn10CheckDigit(core);
}

export interface Isbns {
  isbn13: string;
  isbn10: string | null;
}

/**
 * Reads an ISBN written any usual way ("978-0-14-143951-8", "0141439513", "ISBN 014143951X")
 * and returns both forms, or null if it isn't a valid ISBN.
 */
export function parseIsbn(raw: unknown): Isbns | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = compactIsbn(String(raw));
  if (isValidIsbn13(s)) return { isbn13: s, isbn10: isbn13To10(s) };
  if (isValidIsbn10(s)) return { isbn13: isbn10To13(s), isbn10: s };
  return null;
}

/** The first valid ISBN in a list, preferring one written as an ISBN-13. */
export function firstIsbn(list: readonly unknown[] | undefined): Isbns | null {
  const valid = (list ?? []).filter((x) => parseIsbn(x) !== null).map(String);
  const pick = valid.find((x) => compactIsbn(x).length === 13) ?? valid[0];
  return pick === undefined ? null : parseIsbn(pick);
}
