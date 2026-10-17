import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { localDateTime } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { progressOf, sameBook, type ClubBook } from '../clubs/clubs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FriendStore } from '../friends/friend-store.service';
import { MAX_BUNDLE_BYTES } from '../friends/friends.controller';
import { BundleError, cleanName, parseBundle, slugify } from '../friends/share';
import { newSecret, type Following } from './federation';
import { FederationStore } from './federation.store';

const TIMEOUT_MS = 20_000;

export class FollowError extends Error {}

/** A short reason a request to a friend's server failed. */
function why(e: unknown): string {
  if (e instanceof Error && e.name === 'TimeoutError') return 'it took too long to answer';
  if (e instanceof BundleError) return e.message;
  const cause = (e as { cause?: { code?: string } })?.cause?.code;
  return cause ? `couldn't connect (${cause})` : e instanceof Error ? e.message : String(e);
}

/**
 * The follower's side of federation: asking to follow a friend's installation, collecting
 * the token once they approve, and pulling their share bundle into library/friends/<slug>/
 * now and then. A friend who revokes access disappears; one whose server is down stays, as
 * last seen, marked offline.
 */
@Injectable()
export class FederationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(FederationService.name);
  private timer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfigType,
    private readonly store: FederationStore,
    private readonly friends: FriendStore,
    private readonly activity: ActivityLogService,
    private readonly library: LibraryService,
  ) {}

  onModuleInit(): void {
    const minutes = this.config.federationRefreshMinutes;
    if (minutes > 0) {
      this.timer = setInterval(() => void this.refreshAll(), minutes * 60_000);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Asks the installation at `url` to let you follow it. */
  async follow(url: string, me: { name: string; url: string }): Promise<Following> {
    const had = (await this.store.read()).following.find((f) => f.url === url);
    if (had && had.status !== 'revoked' && had.status !== 'rejected') {
      throw new FollowError('You already follow that dashboard.');
    }
    const claim = newSecret();
    let res: Response;
    try {
      res = await fetch(`${url}/api/federation/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: me.name, url: me.url, claim }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (e) {
      throw new FollowError(`That dashboard didn't answer: ${why(e)}.`);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: unknown; error?: unknown };
    if (!res.ok || typeof body.id !== 'string') {
      throw new FollowError(
        typeof body.error === 'string'
          ? `That dashboard said: ${body.error}`
          : `That doesn't look like a reading dashboard that takes follow requests (HTTP ${res.status}).`,
      );
    }
    const host = new URL(url).host;
    const following = await this.store.update(async (f) => {
      f.following = f.following.filter((x) => x.url !== url);
      const taken = new Set(f.following.map((x) => x.slug));
      let slug = await this.friends.freeSlug(
        host,
        (p) => p.source === 'federation' && p.url === url,
      );
      for (let i = 2; taken.has(slug); i++) slug = `${slugify(host).slice(0, 36)}-${i}`;
      const entry: Following = {
        slug,
        url,
        request_id: body.id as string,
        name: host,
        status: 'pending',
        claim,
        token: null,
        added: localDateTime(),
      };
      f.following.push(entry);
      return entry;
    });
    this.activity.record({
      type: 'friends',
      message: `Asked to follow ${url}`,
      trigger: 'admin',
      details: { url },
    });
    return following;
  }

  /** Stops following: forgets the token and their data. */
  async unfollow(slug: string): Promise<boolean> {
    const gone = await this.store.update((f) => {
      const had = f.following.find((x) => x.slug === slug);
      f.following = f.following.filter((x) => x.slug !== slug);
      return had;
    });
    if (!gone) return false;
    const p = await this.friends.profile(slug);
    if (p?.source === 'federation') await this.friends.remove(slug);
    this.activity.record({
      type: 'friends',
      message: `Stopped following ${gone.url}`,
      trigger: 'admin',
      details: { url: gone.url },
    });
    return true;
  }

  /** Refreshes everyone you follow (one run at a time). */
  refreshAll(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        for (const f of (await this.store.read()).following) await this.refresh(f.slug);
      } catch (e) {
        this.log.warn(`refreshing friends failed: ${String(e)}`);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Collects the token if they've approved, then pulls their data. */
  async refresh(slug: string): Promise<Following | null> {
    let f = (await this.store.read()).following.find((x) => x.slug === slug);
    if (!f) return null;
    if (!f.token && f.status === 'pending') f = await this.collect(f);
    if (f.token) await this.pull(f);
    return (await this.store.read()).following.find((x) => x.slug === slug) ?? null;
  }

  private async set(slug: string, change: Partial<Following>): Promise<Following> {
    return this.store.update((file) => {
      const f = file.following.find((x) => x.slug === slug);
      if (!f) throw new Error(`not following ${slug}`);
      Object.assign(f, change);
      return { ...f };
    });
  }

  private async collect(f: Following): Promise<Following> {
    let res: Response;
    try {
      res = await fetch(
        `${f.url}/api/federation/follow/${encodeURIComponent(f.request_id)}/status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claim: f.claim }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'error',
        },
      );
    } catch {
      return f; // try again next time
    }
    if (res.status === 404) return this.set(f.slug, { status: 'rejected' });
    if (!res.ok) return f;
    const body = (await res.json().catch(() => ({}))) as {
      status?: unknown;
      token?: unknown;
      name?: unknown;
    };
    const name = typeof body.name === 'string' && body.name ? cleanName(body.name) : f.name;
    if (body.status === 'approved' && typeof body.token === 'string') {
      this.activity.record({
        type: 'friends',
        message: `${name} (${f.url}) approved your follow request`,
        trigger: 'sync',
        details: { url: f.url },
      });
      return this.set(f.slug, { status: 'approved', token: body.token, name });
    }
    if (body.status === 'rejected' || body.status === 'revoked') {
      return this.set(f.slug, { status: body.status, name });
    }
    return name !== f.name ? this.set(f.slug, { name }) : f;
  }

  private async pull(f: Following): Promise<void> {
    const now = localDateTime();
    let res: Response | null = null;
    let failure = '';
    try {
      res = await fetch(`${f.url}/api/federation/share`, {
        headers: { Authorization: `Bearer ${f.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (e) {
      failure = why(e);
    }
    if (res && (res.status === 401 || res.status === 403)) {
      // revoked: stop showing them straight away
      await this.set(f.slug, { status: 'revoked', token: null });
      const p = await this.friends.profile(f.slug);
      if (p?.source === 'federation') await this.friends.remove(f.slug);
      this.activity.record({
        type: 'friends',
        message: `${f.name} (${f.url}) stopped sharing with you`,
        trigger: 'sync',
        details: { url: f.url },
      });
      return;
    }
    if (res && res.ok) {
      try {
        const size = Number(res.headers.get('content-length') ?? 0);
        if (size > MAX_BUNDLE_BYTES) throw new BundleError('Their share is too large.');
        const bundle = parseBundle(JSON.parse(await res.text()));
        await this.friends.save(f.slug, bundle, {
          source: 'federation',
          name: bundle.profile.name,
          url: f.url,
          status: 'ok',
          last_checked: now,
          last_error: null,
        });
        if (bundle.profile.name !== f.name) await this.set(f.slug, { name: bundle.profile.name });
        await this.pullClubs(f).catch((e: unknown) =>
          this.log.warn(`clubs from ${f.url}: ${String(e)}`),
        );
        return;
      } catch (e) {
        failure = why(e);
      }
    } else if (res) failure = `HTTP ${res.status}`;
    // offline or broken: keep what we had, say so
    const had = await this.friends.patch(f.slug, {
      status: 'offline',
      last_checked: now,
      last_error: failure,
    });
    this.activity.record({
      type: 'friends',
      message: `Couldn't refresh ${f.name} (${f.url})${had ? ', showing what was there before' : ''}`,
      outcome: 'failed',
      trigger: 'sync',
      error: failure,
      details: { url: f.url },
    });
  }

  /**
   * The book clubs they host that you're in, with comments shown up to how far you are in
   * each book: asked once to learn the books, then again with your progress.
   */
  private async pullClubs(f: Following): Promise<void> {
    const get = async (progress?: Record<string, number>) => {
      const q = progress ? `?progress=${encodeURIComponent(JSON.stringify(progress))}` : '';
      const res = await fetch(`${f.url}/api/federation/clubs${q}`, {
        headers: { Authorization: `Bearer ${f.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!res.ok) return null; // an older dashboard without clubs
      const body = (await res.json()) as { clubs?: { id: string; book: ClubBook }[] };
      return Array.isArray(body.clubs) ? body.clubs : null;
    };
    const first = await get();
    if (!first) return;
    let clubs = first;
    if (first.length) {
      let books: Record<string, unknown>[] = [];
      try {
        books = JSON.parse(await readFile(join(this.library.data, 'books.json'), 'utf8')) as Record<
          string,
          unknown
        >[];
      } catch {
        // no data of your own yet
      }
      const progress = Object.fromEntries(
        first.map((c) => [c.id, progressOf(sameBook(books, c.book))]),
      );
      clubs = (await get(progress)) ?? first;
    }
    await this.friends.writeFile(f.slug, 'clubs.json', clubs);
    await this.friends.patch(f.slug, { clubs: clubs.length });
  }

  /** Posts your comment to a club a friend hosts, then fetches the club again. */
  async postClubComment(slug: string, clubId: string, body: unknown): Promise<unknown> {
    const f = (await this.store.read()).following.find((x) => x.slug === slug);
    if (!f?.token) throw new FollowError('You don’t follow that dashboard.');
    let res: Response;
    try {
      res = await fetch(`${f.url}/api/federation/clubs/${encodeURIComponent(clubId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.token}` },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (e) {
      throw new FollowError(`Their dashboard didn't answer: ${why(e)}.`);
    }
    const out = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (!res.ok) {
      throw new FollowError(typeof out.error === 'string' ? out.error : `HTTP ${res.status}`);
    }
    await this.pullClubs(f).catch(() => undefined);
    return out;
  }
}
