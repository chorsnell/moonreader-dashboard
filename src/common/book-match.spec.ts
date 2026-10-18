import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { WEB_DIR } from '../paths';
import {
  authorKey,
  bookKey,
  isbnDigits,
  looseTitle,
  sameAuthorLoose,
  sameBook,
  sameBookKeys,
  seriesKey,
  seriesOf,
  seriesSuffix,
  titleKey,
} from './book-match';

// The copies this module replaced (BOO-94), pinned here so the refactor provably changes
// nothing: each is compared with the module over the corpus below.
const old = {
  // src/imports/merge.ts
  importTitle(title: string): string {
    return title
      .replace(/\s*\(([^()#]+?),?\s*#\s*([\d.]+)[^()]*\)\s*$/, '')
      .replace(/\s*\([^()]*\)\s*$/, '')
      .split(/[:;]/)[0]
      .toLowerCase()
      .replace(/&/g, 'and')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/^(the|a|an)\s+/, '')
      .replace(/[^a-z0-9]+/g, '');
  },
  importAuthor(author: string): string {
    const a = author.split(/\s+(?:and|&)\s+|;/)[0].trim();
    const surname = a.includes(',')
      ? a.split(',')[0]
      : (a
          .replace(/,?\s+(jr|sr|ii|iii)\.?$/i, '')
          .split(/\s+/)
          .at(-1) ?? '');
    return surname
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z]+/g, '');
  },
  // src/arr/match.ts
  arrTitle(title: string): string {
    const plain = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    return plain(
      title
        .replace(/\s*\([^()]*\)\s*$/, '')
        .split(/[:;]/)[0]
        .replace(/&/g, 'and'),
    )
      .replace(/^(the|a|an)\s+/, '')
      .replace(/[^a-z0-9]+/g, '');
  },
  arrSeriesOf(t: string | null): { series: string; no: number } | null {
    const plain = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const m = /^\(?\s*(.+?),?\s*#\s*([\d.]+)/.exec(t ?? '');
    return m ? { series: plain(m[1]).replace(/[^a-z0-9]+/g, ''), no: Number(m[2]) } : null;
  },
  // src/clubs/clubs.ts bookKeys
  clubKeys(b: { title?: unknown; author?: unknown; isbn13?: unknown; work_id?: unknown }) {
    const norm = (s: unknown) =>
      String(s ?? '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
    const out: string[] = [];
    if (b.isbn13) out.push(`isbn:${String(b.isbn13).replace(/[^0-9X]/gi, '')}`);
    if (b.work_id) out.push(`work:${String(b.work_id)}`);
    if (b.title) {
      const t = norm(b.title)
        .replace(/^(the|a|an)\s+/, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      out.push(`ta:${t}|${norm(b.author).replace(/[^a-z]+/g, '')}`);
    }
    return out;
  },
  // src/prices/prices.ts
  priceTitle: (s: string) =>
    (s.split(/\s*(?::|\(|\s[-–—]\s)/)[0] || s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(the|a|an)\s+/, ''),
  priceAuthor(a: string, b: string): boolean {
    const n = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!a || !b) return false;
    const x = n(a.includes(',') ? a.split(',').reverse().join(' ') : a);
    const y = n(b.includes(',') ? b.split(',').reverse().join(' ') : b);
    return x === y || x.split(' ').pop() === y.split(' ').pop();
  },
};

const TITLES = [
  'Emma',
  'The Colour of Magic (Discworld, #1)',
  'Colour of Magic',
  'Frankenstein: or, The Modern Prometheus',
  'A Tale of Two Cities',
  'An Unsuitable Job for a Woman',
  'Emma (Penguin Classics)',
  'Guards! Guards! (Discworld, #8; City Watch, #1)',
  'Mort (Unabridged) (Discworld, #4)',
  'Les Misérables',
  'Pride & Prejudice',
  'Dune - Part One',
  'The Hobbit; or There and Back Again',
  'ÉMILE',
  'War and Peace (Book 1)',
  'Thérèse Raquin — a novel',
  '1984',
  '',
  'Theory of Everything',
];
const AUTHORS = [
  'Jane Austen',
  'Austen, Jane',
  'J.R.R. Tolkien',
  'Tolkien, J. R. R.',
  'Martin Luther King Jr.',
  'King, Stephen & Straub, Peter',
  'Terry Pratchett and Neil Gaiman',
  'Émile Zola',
  'Brontë, Charlotte',
  'H. G. Wells',
  'Wells, H. G.',
  'Plato',
  '',
];

describe('book matching (one module)', () => {
  it('gives the same title and author keys as the importers did', () => {
    for (const t of TITLES) expect([t, titleKey(t)]).toEqual([t, old.importTitle(t)]);
    for (const a of AUTHORS) expect([a, authorKey(a)]).toEqual([a, old.importAuthor(a)]);
    expect(titleKey('The Colour of Magic (Discworld, #1)')).toBe(titleKey('Colour of Magic'));
    expect(authorKey('J.R.R. Tolkien')).toBe(authorKey('Tolkien, J. R. R.'));
  });

  it('gives the same keys as the Arr lookup did', () => {
    for (const t of TITLES) {
      expect([t, titleKey(t, { series: false })]).toEqual([t, old.arrTitle(t)]);
      for (const a of AUTHORS) {
        expect(bookKey(t, a, { series: false })).toBe(`${old.arrTitle(t)}|${old.importAuthor(a)}`);
      }
    }
    for (const s of ['Discworld #2', 'Discworld, #2', '(Discworld, #2)', 'Les Rougon #1.5', '']) {
      expect(seriesOf(s)).toEqual(old.arrSeriesOf(s));
    }
    expect(seriesOf(null)).toBeNull();
    expect(seriesKey('The Expanse')).toBe('theexpanse');
  });

  it('splits a series suffix off a title as the importer did', () => {
    expect(seriesSuffix('The Colour of Magic (Discworld, #1)')).toEqual({
      title: 'The Colour of Magic',
      series: 'Discworld',
      no: 1,
    });
    expect(seriesSuffix('Emma')).toBeNull();
  });

  it('gives the same cross-library keys as book clubs did', () => {
    for (const title of [...TITLES, undefined]) {
      for (const author of [...AUTHORS, undefined]) {
        for (const extra of [{}, { isbn13: '978-0-14-143958-7', work_id: 'OL1W' }]) {
          const b = { title, author, ...extra };
          expect(sameBookKeys(b)).toEqual(old.clubKeys(b));
        }
      }
    }
    const books = [{ id: 'emma-1', title: 'EMMA', author: 'Jane  Austen' }];
    expect(sameBook(books, { title: 'Emma', author: 'Jane Austen' })?.id).toBe('emma-1');
    expect(sameBook(books, { title: 'Emma', author: 'Austen, Jane' })).toBeNull();
  });

  it('matches hand-typed price rows as the price import did', () => {
    for (const t of TITLES) expect([t, looseTitle(t)]).toEqual([t, old.priceTitle(t)]);
    for (const a of AUTHORS) {
      for (const b of AUTHORS)
        expect([a, b, sameAuthorLoose(a, b)]).toEqual([a, b, old.priceAuthor(a, b)]);
    }
    expect(isbnDigits('978-0-14-143958-x')).toBe('978014143958X');
    expect(isbnDigits(null)).toBe('');
  });

  it("agrees with the page's dash.sameBook", () => {
    const dash: { sameBook?: { keys: (b: unknown) => string[] } } = {};
    const src = readFileSync(join(WEB_DIR, 'features/friend-profiles.js'), 'utf8');
    // only the first IIFE: the matcher, which needs nothing but `dash`
    const matcher = src.slice(0, src.indexOf('})();') + '})();'.length);
    runInContext(matcher, createContext({ dash }));
    for (const title of TITLES) {
      for (const author of AUTHORS) {
        const b = { title, author, isbn13: title ? null : '9780141439587' };
        expect(dash.sameBook!.keys(b)).toEqual(sameBookKeys(b));
      }
    }
  });
});
