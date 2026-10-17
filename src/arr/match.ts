/** Matching the dashboard's books with the book manager's: ISBN first, then title and author. */

const plain = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** A title as a match key: no series suffix, subtitle, leading article or punctuation. */
export function titleKey(title: string): string {
  return plain(
    title
      .replace(/\s*\([^()]*\)\s*$/, '')
      .split(/[:;]/)[0]
      .replace(/&/g, 'and'),
  )
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** An author as a match key: the surname, so "J.R.R. Tolkien" and "Tolkien, J. R. R." agree. */
export function authorKey(author: string): string {
  const a = author.split(/\s+(?:and|&)\s+|;/)[0].trim();
  const surname = a.includes(',')
    ? a.split(',')[0]
    : (a
        .replace(/,?\s+(jr|sr|ii|iii)\.?$/i, '')
        .split(/\s+/)
        .at(-1) ?? '');
  return plain(surname).replace(/[^a-z]+/g, '');
}

export const bookKey = (title: string, author: string) => `${titleKey(title)}|${authorKey(author)}`;

/** "Discworld #2", "Discworld, #2" or "(Discworld, #2)" -> { series: 'discworld', no: 2 }. */
export function seriesOf(
  seriesTitle: string | null | undefined,
): { series: string; no: number } | null {
  const m = /^\(?\s*(.+?),?\s*#\s*([\d.]+)/.exec(seriesTitle ?? '');
  return m ? { series: plain(m[1]).replace(/[^a-z0-9]+/g, ''), no: Number(m[2]) } : null;
}

export const seriesKey = (name: string) => plain(name).replace(/[^a-z0-9]+/g, '');
