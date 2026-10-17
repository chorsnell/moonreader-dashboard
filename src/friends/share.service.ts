import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { localDate } from '../common/time';
import { LibraryService } from '../library/library.service';
import { buildContext, filterDataFile, hiddenCategories, type BookFacts } from '../privacy/privacy';
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  type BundlePart,
  type Row,
  type ShareBundle,
} from './share';

export interface ShareOptions {
  /** The parts this friend may have (default: all the friends policy allows). */
  parts?: readonly BundlePart[];
  /** Books left out for this friend, on top of your private books and genres. */
  hiddenBooks?: readonly string[];
  /** False to leave your leaderboard opt-ins out. */
  leaderboards?: boolean;
}

/**
 * Your data as friends get it: filtered by the friends privacy policy, then by what this
 * friend may see. It backs the bundle the admin exports and what followers pull
 * (GET /api/federation/share); server-side stats (BOO-56) can later sit behind the same
 * calls without changing the bundle.
 */
@Injectable()
export class ShareService {
  constructor(
    private readonly library: LibraryService,
    private readonly settings: AccessSettingsService,
  ) {}

  async bundle(opts: ShareOptions = {}): Promise<ShareBundle> {
    const { privacy, friends } = await this.settings.load();
    const policy = privacy.friends;
    const read = async (name: string): Promise<unknown> => {
      try {
        return JSON.parse(await readFile(join(this.library.data, name), 'utf8'));
      } catch {
        return null;
      }
    };
    const books = ((await read('books.json')) ?? []) as BookFacts[];
    const meta = ((await read('meta.json')) ?? {}) as Record<string, unknown>;
    const asOf = typeof meta.generated === 'string' ? meta.generated : localDate();
    const ctx = buildContext(policy, privacy, books, asOf);
    for (const id of opts.hiddenBooks ?? []) ctx.private.set(id, '');

    const allowed = new Set<BundlePart>(opts.parts ?? ['books', 'reads', 'daily', 'highlights']);
    const part = async (name: BundlePart): Promise<Row[] | undefined> => {
      if (name !== 'books' && !allowed.has(name)) return undefined;
      const data = name === 'books' ? books : await read(`${name}.json`);
      if (data === null) return undefined;
      const out = filterDataFile(`${name}.json`, data, ctx);
      return Array.isArray(out) ? (out as Row[]) : undefined;
    };
    const filteredMeta = filterDataFile('meta.json', meta, ctx) as Record<string, unknown>;
    const bundle: ShareBundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      profile: {
        name: friends.share_name || 'A friend',
        generated: typeof filteredMeta.generated === 'string' ? filteredMeta.generated : null,
        leaderboards: opts.leaderboards === false ? [] : friends.leaderboards,
      },
      privacy: {
        // what the policy hides, and what this friend doesn't get
        hidden: [
          ...new Set([
            ...hiddenCategories(policy),
            ...(allowed.has('daily') ? [] : ['diary']),
            ...(allowed.has('highlights') ? [] : ['highlights']),
          ]),
        ],
        dates: policy.dates,
      },
      books: (await part('books')) ?? [],
      reads: (await part('reads')) ?? [],
      daily: (await part('daily')) ?? [],
    };
    if (policy.highlights) {
      const highlights = await part('highlights');
      if (highlights) bundle.highlights = highlights;
    }
    return bundle;
  }
}
