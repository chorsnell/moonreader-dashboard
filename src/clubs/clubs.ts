/**
 * Book clubs (BOO-58): a book read together, kept on the installation that started it (the
 * host) in library/clubs.json. Comments are pinned to a position in the book and only shown
 * to someone who has read that far: the filter here runs on every response.
 */
import { randomBytes } from 'node:crypto';

export interface ClubBook {
  title: string;
  author: string;
  isbn13: string | null;
  work_id: string | null;
  /** The host's own id for it. */
  book_id: string | null;
}

/** A member: the host's owner ('me'), or one of the host's friends. */
export interface ClubMember {
  key: string;
  name: string;
  /** The friend whose reading gives their progress lane (library/friends/<slug>). */
  friend: string | null;
  /** Their installation follows this one: they can read the club and comment from there. */
  follower: string | null;
}

export interface ClubComment {
  id: string;
  member: string;
  name: string;
  /** How far through the book it's about, 0–100. */
  position: number;
  text: string;
  created: string;
}

export interface Club {
  id: string;
  book: ClubBook;
  members: ClubMember[];
  start: string;
  /** The schedule: % of the book a week, or null for none. */
  pct_per_week: number | null;
  created: string;
  comments: ClubComment[];
}

/** A comment as a viewer gets it: its text only once they've read that far. */
export type ShownComment = Omit<ClubComment, 'text'> & { text: string | null; hidden: boolean };

export const MAX_COMMENT = 1000;
export const MAX_COMMENTS = 2000;
export const MAX_CLUBS = 100;

export const newClubId = () => randomBytes(6).toString('base64url');

export class ClubError extends Error {}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Same book, by ISBN or work id, else by title and author ignoring case and punctuation. */
export function bookKeys(b: {
  title?: unknown;
  author?: unknown;
  isbn13?: unknown;
  work_id?: unknown;
}): string[] {
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
}

export function sameBook<T extends Parameters<typeof bookKeys>[0]>(
  books: T[],
  want: Parameters<typeof bookKeys>[0],
): T | null {
  const keys = new Set(bookKeys(want));
  return books.find((b) => bookKeys(b).some((k) => keys.has(k))) ?? null;
}

/** How far someone is through a book from their books.json row (100 once finished). */
export function progressOf(row: { status?: unknown; progress?: unknown } | null): number {
  if (!row) return 0;
  if (row.status === 'finished') return 100;
  return typeof row.progress === 'number' ? Math.max(0, Math.min(100, row.progress)) : 0;
}

/** The comments a viewer `at` this far may read; later ones keep only where they are. */
export function shownComments(club: Club, at: number): ShownComment[] {
  return club.comments
    .slice()
    .sort((a, b) => a.position - b.position || (a.created < b.created ? -1 : 1))
    .map((c) =>
      c.position <= at + 1e-9 ? { ...c, hidden: false } : { ...c, text: null, hidden: true },
    );
}

/** A club for a viewer: members without follower ids, comments spoiler-safe. */
export function clubFor(club: Club, at: number) {
  return {
    id: club.id,
    book: club.book,
    members: club.members.map(({ key, name, friend }) => ({ key, name, friend })),
    start: club.start,
    pct_per_week: club.pct_per_week,
    created: club.created,
    progress: at,
    comments: shownComments(club, at),
  };
}

/** A new club from the admin's request: {book, members, start, pct_per_week}. */
export function toClubInput(body: unknown): Omit<Club, 'id' | 'created' | 'comments'> {
  const o = asObject(body);
  const b = asObject(o.book);
  const book: ClubBook = {
    title: text(b.title),
    author: text(b.author),
    isbn13: text(b.isbn13, 20) || null,
    work_id: text(b.work_id, 100) || null,
    book_id: text(b.book_id, 200) || null,
  };
  if (!book.title) throw new ClubError('Choose the book to read.');
  const start = text(o.start, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start))) {
    throw new ClubError('Give a start date.');
  }
  const pct = Number(o.pct_per_week);
  const members: ClubMember[] = [{ key: 'me', name: 'You', friend: null, follower: null }];
  const seen = new Set(['me']);
  for (const raw of Array.isArray(o.members) ? o.members.slice(0, 30) : []) {
    const m = asObject(raw);
    const friend = text(m.friend, 40) || null;
    const follower = text(m.follower, 40) || null;
    const key = friend ? `friend:${friend}` : follower ? `follower:${follower}` : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    members.push({ key, name: text(m.name, 60) || 'A friend', friend, follower });
  }
  return {
    book,
    members,
    start,
    pct_per_week: Number.isFinite(pct) && pct > 0 ? Math.min(100, Math.round(pct * 10) / 10) : null,
  };
}

/** {position, text} for a new comment. */
export function toComment(body: unknown): { position: number; text: string } {
  const o = asObject(body);
  const position = Number(o.position);
  const t = text(o.text, MAX_COMMENT);
  if (!t) throw new ClubError('Write something first.');
  if (!Number.isFinite(position) || position < 0 || position > 100) {
    throw new ClubError('Pin it to a position from 0 to 100%.');
  }
  return { position: Math.round(position * 10) / 10, text: t };
}
