/**
 * The pure part of the bibliography lookup (BOO-103): which of an author's Open Library works
 * to keep, and how Wikidata's works (with their series) are merged in.
 */
import { titleKey } from '../common/book-match';
import type { AuthorWorkDoc } from '../covers/open-library.client';
import { firstIsbn } from '../metadata/isbn';
import type { WikidataWork } from '../metadata/wikidata.client';
import type { BibliographyWork } from './bibliography.types';

/**
 * Titles that aren't a work of the author's own: study guides and summaries, and sets of
 * books sold together (box sets, omnibuses, "Books 1-3", collected or complete works).
 */
const NOT_A_WORK: RegExp[] = [
  /\bstudy guide\b/,
  /\bstudent'?s? guide\b/,
  /\breader'?s? guide\b/,
  /\bsummary\b/,
  /\bsummaries\b/,
  /\bspark ?notes\b/,
  /\bcliff'?s? ?notes\b/,
  /\bcoles notes\b/,
  /\byork notes\b/,
  /\bliterature guide\b/,
  /\banalysis of\b/,
  /\bcritical (essays|companion|study)\b/,
  /\bbox(ed)? ?set\b/,
  /\bomnibus\b/,
  /\b(books?|novels?|stories|parts?|vol(ume)?s?\.?|#) ?\d+ ?(-|to|and|&|thru) ?\d+\b/,
  /\btrilogy\b.*\b(set|box|collection|books)\b/,
  /\b(complete|collected|selected) (works|novels|stories|tales|short stories|fiction|poems|writings)\b/,
  /^(the )?complete\b/,
  /^(the )?works of\b/,
  /^(the )?novels of\b/,
  /\bcollection\b/,
  /\banthology\b/,
  /\bset of \d+\b/,
  /\b\d+ books? in \d+\b/,
  /\bcolouring book\b|\bcoloring book\b/,
];

/** True when a title is a study guide, a summary, a box set or another kind of collection. */
export function isNotAWork(title: string | null | undefined): boolean {
  const t = (title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;
  return NOT_A_WORK.some((r) => r.test(t));
}

/** Open Library's codes for English editions. */
const ENGLISH = new Set(['eng', 'en']);

/**
 * The works worth showing from an author's Open Library list: at least two editions and a
 * first-published year, no study guides, summaries or box sets, none whose editions are
 * all in other languages, and no title twice (the one with the most editions is kept, with
 * the earliest year of the repeats).
 */
export function keepWorks(docs: readonly AuthorWorkDoc[]): BibliographyWork[] {
  const byTitle = new Map<string, BibliographyWork>();
  const out: BibliographyWork[] = [];
  for (const d of docs) {
    if (!d || typeof d !== 'object') continue;
    const title = typeof d.title === 'string' ? d.title.trim().replace(/\s+/g, ' ') : '';
    const editions = Number.isInteger(d.edition_count) ? d.edition_count! : 0;
    const year = Number.isInteger(d.first_publish_year) ? d.first_publish_year! : null;
    if (!title || editions < 2 || year === null || isNotAWork(title)) continue;
    const langs = Array.isArray(d.language)
      ? d.language.filter((l): l is string => typeof l === 'string')
      : [];
    if (langs.length && !langs.some((l) => ENGLISH.has(l.toLowerCase()))) continue;
    const key = titleKey(title);
    if (!key) continue; // a title in another script
    const had = byTitle.get(key);
    if (had) {
      if (had.year === null || year < had.year) had.year = year;
      if (editions > (had.editions ?? 0)) {
        Object.assign(had, { work_id: workId(d.key), title, editions });
        had.isbn13 ??= firstIsbn(d.isbn)?.isbn13 ?? null;
      }
      continue;
    }
    const work: BibliographyWork = {
      work_id: workId(d.key),
      title,
      year,
      editions,
      series: null,
      series_no: null,
      isbn13: firstIsbn(Array.isArray(d.isbn) ? d.isbn : [])?.isbn13 ?? null,
      sources: ['openlibrary'],
    };
    byTitle.set(key, work);
    out.push(work);
  }
  return out.sort((a, b) => (b.editions ?? 0) - (a.editions ?? 0));
}

const workId = (key: unknown) => {
  const id = typeof key === 'string' ? key.replace(/^\/?works\//, '') : '';
  return /^OL\d+W$/.test(id) ? id : null;
};

/**
 * Open Library's works with Wikidata's merged in by title: a work both know gets Wikidata's
 * series and number; a work only Wikidata knows is added when it's part of a series (it fills
 * a gap Open Library leaves), and not otherwise.
 */
export function mergeWikidata(
  works: readonly BibliographyWork[],
  wikidata: readonly WikidataWork[],
): BibliographyWork[] {
  const out = works.map((w) => ({ ...w, sources: [...w.sources] }));
  const byTitle = new Map(out.map((w) => [titleKey(w.title), w]));
  // works with a series first, so a numbered one wins over an edition with no series
  const ordered = [...wikidata].sort(
    (a, b) =>
      Number(b.series_no !== null) - Number(a.series_no !== null) ||
      Number(b.series !== null) - Number(a.series !== null),
  );
  for (const wd of ordered) {
    if (!wd?.title || isNotAWork(wd.title)) continue;
    const key = titleKey(wd.title);
    if (!key) continue;
    const had = byTitle.get(key);
    if (had) {
      if (!had.sources.includes('wikidata')) had.sources.push('wikidata');
      if (wd.series && !had.series) {
        had.series = wd.series;
        had.series_no = wd.series_no;
      }
      if (had.year === null && wd.year !== null) had.year = wd.year;
      continue;
    }
    if (!wd.series) continue;
    const work: BibliographyWork = {
      work_id: null,
      title: wd.title,
      year: wd.year,
      editions: null,
      series: wd.series,
      series_no: wd.series_no,
      isbn13: null,
      sources: ['wikidata'],
    };
    byTitle.set(key, work);
    out.push(work);
  }
  return out;
}
