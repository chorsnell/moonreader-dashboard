import { toFriendsSettings } from './friends-settings';
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  BundleError,
  cleanRow,
  parseBundle,
  slugify,
  SLUG,
} from './share';

const bundle = (extra: Record<string, unknown> = {}) => ({
  format: BUNDLE_FORMAT,
  version: BUNDLE_VERSION,
  profile: { name: '  Sam  Smith ', generated: '2026-03-01', leaderboards: ['books', 'nope'] },
  privacy: { hidden: ['money'], dates: 'week' },
  books: [{ id: 'emma', title: 'Emma', author: 'Jane Austen' }],
  reads: [{ book_id: 'emma', start: '2026-01-01', end: '2026-01-09', finished: true }],
  daily: [{ book_id: 'emma', date: '2026-01-01', minutes: 30 }],
  ...extra,
});

describe('share bundles', () => {
  it('reads a bundle, tidying the profile', () => {
    const b = parseBundle(bundle());
    expect(b.profile).toEqual({
      name: 'Sam Smith',
      generated: '2026-03-01',
      leaderboards: ['books'],
    });
    expect(b.privacy).toEqual({ hidden: ['money'], dates: 'week' });
    expect(b.books).toHaveLength(1);
    expect(b.highlights).toBeUndefined();
  });

  it('keeps only plain values in rows', () => {
    expect(
      cleanRow({
        id: 'x',
        n: 3,
        bad: Infinity,
        nested: { a: 1 },
        list: [1],
        'Bad Key': 1,
        __proto__x: 1,
        ok: null,
        yes: true,
        long: 'a'.repeat(5000),
      }),
    ).toEqual({ id: 'x', n: 3, ok: null, yes: true, long: 'a'.repeat(2000) });
    expect(cleanRow([1, 2])).toBeNull();
    expect(cleanRow('x')).toBeNull();
  });

  it('drops rows without what identifies them', () => {
    const b = parseBundle(
      bundle({
        books: [{ id: 'emma', title: 'Emma' }, { title: 'No id' }, 'junk'],
        daily: [{ book_id: 'emma' }, { book_id: 'emma', date: '2026-01-02' }],
      }),
    );
    expect(b.books.map((r) => r.id)).toEqual(['emma']);
    expect(b.daily).toHaveLength(1);
  });

  it('refuses what is not a bundle', () => {
    expect(() => parseBundle({})).toThrow(BundleError);
    expect(() => parseBundle(bundle({ version: 2 }))).toThrow(/newer version/);
    expect(() => parseBundle(bundle({ books: [] }))).toThrow(/no books/);
    expect(() => parseBundle(bundle({ reads: 'x' }))).toThrow(/should be a list/);
  });

  it('makes safe slugs', () => {
    expect(slugify('Zoë O’Brien')).toBe('zoe-o-brien');
    expect(slugify('!!!')).toBe('friend');
    expect(slugify('a'.repeat(80))).toHaveLength(40);
    for (const s of ['zoe-o-brien', 'friend', 'a'.repeat(40)]) expect(SLUG.test(s)).toBe(true);
    for (const s of ['../x', '-a', 'A', 'a/b', '']) expect(SLUG.test(s)).toBe(false);
  });

  it('defaults friends settings to sharing nothing extra', () => {
    expect(toFriendsSettings(undefined)).toEqual({
      visible_to: 'admin',
      share_name: '',
      leaderboards: [],
      accept_follows: true,
    });
    expect(
      toFriendsSettings({ visible_to: 'everyone', leaderboards: ['speed', 'x'] }),
    ).toMatchObject({
      visible_to: 'admin',
      leaderboards: ['speed'],
    });
  });
});
