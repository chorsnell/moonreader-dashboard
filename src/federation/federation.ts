/**
 * Federation (BOO-59): one installation following another. The one followed (the host)
 * approves each follower and chooses what it gets; the follower pulls the host's share
 * bundle with a bearer token issued on approval. See docs/friends.md for the protocol.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { BundlePart } from '../friends/share';

/** What a follower may have. */
export type Scope = 'everything' | 'stats' | 'views';
/** The views a host can share one by one, each a part of the bundle (books always go). */
export const VIEWS = ['reads', 'daily', 'highlights', 'leaderboards'] as const;
export type View = (typeof VIEWS)[number];

/** Someone following you, as the host keeps them. */
export interface Follower {
  id: string;
  name: string;
  url: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  requested: string;
  decided: string | null;
  /** sha256 of the follower's claim secret, to collect the token with. */
  claim_hash: string;
  /** sha256 of the bearer token issued on approval. */
  token_hash: string | null;
  /** The token itself, only until the follower collects it. */
  pickup: string | null;
  scope: Scope;
  views: View[];
  hidden_books: string[];
  last_pull: string | null;
}

/** Someone you follow, as the follower keeps them. */
export interface Following {
  slug: string;
  url: string;
  /** Their request id on the host. */
  request_id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  claim: string;
  token: string | null;
  added: string;
}

export interface FederationFile {
  followers: Follower[];
  following: Following[];
}

/** The most follow requests waiting at once, so strangers can't fill the file. */
export const MAX_PENDING = 50;

export const newSecret = () => randomBytes(32).toString('base64url');
export const newId = () => randomBytes(9).toString('base64url');
export const hashSecret = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Whether `given` hashes to `hash`, in constant time. */
export function matchesHash(given: string, hash: string | null): boolean {
  if (!hash || !given) return false;
  const a = Buffer.from(hashSecret(given), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** An installation's base URL: http(s), no query or fragment, no trailing slash. */
export function normaliseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/index\.html$/, '')}`;
}

/** The bundle parts and leaderboards a follower gets. */
export function scopeParts(f: Pick<Follower, 'scope' | 'views'>): {
  parts: BundlePart[];
  leaderboards: boolean;
} {
  if (f.scope === 'everything') {
    return { parts: ['books', 'reads', 'daily', 'highlights'], leaderboards: true };
  }
  if (f.scope === 'stats') return { parts: ['books', 'reads'], leaderboards: true };
  const v = new Set(f.views);
  const parts: BundlePart[] = ['books'];
  for (const p of ['reads', 'daily', 'highlights'] as const) if (v.has(p)) parts.push(p);
  return { parts, leaderboards: v.has('leaderboards') };
}

/** A scope change from the admin's request body. */
export function toScope(body: unknown): Pick<Follower, 'scope' | 'views' | 'hidden_books'> {
  const o =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const scope: Scope = o.scope === 'stats' || o.scope === 'views' ? o.scope : 'everything';
  const views = Array.isArray(o.views)
    ? VIEWS.filter((v) => (o.views as unknown[]).includes(v))
    : [];
  const hidden = Array.isArray(o.hidden_books)
    ? [...new Set(o.hidden_books.filter((x): x is string => typeof x === 'string'))]
        .map((x) => x.slice(0, 200))
        .slice(0, 2000)
    : [];
  return { scope, views, hidden_books: hidden };
}

/** A follower without its secrets, for the admin page. */
export function publicFollower(f: Follower) {
  return {
    id: f.id,
    name: f.name,
    url: f.url,
    status: f.status,
    requested: f.requested,
    decided: f.decided,
    scope: f.scope,
    views: f.views,
    hidden_books: f.hidden_books,
    last_pull: f.last_pull,
    collected: f.status === 'approved' && f.pickup === null,
  };
}
