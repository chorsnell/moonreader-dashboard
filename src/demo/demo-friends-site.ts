import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FriendProfile } from '../friends/friend-store.service';
import { publicProfile } from '../friends/friends.controller';
import { BUNDLE_PARTS, LEADERBOARD_STATS, parseBundle, type Row } from '../friends/share';
import { CURRENT } from './demo-books';
import { FRIEND_PLANS, simulateFriend } from './demo-friends';

const BUDDY_GENRES = new Set(['Mystery', 'Horror', 'Science Fiction']);

/**
 * The demo's friends in the library, as the server keeps friends: library/friends/<slug>/
 * with their share file's parts and profile.json. Reads your imported data to line their
 * reading up with yours.
 */
export async function writeDemoFriends(
  lib: string,
  firstDay: number,
  lastDay: number,
): Promise<void> {
  const read = async (f: string) =>
    JSON.parse(await readFile(join(lib, 'data', f), 'utf8')) as Row[];
  const owner = { books: await read('books.json'), reads: await read('reads.json') };
  // the buddy read: the last mystery, horror or science fiction book you finished
  const buddy = owner.reads
    .filter((r) => r.finished === true && BUDDY_GENRES.has(String(r.genre)))
    .sort((a, b) => (String(a.end) < String(b.end) ? 1 : -1))[0];
  for (const plan of FRIEND_PLANS) {
    const bundle = parseBundle(
      simulateFriend(plan, owner, firstDay, lastDay, {
        buddy: plan.slug === 'ada' ? (buddy?.title as string | undefined) : undefined,
        current: CURRENT,
      }),
    );
    const dir = join(lib, 'friends', plan.slug);
    await mkdir(dir, { recursive: true });
    for (const part of ['books', 'reads', 'daily'] as const) {
      await writeFile(join(dir, `${part}.json`), JSON.stringify(bundle[part]));
    }
    const profile: FriendProfile = {
      slug: plan.slug,
      name: plan.name,
      source: 'upload',
      added: bundle.profile.generated ?? '',
      updated: bundle.profile.generated,
      generated: bundle.profile.generated,
      leaderboards: bundle.profile.leaderboards,
      privacy: bundle.privacy,
      parts: ['books', 'reads', 'daily'],
      books: bundle.books.length,
    };
    await writeFile(join(dir, 'profile.json'), JSON.stringify(profile));
  }
}

/**
 * The library's friends as static files for the demo site: data/friends.json and
 * friends/<slug>/*.json, the same URLs the server answers on. Returns their names.
 */
export async function writeStaticFriends(lib: string, out: string): Promise<string[]> {
  const profiles: FriendProfile[] = [];
  for (const slug of (await readdir(join(lib, 'friends')).catch(() => [] as string[])).sort()) {
    const dir = join(lib, 'friends', slug);
    const profile = JSON.parse(await readFile(join(dir, 'profile.json'), 'utf8')) as FriendProfile;
    await mkdir(join(out, 'friends', slug), { recursive: true });
    for (const part of BUNDLE_PARTS.filter((p) => profile.parts.includes(p))) {
      await writeFile(
        join(out, 'friends', slug, `${part}.json`),
        await readFile(join(dir, `${part}.json`)),
      );
    }
    profiles.push(profile);
  }
  await writeFile(
    join(out, 'data', 'friends.json'),
    JSON.stringify({
      me: { name: 'You', leaderboards: LEADERBOARD_STATS },
      friends: profiles.map(publicProfile),
    }),
  );
  return profiles.map((p) => p.name);
}
