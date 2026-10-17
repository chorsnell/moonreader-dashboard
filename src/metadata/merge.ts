import type {
  BookHistory,
  Catalogue,
  CatalogueEntry,
} from '../backup-import/reading-history.types';
import { parseIsbn } from './isbn';
import type { Gender, MetadataFile } from './metadata.types';

const REGIONS = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Codes ICU names that aren't countries. */
const NOT_COUNTRIES = new Set(['ZZ', 'EU', 'EZ', 'UN', 'QO', 'XA', 'XB']);
const regionName = (code: string) => (NOT_COUNTRIES.has(code) ? undefined : REGIONS.of(code));
/** Every ISO 3166 alpha-2 code the runtime knows a name for (plus "UK"), by lower-case name. */
const BY_NAME = new Map<string, string>([['uk', 'GB']]);
for (const a of LETTERS) {
  for (const b of LETTERS) {
    const name = regionName(a + b);
    if (name && !BY_NAME.has(name.toLowerCase())) BY_NAME.set(name.toLowerCase(), a + b);
  }
}
const ALIASES: Record<string, string> = {
  'united states of america': 'US',
  usa: 'US',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  britain: 'GB',
  'great britain': 'GB',
  russia: 'RU',
};

/** A country as an ISO 3166 alpha-2 code, from a code or an English name; null if unknown. */
export function normaliseCountry(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  if (/^[a-z]{2}$/i.test(s)) {
    const code = s.toUpperCase() === 'UK' ? 'GB' : s.toUpperCase();
    return regionName(code) ? code : null;
  }
  return ALIASES[s.toLowerCase()] ?? BY_NAME.get(s.toLowerCase()) ?? null;
}

/** The English name of a country code ("GB" -> "United Kingdom"). */
export function countryName(code: string | null): string | null {
  return code ? (regionName(code) ?? null) : null;
}

const GENDERS: Record<string, Gender> = {
  f: 'female',
  female: 'female',
  woman: 'female',
  w: 'female',
  m: 'male',
  male: 'male',
  man: 'male',
  'non-binary': 'non-binary',
  nonbinary: 'non-binary',
  'non binary': 'non-binary',
  nb: 'non-binary',
  enby: 'non-binary',
  other: 'other',
};

export function normaliseGender(raw: unknown): Gender | null {
  return typeof raw === 'string' ? (GENDERS[raw.trim().toLowerCase()] ?? null) : null;
}

const year = (v: unknown) =>
  Number.isInteger(v) && Math.abs(v as number) < 3000 ? (v as number) : null;
const count = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

/** A book's own catalogue entry: the first of its files that has one. */
export function catalogueEntry(
  book: BookHistory,
  catalogue: Catalogue,
): CatalogueEntry | undefined {
  for (const f of book.source_files) {
    const e = catalogue.books[f.toLowerCase()];
    if (e) return e;
  }
  return undefined;
}

export interface BookFacts {
  isbn13: string | null;
  isbn10: string | null;
  work_id: string | null;
  published_year: number | null;
  pages: number | null;
  author_country: string | null;
  author_country_name: string | null;
  author_gender: Gender | null;
}

/**
 * The facts books.json shows for a book: what catalogue.json says (per book, then per
 * author), and the metadata lookup's findings for whatever it doesn't.
 */
export function bookFacts(
  book: BookHistory,
  catalogue: Catalogue,
  metadata: MetadataFile,
): BookFacts {
  const entry = catalogueEntry(book, catalogue);
  const found = metadata.books[book.id] ?? {};
  const authorKey = book.author.toLowerCase();
  const byHand = Object.entries(catalogue.authors ?? {}).find(
    ([name]) => name.toLowerCase() === authorKey,
  )?.[1];
  const author = metadata.authors[authorKey] ?? {};
  const isbn = book.isbn13
    ? { isbn13: book.isbn13, isbn10: book.isbn10 }
    : (parseIsbn(found.isbn13) ?? parseIsbn(found.isbn10));
  const country =
    normaliseCountry(entry?.author_country) ??
    normaliseCountry(byHand?.country) ??
    normaliseCountry(author.country);
  return {
    isbn13: isbn?.isbn13 ?? null,
    isbn10: isbn?.isbn10 ?? null,
    work_id: book.work_id ?? (found.work_id || null),
    published_year: year(entry?.published_year) ?? year(found.published_year),
    pages: count(entry?.pages) ?? count(found.pages),
    author_country: country,
    author_country_name: countryName(country),
    author_gender:
      normaliseGender(entry?.author_gender) ??
      normaliseGender(byHand?.gender) ??
      normaliseGender(author.gender),
  };
}
