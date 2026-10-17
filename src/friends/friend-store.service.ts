import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { localDateTime } from '../common/time';
import { LibraryService } from '../library/library.service';
import {
  BUNDLE_PARTS,
  slugify,
  SLUG,
  type BundlePart,
  type LeaderboardStat,
  type ShareBundle,
} from './share';

/** Where a friend's data came from. */
export type FriendSource = 'upload' | 'federation';

/** library/friends/<slug>/profile.json: who the friend is and how fresh their data is. */
export interface FriendProfile {
  slug: string;
  name: string;
  source: FriendSource;
  /** When they were added here. */
  added: string;
  /** When their data here was last refreshed. */
  updated: string | null;
  /** When their own data was built, as they shared it. */
  generated: string | null;
  leaderboards: LeaderboardStat[];
  privacy: ShareBundle['privacy'];
  /** The data files they shared. */
  parts: BundlePart[];
  books: number;
  /** Federation: their installation, and whether the last refresh worked. */
  url?: string;
  status?: 'ok' | 'pending' | 'offline' | 'revoked' | 'rejected';
  last_checked?: string | null;
  last_error?: string | null;
}

/** Files a friend's folder may serve, beyond the bundle parts (clubs from BOO-58). */
export const FRIEND_FILES = new Set([...BUNDLE_PARTS.map((p) => `${p}.json`), 'clubs.json']);

/** Friends' data in library/friends/<slug>/: the same files the page reads for you. */
@Injectable()
export class FriendStore {
  readonly root: string;
  private writing = Promise.resolve();

  constructor(library: LibraryService) {
    this.root = join(library.root, 'friends');
  }

  dir(slug: string): string {
    if (!SLUG.test(slug)) throw new Error(`bad friend slug ${slug}`);
    return join(this.root, slug);
  }

  async list(): Promise<FriendProfile[]> {
    const names = await readdir(this.root).catch(() => [] as string[]);
    const out: FriendProfile[] = [];
    for (const slug of names.filter((n) => SLUG.test(n)).sort()) {
      const p = await this.profile(slug);
      if (p) out.push(p);
    }
    return out;
  }

  async profile(slug: string): Promise<FriendProfile | null> {
    if (!SLUG.test(slug)) return null;
    try {
      return JSON.parse(
        await readFile(join(this.dir(slug), 'profile.json'), 'utf8'),
      ) as FriendProfile;
    } catch {
      return null;
    }
  }

  /** A friend's file as stored, or null. */
  async file(slug: string, name: string): Promise<string | null> {
    if (!SLUG.test(slug) || !FRIEND_FILES.has(name)) return null;
    return readFile(join(this.dir(slug), name), 'utf8').catch(() => null);
  }

  /** A slug for a new friend called `name`, not clashing with anyone else's. */
  async freeSlug(name: string, reuse?: (p: FriendProfile) => boolean): Promise<string> {
    const base = slugify(name);
    for (let i = 1; ; i++) {
      const slug = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
      const had = await this.profile(slug);
      if (!had || reuse?.(had)) return slug;
    }
  }

  /** Saves a friend's bundle (replacing what they had), then their profile. */
  async save(
    slug: string,
    bundle: ShareBundle,
    extra: Partial<FriendProfile> & { source: FriendSource; name: string },
  ): Promise<FriendProfile> {
    const dir = this.dir(slug);
    const run = this.writing.then(async () => {
      await mkdir(dir, { recursive: true });
      const had = await this.profile(slug);
      const parts = BUNDLE_PARTS.filter((p) => p !== 'highlights' || bundle.highlights);
      for (const part of BUNDLE_PARTS) {
        const rows = bundle[part];
        if (rows) await this.write(join(dir, `${part}.json`), rows);
        else await rm(join(dir, `${part}.json`), { force: true });
      }
      const profile: FriendProfile = {
        ...had,
        slug,
        added: had?.added ?? localDateTime(),
        updated: localDateTime(),
        generated: bundle.profile.generated,
        leaderboards: bundle.profile.leaderboards,
        privacy: bundle.privacy,
        parts,
        books: bundle.books.length,
        ...extra,
      };
      await this.write(join(dir, 'profile.json'), profile);
      return profile;
    });
    this.writing = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Changes a friend's profile only (a federation status, say). */
  async patch(slug: string, change: Partial<FriendProfile>): Promise<FriendProfile | null> {
    const run = this.writing.then(async () => {
      const had = await this.profile(slug);
      if (!had) return null;
      const next = { ...had, ...change, slug };
      await this.write(join(this.dir(slug), 'profile.json'), next);
      return next;
    });
    this.writing = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Writes another file into a friend's folder (clubs.json). */
  async writeFile(slug: string, name: string, data: unknown): Promise<void> {
    if (!FRIEND_FILES.has(name)) throw new Error(`not a friend file: ${name}`);
    await mkdir(this.dir(slug), { recursive: true });
    await this.write(join(this.dir(slug), name), data);
  }

  async remove(slug: string): Promise<boolean> {
    if (!(await this.profile(slug))) return false;
    await rm(this.dir(slug), { recursive: true, force: true });
    return true;
  }

  private async write(path: string, data: unknown): Promise<void> {
    await writeFile(`${path}.part`, JSON.stringify(data), 'utf8');
    await rename(`${path}.part`, path);
  }
}
