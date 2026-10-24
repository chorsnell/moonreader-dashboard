import { decode, encode } from 'jpeg-js';
import { requestOrigin } from '../web/web.controller';
import { COLLAGE_HEIGHT, COLLAGE_WIDTH, collage, layout } from './collage';
import { shareCard, shareTags } from './share-card';

/** A w x h JPEG of one colour. */
function jpeg(w: number, h: number, rgb: [number, number, number]): Buffer {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return encode({ width: w, height: h, data }, 90).data;
}

const books = [
  {
    id: 'a',
    title: 'Alpha',
    author: 'Ann',
    status: 'finished',
    hours: 10.4,
    words: 1_200_000,
    last_read: '2026-03-01',
  },
  {
    id: 'b',
    title: 'Beta',
    author: 'Bob',
    status: 'finished',
    hours: 5,
    words: 300_000,
    last_read: '2025-12-01',
  },
  {
    id: 'c',
    title: 'Gamma',
    author: 'ann',
    status: 'in_progress',
    hours: 2,
    words: 50_000,
    last_read: '2026-04-01',
  },
];
const reads = [
  { book_id: 'b', title: 'Beta', author: 'Bob', finished: true, end: '2025-12-01' },
  { book_id: 'a', title: 'Alpha', author: 'Ann', finished: true, end: '2026-03-01' },
  { book_id: 'c', title: 'Gamma', author: 'ann', finished: false, end: '2026-04-01' },
  { book_id: 'private-1', title: 'A private book', author: '', finished: true, end: '2026-04-02' },
];

describe('shareCard', () => {
  it('sums up the reading in a line, newest first', () => {
    const card = shareCard(books, reads, '2026-04-05');
    expect(card.title).toBe('Reading history: 2 books finished');
    expect(card.description).toBe(
      '2 books finished in 2026 · 17 hours read · 1.6 million words · 2 authors. ' +
        'Lately: Alpha by Ann; Beta by Bob.',
    );
    // finished reads first, then what was read most recently; never a book it doesn't know
    expect(card.coverIds).toEqual(['a', 'b', 'c']);
  });

  it('copes with no data', () => {
    expect(shareCard(undefined, null, null)).toEqual({
      title: 'Reading history',
      description: 'A self-hosted reading history.',
      coverIds: [],
    });
  });
});

describe('shareTags', () => {
  it('escapes what it puts in the tags', () => {
    const html = shareTags({
      title: 'Me & "you"',
      description: '<b>',
      url: 'https://x.test/',
      image: 'https://x.test/share.jpg',
    });
    expect(html).toContain('<meta property="og:title" content="Me &amp; &quot;you&quot;">');
    expect(html).toContain('<meta name="description" content="&lt;b&gt;">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta property="og:image" content="https://x.test/share.jpg">');
  });

  it('leaves the picture out when there is none', () => {
    const html = shareTags({ title: 't', description: 'd', url: null, image: null });
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('og:url');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });
});

describe('collage', () => {
  it('lays covers out on a 1200 x 630 JPEG', () => {
    const red = jpeg(60, 90, [220, 20, 20]);
    const out = collage([red, Buffer.from('not an image'), jpeg(90, 60, [20, 20, 220])]);
    expect(out).not.toBeNull();
    const img = decode(out!, { useTArray: true });
    expect([img.width, img.height]).toEqual([COLLAGE_WIDTH, COLLAGE_HEIGHT]);
    // two covers fit side by side in one row, centred: the first is red in the middle
    const { w, h } = layout(2);
    const left = Math.floor((COLLAGE_WIDTH - 2 * w - 10) / 2);
    const at = (x: number, y: number) => [
      ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3),
    ];
    const [r, g, b] = at(left + w / 2, Math.floor(COLLAGE_HEIGHT / 2));
    expect(r).toBeGreaterThan(180);
    expect(g + b).toBeLessThan(100);
    expect(h).toBeGreaterThan(600);
    const [, , b2] = at(left + w + 10 + w / 2, Math.floor(COLLAGE_HEIGHT / 2));
    expect(b2).toBeGreaterThan(180);
  });

  it('uses more, smaller rows for more covers', () => {
    expect(layout(1)).toMatchObject({ rows: 1, perRow: 1 });
    expect(layout(7)).toMatchObject({ rows: 2, perRow: 4 });
    expect(layout(15)).toMatchObject({ rows: 2, perRow: 5 });
    expect(layout(40)).toMatchObject({ rows: 3, perRow: 8 });
  });

  it('gives null when no cover can be read', () => {
    expect(collage([])).toBeNull();
    expect(collage([Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2])])).toBeNull();
  });
});

describe('requestOrigin', () => {
  it('builds the address from the proxy headers', () => {
    expect(requestOrigin({ host: 'books.test:8080' }, '')).toBe('http://books.test:8080');
    expect(
      requestOrigin(
        { host: 'internal', 'x-forwarded-host': 'books.test', 'x-forwarded-proto': 'https' },
        '/reading',
      ),
    ).toBe('https://books.test/reading');
    expect(requestOrigin({ host: 'evil.test"><script>' }, '')).toBeNull();
    expect(requestOrigin({}, '')).toBeNull();
  });
});
