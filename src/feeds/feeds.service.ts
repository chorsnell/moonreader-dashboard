import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { sameBook } from '../clubs/clubs';
import { ClubsService } from '../clubs/clubs.service';
import { localDate, localDateTime } from '../common/time';
import { CoverStore } from '../covers/cover-store.service';
import { hashSecret, matchesHash, newSecret } from '../federation/federation';
import { LibraryService } from '../library/library.service';
import { filterCovers, filterDataFile, type ViewerRole } from '../privacy/privacy';
import { PrivacyService } from '../privacy/privacy.service';
import {
  buildAtom,
  buildIcs,
  calendarEvents,
  FeedError,
  MAX_FEEDS,
  newFeedId,
  type ClubDates,
  type Feed,
  type FeedContext,
  type FeedData,
  type FeedsFile,
} from './feeds';

/** last_used is written at most this often, not on every poll. */
const USED_EVERY_MS = 60 * 60 * 1000;

type Row = Record<string, unknown>;

/**
 * library/feeds.json: the feeds the admin made, with hashes of their secrets (never the
 * secrets themselves). Readable by the owner only, and never served.
 */
@Injectable()
export class FeedsService {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly library: LibraryService,
    private readonly privacy: PrivacyService,
    private readonly settings: AccessSettingsService,
    private readonly covers: CoverStore,
    private readonly clubs: ClubsService,
  ) {
    this.file = join(library.root, 'feeds.json');
  }

  async list(): Promise<Feed[]> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<FeedsFile>;
      return Array.isArray(raw.feeds) ? raw.feeds : [];
    } catch {
      return [];
    }
  }

  private update<T>(fn: (feeds: Feed[]) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const feeds = await this.list();
      const out = fn(feeds);
      await writeFile(`${this.file}.part`, JSON.stringify({ feeds }, null, 2), { mode: 0o600 });
      await rename(`${this.file}.part`, this.file);
      await chmod(this.file, 0o600).catch(() => undefined);
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** A new feed and its secret, which is only ever shown now. */
  async create(
    input: Pick<Feed, 'kind' | 'audience' | 'name'>,
  ): Promise<{ feed: Feed; token: string }> {
    const token = newSecret();
    const feed: Feed = {
      ...input,
      id: newFeedId(),
      token_hash: hashSecret(token),
      created: localDateTime(),
      rotated: null,
      last_used: null,
    };
    await this.update((feeds) => {
      if (feeds.length >= MAX_FEEDS) throw new FeedError(`${MAX_FEEDS} feeds at most.`);
      feeds.push(feed);
    });
    return { feed, token };
  }

  /** A new secret for a feed: the old URL stops working at once. */
  async rotate(id: string): Promise<{ feed: Feed; token: string } | null> {
    const token = newSecret();
    const feed = await this.update((feeds) => {
      const f = feeds.find((x) => x.id === id);
      if (!f) return null;
      f.token_hash = hashSecret(token);
      f.rotated = localDateTime();
      f.last_used = null;
      return f;
    });
    return feed && { feed, token };
  }

  revoke(id: string): Promise<boolean> {
    return this.update((feeds) => {
      const i = feeds.findIndex((f) => f.id === id);
      if (i >= 0) feeds.splice(i, 1);
      return i >= 0;
    });
  }

  /** The feed a secret opens, or null. Checks every feed, in constant time each. */
  async byToken(token: string): Promise<Feed | null> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const feed = (await this.list()).find((f) => matchesHash(token, f.token_hash)) ?? null;
    if (feed && (!feed.last_used || Date.now() - Date.parse(feed.last_used) > USED_EVERY_MS)) {
      void this.update((feeds) => {
        const f = feeds.find((x) => x.id === feed.id);
        if (f) f.last_used = localDateTime();
      }).catch(() => undefined);
    }
    return feed;
  }

  // ---------- building them ----------

  /** The data files as the feed's audience is served them. */
  async data(audience: ViewerRole): Promise<FeedData> {
    const { privacy } = await this.settings.load();
    const policy = privacy[audience];
    const ctx = await this.privacy.context({ role: audience, preview: null, policy });
    if (!ctx) throw new Error('a feed always has an audience');
    const file = async (name: string): Promise<Row[]> => {
      try {
        const raw = JSON.parse(await readFile(join(this.library.data, name), 'utf8')) as unknown;
        const out = filterDataFile(name, raw, ctx);
        return Array.isArray(out) ? (out as Row[]) : [];
      } catch {
        return [];
      }
    };
    const [books, reads, daily] = await Promise.all([
      file('books.json'),
      file('reads.json'),
      file('daily.json'),
    ]);
    const meta = await this.library.meta();
    const generated = filterDataFile('meta.json', meta, ctx) as Row;
    return {
      books,
      reads,
      daily,
      dates: policy.dates,
      days: policy.diary && policy.streaks,
      covers: filterCovers(await this.covers.urls(), ctx),
      generated: typeof generated?.generated === 'string' ? generated.generated : null,
    };
  }

  /** Whether a cover may go in this audience's feed. */
  async coverAllowed(audience: ViewerRole, bookId: string): Promise<boolean> {
    const { privacy } = await this.settings.load();
    const ctx = await this.privacy.context({
      role: audience,
      preview: null,
      policy: privacy[audience],
    });
    return !!ctx && !ctx.private.has(bookId);
  }

  /**
   * The book clubs this audience may hear about: only when they may see friends' reading
   * (the same rule as /api/clubs) and what you're reading now, and never a private book's.
   */
  async clubDates(audience: ViewerRole): Promise<ClubDates[]> {
    const { privacy, friends } = await this.settings.load();
    const sees =
      audience === 'friends'
        ? false
        : friends.visible_to === 'public' ||
          (friends.visible_to === 'reader' && audience === 'reader');
    if (!sees || !privacy[audience].current) return [];
    const ctx = await this.privacy.context({
      role: audience,
      preview: null,
      policy: privacy[audience],
    });
    let books: Row[] = [];
    try {
      books = JSON.parse(await readFile(join(this.library.data, 'books.json'), 'utf8')) as Row[];
    } catch {
      // no data yet
    }
    return (await this.clubs.list())
      .filter((c) => {
        const mine =
          (c.book.book_id && books.find((b) => b.id === c.book.book_id)) || sameBook(books, c.book);
        const id = mine ? String(mine.id) : c.book.book_id;
        return !(id && ctx?.private.has(id));
      })
      .map((c) => ({
        id: c.id,
        title: c.book.title,
        author: c.book.author,
        start: c.start,
        pct_per_week: c.pct_per_week,
        members: c.members.length,
      }));
  }

  async atom(feed: Feed, ctx: FeedContext): Promise<string> {
    return buildAtom(await this.data(feed.audience), ctx);
  }

  async ical(feed: Feed, ctx: FeedContext): Promise<string> {
    const data = await this.data(feed.audience);
    const events = calendarEvents(data, await this.clubDates(feed.audience), ctx, localDate());
    return buildIcs(events, ctx.title, data.generated);
  }
}
