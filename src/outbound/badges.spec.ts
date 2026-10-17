import { escapeXml, fit, heatmap, readingCard, textWidth, yearBadge } from './badges';
import type { NowSummary } from './now';

const now: NowSummary = {
  today: '2026-10-18',
  as_of: '2026-10-17',
  generated: null,
  reading: [
    {
      id: 'a',
      title: 'Alpha & <Omega>',
      author: 'Ann',
      genre: null,
      progress: 38,
      last_read: '2026-10-17',
      cover: 'covers/a.jpg',
    },
    {
      id: 'b',
      title: 'Beta',
      author: '',
      genre: null,
      progress: null,
      last_read: null,
      cover: null,
    },
  ],
  today_minutes: 0,
  week_minutes: 10,
  streak: null,
  year: { year: 2026, finished: 9, goal: 24, percent: 38, expected: 19, ahead: -10 },
  quote: null,
};

describe('text helpers', () => {
  it('escapes XML and cuts long text with an ellipsis', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    const long = 'A very long title that goes on and on and on';
    const cut = fit(long, 13, 120);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut, 13)).toBeLessThanOrEqual(120);
    expect(fit('Short', 13, 120)).toBe('Short');
  });
});

describe('readingCard', () => {
  it('shows the books with progress, escaped, and the cover embedded', () => {
    const svg = readingCard({ now, cover: 'data:image/jpeg;base64,AAAA', theme: 'light' });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('Alpha &amp; &lt;Omega&gt;');
    expect(svg).not.toContain('<Omega>');
    expect(svg).toContain('38%');
    expect(svg).toContain('href="data:image/jpeg;base64,AAAA"');
    expect(svg).toContain('Beta');
    expect(svg).toContain('#ffffff');
    expect(readingCard({ now, cover: null, theme: 'dark' })).toContain('#211f1d');
  });

  it('says when nothing is shared or on the go', () => {
    expect(readingCard({ now: { ...now, reading: null }, cover: null, theme: 'light' })).toContain(
      'Not shared',
    );
    expect(readingCard({ now: { ...now, reading: [] }, cover: null, theme: 'light' })).toContain(
      'Nothing on the go',
    );
  });

  it('takes a heading', () => {
    expect(
      readingCard({ now, cover: null, theme: 'light', heading: 'On my <nightstand>' }),
    ).toContain('On my &lt;nightstand&gt;');
  });
});

describe('yearBadge', () => {
  it('is a shields-style badge, against the goal when there is one', () => {
    const svg = yearBadge({ now, hours: 69, theme: 'light', style: 'badge' });
    expect(svg).toContain('Books in 2026');
    expect(svg).toContain('9 / 24');
    expect(svg).toContain('height="20"');
    const none = yearBadge({
      now: { ...now, year: { ...now.year, goal: null } },
      hours: null,
      theme: 'light',
      style: 'badge',
    });
    expect(none).toContain('>9<');
  });

  it('has a card with the pace and hours', () => {
    const svg = yearBadge({ now, hours: 69, theme: 'dark', style: 'card' });
    expect(svg).toContain('of 24 books');
    expect(svg).toContain('10 books behind pace');
    expect(svg).toContain('69 hours');
    const noHours = yearBadge({ now, hours: null, theme: 'dark', style: 'card' });
    expect(noHours).not.toContain('hours');
  });
});

describe('heatmap', () => {
  const daily = [
    { date: '2026-10-17', minutes: 30 },
    { date: '2026-10-17', minutes: 10 },
    { date: '2026-10-12', minutes: 5 },
    { date: '2025-01-01', minutes: 999 },
  ];

  it('draws a day per square, up to the end day', () => {
    const svg = heatmap({ daily, end: '2026-10-18', dates: 'day', weeks: 4, theme: 'light' })!;
    // 3 full weeks + Monday to Sunday of the last
    expect(svg.match(/<rect x="\d+" y="\d+" width="11"/g)).toHaveLength(28);
    expect(svg).toContain('2 days');
    expect(svg).toContain('fill-opacity="1.00"');
  });

  it('draws weeks when only weeks are shared, and nothing for months', () => {
    const weeks = [{ date: '2026-10-12', minutes: 45 }];
    const svg = heatmap({
      daily: weeks,
      end: '2026-10-18',
      dates: 'week',
      weeks: 8,
      theme: 'dark',
    })!;
    expect(svg.match(/<rect x="\d+" y="\d+" width="11"/g)).toHaveLength(8);
    expect(svg).toContain('1 week with reading');
    expect(
      heatmap({ daily, end: '2026-10-18', dates: 'month', weeks: 8, theme: 'dark' }),
    ).toBeNull();
  });
});
