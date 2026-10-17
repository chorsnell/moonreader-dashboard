import {
  hashSecret,
  matchesHash,
  newSecret,
  normaliseUrl,
  scopeParts,
  toScope,
} from './federation';

describe('federation', () => {
  it('tidies installation addresses and refuses odd ones', () => {
    expect(normaliseUrl('https://reading.example.com/')).toBe('https://reading.example.com');
    expect(normaliseUrl(' https://example.com/reading/index.html ')).toBe(
      'https://example.com/reading',
    );
    expect(normaliseUrl('http://10.0.0.2:8080/?x=1#y')).toBe('http://10.0.0.2:8080');
    for (const bad of ['ftp://x', 'javascript:alert(1)', 'https://u:p@x.example', 'nope', 42]) {
      expect(normaliseUrl(bad)).toBeNull();
    }
  });

  it('maps what a follower may have onto the share', () => {
    expect(scopeParts({ scope: 'everything', views: [] })).toEqual({
      parts: ['books', 'reads', 'daily', 'highlights'],
      leaderboards: true,
    });
    expect(scopeParts({ scope: 'stats', views: ['daily'] })).toEqual({
      parts: ['books', 'reads'],
      leaderboards: true,
    });
    expect(scopeParts({ scope: 'views', views: ['daily'] })).toEqual({
      parts: ['books', 'daily'],
      leaderboards: false,
    });
    expect(
      toScope({ scope: 'views', views: ['daily', 'bogus'], hidden_books: ['a', 'a', 1] }),
    ).toEqual({ scope: 'views', views: ['daily'], hidden_books: ['a'] });
    expect(toScope(null).scope).toBe('everything');
  });

  it('checks secrets against their hashes only', () => {
    const s = newSecret();
    expect(matchesHash(s, hashSecret(s))).toBe(true);
    expect(matchesHash(`${s}x`, hashSecret(s))).toBe(false);
    expect(matchesHash('', hashSecret(''))).toBe(false);
    expect(matchesHash(s, null)).toBe(false);
  });
});
