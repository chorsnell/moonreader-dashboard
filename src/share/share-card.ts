/**
 * What a link to the dashboard shows when it's pasted into a chat or a post (Open Graph and
 * Twitter card tags): a title, a line of headline numbers and a collage of recent covers.
 * Built from the data files as the public gets them, so it never says more than the page
 * would to someone who isn't signed in.
 */
import { PRIVATE_TITLE } from '../privacy/privacy';

type Row = Record<string, unknown>;

export const SITE_NAME = 'Reading history';
export const GENERIC_DESCRIPTION = 'A self-hosted reading history.';

export interface ShareCard {
  title: string;
  description: string;
  /** Book ids for the collage, most recent first: finished reads, then anything read. */
  coverIds: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** 9.2 million, 312,000 */
function bigNumber(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} million`;
  return Math.round(n).toLocaleString('en-GB');
}

/**
 * The card for the dashboard's data: `books` and `reads` as data/books.json and
 * data/reads.json have them for the public, and the day the data runs to (YYYY-MM-DD).
 */
export function shareCard(booksIn: unknown, readsIn: unknown, asOf: string | null): ShareCard {
  const books = rows(booksIn);
  const reads = rows(readsIn);
  const byId = new Map(books.map((b) => [str(b.id), b]));
  const finished = reads
    .filter((r) => r.finished === true && str(r.end))
    .sort((a, b) => (str(a.end) < str(b.end) ? 1 : str(a.end) > str(b.end) ? -1 : 0));
  const year =
    (asOf ?? '').slice(0, 4) ||
    str(finished[0]?.end).slice(0, 4) ||
    String(new Date().getFullYear());

  const finishedBooks = books.filter((b) => b.status === 'finished').length;
  const thisYear = finished.filter((r) => str(r.end).slice(0, 4) === year).length;
  const hours = Math.round(books.reduce((a, b) => a + num(b.hours), 0));
  const words = books.reduce((a, b) => a + num(b.words), 0);
  const authors = new Set(books.map((b) => str(b.author).trim().toLowerCase()).filter(Boolean));

  const title = finishedBooks
    ? `${SITE_NAME}: ${plural(finishedBooks, 'book')} finished`
    : SITE_NAME;
  const facts = [
    thisYear ? `${plural(thisYear, 'book')} finished in ${year}` : '',
    hours ? `${plural(hours, 'hour')} read` : '',
    words ? `${bigNumber(words)} words` : '',
    authors.size ? plural(authors.size, 'author') : '',
  ].filter(Boolean);
  const latest = finished
    .slice(0, 3)
    .map((r) => {
      const t = str(r.title);
      const a = str(r.author);
      if (t === PRIVATE_TITLE) return '';
      return t && a ? `${t} by ${a}` : t;
    })
    .filter(Boolean);
  const description =
    (facts.length ? `${facts.join(' · ')}.` : GENERIC_DESCRIPTION) +
    (latest.length ? ` Lately: ${latest.join('; ')}.` : '');

  const coverIds: string[] = [];
  const add = (id: string) => id && !coverIds.includes(id) && byId.has(id) && coverIds.push(id);
  finished.forEach((r) => add(str(r.book_id)));
  books
    .filter((b) => str(b.last_read))
    .sort((a, b) => (str(a.last_read) < str(b.last_read) ? 1 : -1))
    .forEach((b) => add(str(b.id)));
  return { title, description, coverIds };
}

export interface ShareTags {
  title: string;
  description: string;
  /** The page's own address, absolute, or null when it isn't known. */
  url: string | null;
  /** The collage's address (absolute for the tags to work everywhere), or null for none. */
  image: string | null;
  imageAlt?: string;
}

/** The <meta> tags for the page's <head>. */
export function shareTags(t: ShareTags): string {
  const tags: [string, string, string][] = [
    ['name', 'description', t.description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', SITE_NAME],
    ['property', 'og:title', t.title],
    ['property', 'og:description', t.description],
  ];
  if (t.url) tags.push(['property', 'og:url', t.url]);
  if (t.image) {
    tags.push(
      ['property', 'og:image', t.image],
      ['property', 'og:image:type', 'image/jpeg'],
      ['property', 'og:image:width', '1200'],
      ['property', 'og:image:height', '630'],
      ['property', 'og:image:alt', t.imageAlt ?? 'Covers of recently read books'],
    );
  }
  tags.push(
    ['name', 'twitter:card', t.image ? 'summary_large_image' : 'summary'],
    ['name', 'twitter:title', t.title],
    ['name', 'twitter:description', t.description],
  );
  if (t.image) tags.push(['name', 'twitter:image', t.image]);
  return tags.map(([k, n, v]) => `<meta ${k}="${n}" content="${escapeAttribute(v)}">`).join('\n');
}

/** Puts the tags in a page's <head>, straight after its <title>. */
export function withShareTags(page: string, tags: string): string {
  return page.replace('</title>', `</title>\n${tags}`);
}

export function escapeAttribute(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
