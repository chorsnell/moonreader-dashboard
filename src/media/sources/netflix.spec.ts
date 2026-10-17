import {
  hms,
  looksLikeNetflix,
  netflixEvents,
  parseCsv,
  parseNetflix,
  parseTitle,
} from './netflix';

const HEADER =
  'Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country';

const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n');

describe('parseCsv', () => {
  it('handles quotes, commas and line breaks in fields', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\n1,"two\nlines",3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ]);
  });
});

describe('parseTitle', () => {
  it.each([
    ['Copper Valley: Season 2: The Long Night', 'Copper Valley', 2, 'The Long Night', null],
    ['Glass Harbour: Limited Series: Episode 3', 'Glass Harbour', 1, 'Episode 3', null],
    ['Night Ferry: Part 1: Chapter Three', 'Night Ferry', 1, 'Chapter Three', null],
    ['Show: With: Colons: Season 3: Ep', 'Show: With: Colons', 3, 'Ep', null],
    ['Fieldwork: Season 1: Pilot (Episode 1)', 'Fieldwork', 1, 'Pilot', 1],
  ])('%s', (title, show, season, episode, no) => {
    const t = parseTitle(title);
    expect([t.show, t.season, t.episode_title, t.episode]).toEqual([show, season, episode, no]);
  });

  it('leaves films (even with a colon) alone', () => {
    expect(parseTitle('Metropolis').show).toBeNull();
    expect(parseTitle('Sherlock Jr.: The Restoration').show).toBeNull();
  });
});

describe('parseNetflix', () => {
  it('reads the full viewing activity export', () => {
    const f = parseNetflix(
      csv(
        'Chris,2025-01-04 20:05:00,00:54:12,,Copper Valley: Season 1: Pilot,,Smart TV,00:54:12,Not latest view,GB (United Kingdom)',
        'Sam,2025-01-05 19:00:00,00:01:10,,Copper Valley: Season 1: Pilot,TRAILER,Phone,00:01:10,Not latest view,GB (United Kingdom)',
      ),
    );
    expect(f.kind).toBe('activity');
    expect(f.profiles).toEqual(['Chris', 'Sam']);
    expect(f.rows[0]).toMatchObject({
      start: '2025-01-04T20:05:00Z',
      seconds: 3252,
      bookmark: 3252,
      device: 'Smart TV',
    });
    expect(f.rows[1].supplemental).toBe('TRAILER');
  });

  it('reads the light history file, with day-first dates', () => {
    const f = parseNetflix('Title,Date\n"Metropolis","23/01/2025"\n"Nosferatu","02/02/2025"\n');
    expect(f.kind).toBe('history');
    expect(f.rows.map((r) => r.start)).toEqual(['2025-01-23', '2025-02-02']);
  });

  it('refuses other files', () => {
    expect(() => parseNetflix('a,b\n1,2')).toThrow(/Netflix/);
    expect(looksLikeNetflix('"Title","Date"\n')).toBe(true);
    expect(looksLikeNetflix(HEADER)).toBe(true);
    expect(looksLikeNetflix('<html>')).toBe(false);
  });

  it('reads durations', () => {
    expect(hms('01:02:03')).toBe(3723);
    expect(hms('Not latest view')).toBeNull();
  });
});

describe('netflixEvents', () => {
  const file = parseNetflix(
    csv(
      'Chris,2025-01-04 20:05:00,00:50:00,,Copper Valley: Season 1: Pilot,,TV,00:50:00,,GB',
      'Chris,2025-01-04 21:00:00,00:01:00,,Copper Valley: Season 1: Pilot,HOOK,TV,00:01:00,,GB',
      'Sam,2025-01-05 20:00:00,01:30:00,,Metropolis,,TV,01:30:00,,GB',
      'Chris,2025-01-06 20:00:00,00:30:00,,Kitchen Brigade: Starters,,TV,00:30:00,,GB',
      'Chris,2025-01-07 20:00:00,00:30:00,,Kitchen Brigade: Mains,,TV,00:30:00,,GB',
      'Chris,2025-01-08 20:00:00,00:30:00,,Kitchen Brigade: Puddings,,TV,00:30:00,,GB',
      'Chris,2025-01-09 20:00:00,01:40:00,,Sherlock Jr.: The Restoration,,TV,01:40:00,,GB',
    ),
  );

  it('imports only the chosen profiles, without extras', () => {
    const ev = netflixEvents(file, { profiles: ['Chris'] });
    expect(ev.map((e) => e.title)).not.toContain('Metropolis');
    expect(ev.filter((e) => e.title === 'Pilot')).toHaveLength(1);
    expect(netflixEvents(file, { profiles: [] })).toHaveLength(0);
  });

  it('splits shows from films', () => {
    const ev = netflixEvents(file, { profiles: ['Chris'] });
    expect(ev[0]).toMatchObject({
      media: 'tv',
      source_key: 'copper valley',
      series_title: 'Copper Valley',
      season: 1,
      title: 'Pilot',
      seconds: 3000,
      position_seconds: 3000,
      estimated: false,
    });
    // a prefix with three different remainders is a show
    expect(ev.filter((e) => e.series_title === 'Kitchen Brigade').map((e) => e.title)).toEqual([
      'Starters',
      'Mains',
      'Puddings',
    ]);
    expect(ev.at(-1)).toMatchObject({ media: 'film', title: 'Sherlock Jr.: The Restoration' });
  });

  it('imports a one-profile export without asking', () => {
    const one = parseNetflix(
      csv('Chris,2025-01-05 20:00:00,01:30:00,,Metropolis,,TV,01:30:00,,GB'),
    );
    expect(netflixEvents(one, { profiles: [] })).toHaveLength(1);
  });

  it('gives light history rows no minutes', () => {
    const ev = netflixEvents(parseNetflix('Title,Date\nMetropolis,1/23/25\n'), { profiles: [] });
    expect(ev[0]).toMatchObject({ media: 'film', seconds: null, estimated: true });
    expect(new Date(ev[0].start).getHours()).toBe(12);
  });
});
