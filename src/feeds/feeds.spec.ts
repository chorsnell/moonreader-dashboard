import {
  buildAtom,
  buildIcs,
  calendarEvents,
  escapeIcs,
  foldIcs,
  toFeedInput,
  type FeedData,
} from './feeds';

const ctx = {
  self: 'https://r.example/feeds/SECRET.atom',
  home: 'https://r.example/',
  cover: (p: string) => `https://r.example/feeds/SECRET/${p}`,
  title: 'Sam’s reading: finished books',
};

const data = (over: Partial<FeedData> = {}): FeedData => ({
  books: [
    { id: 'alpha', title: 'Alpha', author: 'Ann Author', rating: 4 },
    { id: 'beta', title: 'Beta & <Co>', author: 'Bob', rating: null },
  ],
  reads: [
    {
      read_id: 'alpha#1',
      book_id: 'alpha',
      title: 'Alpha',
      author: 'Ann Author',
      end: '2026-03-03',
      finished: true,
      hours: 1.2,
      days_read: 3,
      genre: 'Fiction',
    },
    {
      read_id: 'beta#1',
      book_id: 'beta',
      title: 'Beta & <Co>',
      author: 'Bob',
      end: '2026-03-10',
      finished: true,
      hours: 2,
    },
    { read_id: 'gamma#1', book_id: 'gamma', title: 'Gamma', end: '2026-03-12', finished: false },
    {
      read_id: 'private-1#1',
      book_id: 'private-1',
      title: 'A private book',
      end: '2026-03-11',
      finished: true,
    },
  ],
  daily: [
    { date: '2026-03-01', book_id: 'alpha', title: 'Alpha', minutes: 30 },
    { date: '2026-03-01', book_id: 'beta', title: 'Beta & <Co>', minutes: 45 },
    { date: '2026-03-02', book_id: 'private-1', title: 'A private book', minutes: 10 },
  ],
  dates: 'day',
  days: true,
  covers: { alpha: 'covers/alpha.jpg?v=1' },
  generated: '2026-03-12T08:00:00',
  ...over,
});

describe('the Atom feed', () => {
  it('lists finished books newest first, with cover, rating and escaped text', () => {
    const xml = buildAtom(data(), ctx);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    const titles = [...xml.matchAll(/<entry>[\s\S]*?<title>(.*?)<\/title>/g)].map((m) => m[1]);
    expect(titles).toEqual(['Beta &amp; &lt;Co&gt;, Bob', 'Alpha, Ann Author']);
    expect(xml).toContain('https://r.example/feeds/SECRET/covers/alpha.jpg?v=1');
    expect(xml).toContain('Rated ★★★★☆ (4 of 5)');
    expect(xml).toContain('href="https://r.example/#book/alpha"');
    expect(xml).toContain('<updated>2026-03-12T08:00:00Z</updated>');
    expect(xml).not.toContain('Gamma');
    expect(xml).not.toContain('private');
    expect(xml).not.toContain('<Co>');
  });

  it('says only the week or month when dates are rounded', () => {
    expect(buildAtom(data({ dates: 'month' }), ctx)).toContain('Finished in 2026-03.');
    expect(buildAtom(data({ dates: 'week' }), ctx)).toContain(
      'Finished in the week of 2026-03-03.',
    );
  });
});

describe('the calendar', () => {
  const clubs = [
    { id: 'c1', title: 'Beta', author: 'Bob', start: '2026-03-01', pct_per_week: 40, members: 3 },
  ];

  it('has reading days, finishes and club check-ins', () => {
    const ev = calendarEvents(data(), clubs, ctx, '2026-03-12');
    const day = ev.find((e) => e.uid === 'day-2026-03-01');
    expect(day).toMatchObject({
      start: '2026-03-01',
      end: '2026-03-02',
      summary: 'Read 1 h 15 min',
    });
    expect(day?.description).toBe('Alpha\nBeta & <Co>');
    expect(ev.find((e) => e.uid === 'day-2026-03-02')).toBeUndefined(); // a private book's day
    expect(ev.filter((e) => e.categories === 'Finished').map((e) => e.summary)).toEqual([
      'Finished Alpha',
      'Finished Beta & <Co>',
    ]);
    expect(ev.filter((e) => e.categories === 'Book club').map((e) => [e.start, e.summary])).toEqual(
      [
        ['2026-03-01', 'Book club starts: Beta'],
        ['2026-03-08', 'Book club week 1: Beta to 40%'],
        ['2026-03-15', 'Book club week 2: Beta to 80%'],
        ['2026-03-22', 'Book club finishes: Beta'],
      ],
    );
  });

  it('leaves out reading days without exact days and the diary, and spans rounded finishes', () => {
    const ev = calendarEvents(data({ dates: 'month' }), [], ctx, '2026-03-12');
    expect(ev.some((e) => e.uid.startsWith('day-'))).toBe(false);
    expect(ev.find((e) => e.summary === 'Finished Alpha')).toMatchObject({
      start: '2026-03-03',
      end: '2026-04-01',
    });
    const noDiary = calendarEvents(data({ days: false }), [], ctx, '2026-03-12');
    expect(noDiary.some((e) => e.uid.startsWith('day-'))).toBe(false);
    const week = calendarEvents(data({ dates: 'week' }), [], ctx, '2026-03-12');
    expect(week.find((e) => e.summary === 'Finished Alpha')?.end).toBe('2026-03-10');
  });

  it('writes valid iCalendar: CRLF, escaped text, folded lines', () => {
    const ics = buildIcs(
      calendarEvents(data(), clubs, ctx, '2026-03-12'),
      'A; b, c',
      '2026-03-12T08:00:00',
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:A\\; b\\, c');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260301');
    expect(ics).toContain('DTSTAMP:20260312T080000Z');
    expect(ics).toContain('DESCRIPTION:Alpha\\nBeta & <Co>');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(ics.match(/END:VEVENT/g)?.length);
  });

  it('folds long lines without splitting a character', () => {
    const line = `SUMMARY:${'é'.repeat(80)}`;
    const folded = foldIcs(line);
    const parts = folded.split('\r\n ');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => Buffer.byteLength(p) <= 75)).toBe(true);
    expect(parts.join('')).toBe(line);
    expect(escapeIcs('a\\b')).toBe('a\\\\b');
  });
});

describe('a new feed', () => {
  it('needs a kind and defaults to the public', () => {
    expect(() => toFeedInput({})).toThrow();
    expect(toFeedInput({ kind: 'ical', audience: 'admin' })).toEqual({
      kind: 'ical',
      audience: 'public',
      name: 'Reading calendar',
    });
    expect(toFeedInput({ kind: 'atom', audience: 'friends', name: ' Blog ' })).toEqual({
      kind: 'atom',
      audience: 'friends',
      name: 'Blog',
    });
  });
});
