import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FriendProfile } from '../friends/friend-store.service';
import { publicProfile } from '../friends/friends.controller';
import { LEADERBOARD_STATS, parseBundle, type Row } from '../friends/share';
import { FRIEND_PLANS, simulateFriend } from './demo-friends';

const BUDDY_GENRES = new Set(['Mystery', 'Horror', 'Science Fiction']);

/**
 * The demo's friends as static files: data/friends.json and friends/<slug>/*.json, the same
 * URLs the server answers on. Returns their names.
 */
export async function writeDemoFriends(
  out: string,
  firstDay: number,
  lastDay: number,
  current: string,
): Promise<string[]> {
  const read = async (f: string) =>
    JSON.parse(await readFile(join(out, 'data', f), 'utf8')) as Row[];
  const owner = { books: await read('books.json'), reads: await read('reads.json') };
  // the buddy read: the last mystery, horror or science fiction book you finished
  const buddy = owner.reads
    .filter((r) => r.finished === true && BUDDY_GENRES.has(String(r.genre)))
    .sort((a, b) => (String(a.end) < String(b.end) ? 1 : -1))[0];
  const profiles = [];
  for (const plan of FRIEND_PLANS) {
    const bundle = parseBundle(
      simulateFriend(plan, owner, firstDay, lastDay, {
        buddy: plan.slug === 'ada' ? (buddy?.title as string | undefined) : undefined,
        current,
      }),
    );
    const dir = join(out, 'friends', plan.slug);
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
    profiles.push(publicProfile(profile));
  }
  await writeFile(
    join(out, 'data', 'friends.json'),
    JSON.stringify({ me: { name: 'You', leaderboards: LEADERBOARD_STATS }, friends: profiles }),
  );
  return FRIEND_PLANS.map((p) => p.name);
}
