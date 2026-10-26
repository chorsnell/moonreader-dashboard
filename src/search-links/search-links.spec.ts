import {
  fillTemplate,
  linksFor,
  MAX_LINKS,
  readSearchLinks,
  SearchLinkError,
  toSearchLinks,
} from './search-links';

describe('search links', () => {
  it('fills a template, URL-encoded, with the first author', () => {
    const book = {
      title: 'The Colour of Magic',
      author: 'Terry Pratchett & Someone',
      isbn: '9780552124751',
    };
    expect(fillTemplate('https://example.org/s?q={query}', book)).toBe(
      'https://example.org/s?q=The%20Colour%20of%20Magic%20Terry%20Pratchett',
    );
    expect(fillTemplate('https://example.org/{isbn}?t={title}&a={author}', book)).toBe(
      'https://example.org/9780552124751?t=The%20Colour%20of%20Magic&a=Terry%20Pratchett',
    );
    expect(fillTemplate('https://example.org/s?q={query}', { title: 'A&B?' })).toBe(
      'https://example.org/s?q=A%26B%3F',
    );
  });

  it('checks what the admin sends', () => {
    expect(
      toSearchLinks({
        links: [
          { name: ' Library ', url: 'https://library.example/search?q={query}', visitors: true },
          { name: 'Shop', url: 'http://shop.example/isbn/{isbn}' },
        ],
      }),
    ).toEqual([
      { name: 'Library', url: 'https://library.example/search?q={query}', visitors: true },
      { name: 'Shop', url: 'http://shop.example/isbn/{isbn}', visitors: false },
    ]);
    for (const bad of [
      {},
      { links: [{ name: '', url: 'https://x.example/{query}' }] },
      { links: [{ name: 'A', url: 'https://x.example/no-placeholder' }] },
      { links: [{ name: 'A', url: 'javascript:alert({query})' }] },
      { links: [{ name: 'A', url: 'not a url {query}' }] },
      {
        links: [
          { name: 'A', url: 'https://x.example/{query}' },
          { name: 'a', url: 'https://y.example/{query}' },
        ],
      },
      {
        links: Array.from({ length: MAX_LINKS + 1 }, (_, i) => ({
          name: `L${i}`,
          url: 'https://x.example/{query}',
        })),
      },
    ]) {
      expect(() => toSearchLinks(bad)).toThrow(SearchLinkError);
    }
  });

  it('reads saved links leniently and shows visitors only theirs', () => {
    const links = readSearchLinks([
      { name: 'Mine', url: 'https://a.example/{query}' },
      { name: 'Broken', url: 'ftp://b.example/{query}' },
      { name: 'Public', url: 'https://c.example/{title}', visitors: true },
    ]);
    expect(links.map((l) => l.name)).toEqual(['Mine', 'Public']);
    expect(linksFor(links, false).map((l) => l.name)).toEqual(['Public']);
    expect(linksFor(links, true)).toHaveLength(2);
    expect(readSearchLinks('nope')).toEqual([]);
  });
});
