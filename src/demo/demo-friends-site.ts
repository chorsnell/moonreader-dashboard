import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FriendProfile } from '../friends/friend-store.service';
import { publicProfile } from '../friends/friends.controller';
import { BUNDLE_PARTS, LEADERBOARD_STATS, parseBundle, type Row } from '../friends/share';
import { clubFor, progressOf, sameBook, type Club } from '../clubs/clubs';
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
      simulateFriend(plan, owner, firstDay, lastDay - (plan.offline_days ?? 0), {
        buddy: plan.slug === 'ada' ? (buddy?.title as string | undefined) : undefined,
        current: CURRENT,
      }),
    );
    // Ada shares her highlights: two of yours from the buddy read, so the club has passages
    // you both marked
    if (plan.slug === 'ada' && buddy) {
      const mine = (await read('highlights.json').catch(() => [] as Row[])).filter(
        (h) => h.book_id === buddy.book_id && h.text,
      );
      bundle.highlights = mine.slice(0, 2).map((h, i) => ({ ...h, id: i + 1, note: null }));
      bundle.privacy.hidden = bundle.privacy.hidden.filter((x) => x !== 'highlights');
    }
    const parts = BUNDLE_PARTS.filter((p) => bundle[p]);
    const dir = join(lib, 'friends', plan.slug);
    await mkdir(dir, { recursive: true });
    for (const part of parts) {
      await writeFile(join(dir, `${part}.json`), JSON.stringify(bundle[part]));
    }
    const profile: FriendProfile = {
      slug: plan.slug,
      name: plan.name,
      source: plan.url ? 'federation' : 'upload',
      added: bundle.profile.generated ?? '',
      updated: bundle.profile.generated,
      generated: bundle.profile.generated,
      leaderboards: bundle.profile.leaderboards,
      privacy: bundle.privacy,
      parts,
      books: bundle.books.length,
      // followed on their own dashboard, which hasn't answered lately: shown as last seen
      ...(plan.url
        ? { url: plan.url, status: plan.offline_days ? 'offline' : 'ok', last_checked: null }
        : {}),
    };
    await writeFile(join(dir, 'profile.json'), JSON.stringify(profile));
  }
  if (buddy) await writeDemoClubs(lib, owner.reads, String(buddy.title));
}

/**
 * Two book clubs you host, as library/clubs.json: one under way on the book you're reading
 * (you, Ada and Ben, 10% a week), with comments either side of where you are; and the buddy
 * read with Ada, finished.
 */
async function writeDemoClubs(lib: string, reads: Row[], buddy: string): Promise<void> {
  const books = JSON.parse(await readFile(join(lib, 'data', 'books.json'), 'utf8')) as Row[];
  const club = (title: string, id: string, pct: number | null, members: string[]) => {
    const b = books.find((x) => x.title === title)!;
    const r = reads
      .filter((x) => x.title === title)
      .sort((x, y) => (x.start! < y.start! ? 1 : -1))[0];
    const start = String(r.start);
    const at = (days: number, h: number) =>
      `${new Date(Date.parse(start) + days * 86_400_000).toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:15:00`;
    const people: Record<string, string> = { me: 'You', ada: 'Ada', ben: 'Ben' };
    return {
      club: {
        id,
        book: {
          title,
          author: String(b.author),
          isbn13: (b.isbn13 as string | null) ?? null,
          work_id: null,
          book_id: String(b.id),
        },
        members: members.map((m) => ({
          key: m === 'me' ? 'me' : `friend:${m}`,
          name: people[m],
          friend: m === 'me' ? null : m,
          follower: null,
        })),
        start,
        pct_per_week: pct,
        created: at(-2, 20),
        comments: [] as Record<string, unknown>[],
      },
      say(who: string, position: number, text: string, day: number) {
        this.club.comments.push({
          id: `${id}-${this.club.comments.length + 1}`,
          member: who === 'me' ? 'me' : `friend:${who}`,
          name: people[who],
          position,
          text,
          created: at(day, 21),
        });
        return this;
      },
    };
  };
  const now = club(CURRENT, 'monte-cristo', 10, ['me', 'ada', 'ben'])
    .say('ada', 6, 'The wedding feast turning into an arrest: what an opening.', 1)
    .say('me', 12, 'Poor Mercédès. Danglars is the worst of them.', 3)
    .say('ben', 15, 'Going slowly, but the Château d’If chapters are gripping.', 9)
    .say('ada', 24, 'The Abbé Faria is my favourite character so far.', 4)
    .say('me', 36, 'The treasure! Finally.', 20)
    .say('ada', 55, 'I did not see who the Count would visit first. Brilliant.', 12)
    .say('ada', 66, 'The Roman carnival section drags a little, push through.', 18);
  const done = club(buddy, 'buddy-read', 25, ['me', 'ada'])
    .say('me', 15, 'Love how matter-of-fact the narrator is.', 1)
    .say('ada', 48, 'The Thunder Child scene!', 2)
    .say('me', 90, 'Didn’t expect that ending, but it fits.', 4)
    .say('ada', 100, 'Same time next month? Something by Wells again?', 4);
  await writeFile(
    join(lib, 'clubs.json'),
    JSON.stringify({ clubs: [now.club, done.club] }, null, 2),
  );
}

/** The clubs as /api/clubs answers the owner, for the static demo. */
export async function writeStaticClubs(lib: string, out: string): Promise<void> {
  let clubs: Club[] = [];
  try {
    clubs = (JSON.parse(await readFile(join(lib, 'clubs.json'), 'utf8')) as { clubs: Club[] })
      .clubs;
  } catch {
    // none
  }
  const books = JSON.parse(await readFile(join(lib, 'data', 'books.json'), 'utf8')) as Row[];
  const shown = clubs.map((c) => clubFor(c, progressOf(sameBook(books, c.book))));
  await mkdir(join(out, 'api'), { recursive: true });
  await writeFile(join(out, 'api', 'clubs'), JSON.stringify({ clubs: shown }));
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
