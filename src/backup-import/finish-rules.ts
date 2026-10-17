import { daysBetween } from '../common/time';
import { bookFacts, catalogueEntry } from '../metadata/merge';
import type { MetadataFile } from '../metadata/metadata.types';
import type { BookHistory, Catalogue, ReadEntry } from './reading-history.types';

// When a read counts as finished although Moon+ never saw it reach 99% (FINISHED). Change them here.
/** Progress (%) that counts as finished once the read is over: the rest is back matter. */
export const NEAR_END = 95;
/** A read is over when the book hasn't been opened for this many days (or was read again). */
export const OVER_DAYS = 14;
/** Words on a printed page, to turn a page count into the length of the book. */
export const WORDS_PER_PAGE = 250;
/** Share of the book's words read that counts as finished, for reads with no progress. */
export const ESTIMATE_SHARE = 0.8;
/** Reading speeds outside this range (words a minute) are a book left open, or a skim. */
const PLAUSIBLE_WPM = [40, 800] as const;

/**
 * Marks reads finished that Moon+ didn't see reach FINISHED (reading-history.ts), but that were:
 * - ticked as finished in the catalogue ("finished": true), say for a broken file;
 * - over at NEAR_END or more, the rest being afterwords, credits and previews;
 * - logged with no progress at all (Moon+ before about 2019), but long enough, going by the
 *   words read against the book's page count, to have been the whole book.
 * "finished": false in the catalogue turns the guesses off for a book. Only Moon+ reads are
 * touched; imports carry their own finished flag.
 */
export function applyFinishRules(
  books: BookHistory[],
  catalogue: Catalogue,
  metadata: MetadataFile,
  today: string,
): void {
  const wpm = typicalWpm(books);
  for (const b of books) {
    if (b.source) continue;
    const latest = b.reads.at(-1);
    const byHand = catalogueEntry(b, catalogue)?.finished;
    const pages = bookFacts(b, catalogue, metadata).pages;
    const bookWords = pages ? pages * WORDS_PER_PAGE : null;
    for (const r of b.reads) {
      if (r.finished === true || r.source || byHand === false) continue;
      const over = r !== latest || daysBetween(r.end, today) >= OVER_DAYS;
      if (r.progress !== null) {
        if (over && r.progress >= NEAR_END) mark(r, 'near_end');
      } else if (bookWords) {
        const words = wordsRead(b, r, wpm);
        if (words !== null && words >= bookWords * ESTIMATE_SHARE) mark(r, 'estimate');
      }
    }
    if (byHand === true && latest && latest.finished !== true) mark(latest, 'by_hand');
    if (latest ? latest.finished === true : byHand === true) b.status = 'finished';
  }
}

function mark(r: ReadEntry, by: NonNullable<ReadEntry['finished_by']>) {
  r.finished = true;
  r.finished_by = by;
}

/** Words read during a read: as Moon+ logged them, or from the minutes at the reader's usual speed. */
function wordsRead(b: BookHistory, r: ReadEntry, wpm: number | null): number | null {
  let words = 0;
  let minutes = 0;
  for (const d of b.daily) {
    if (d.date < r.start || d.date > r.end) continue;
    words += d.words ?? 0;
    minutes += d.minutes ?? 0;
  }
  if (words > 0) return words;
  return wpm && minutes > 0 ? minutes * wpm : null;
}

/** The median words a minute over every day Moon+ logged both, leaving out implausible days. */
function typicalWpm(books: BookHistory[]): number | null {
  const speeds: number[] = [];
  for (const b of books) {
    for (const d of b.daily) {
      if (!d.words || !d.minutes || d.minutes < 5) continue;
      const wpm = d.words / d.minutes;
      if (wpm >= PLAUSIBLE_WPM[0] && wpm <= PLAUSIBLE_WPM[1]) speeds.push(wpm);
    }
  }
  if (!speeds.length) return null;
  speeds.sort((x, y) => x - y);
  return speeds[Math.floor(speeds.length / 2)];
}
