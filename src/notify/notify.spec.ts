import {
  detect,
  publicSettings,
  requestFor,
  streakWarning,
  toChannel,
  toNotifySettings,
  withOptions,
  type Snapshot,
} from './notify';

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  today: '2026-03-10',
  reads: [
    {
      read_id: 'alpha#1',
      book_id: 'alpha',
      title: 'Alpha',
      author: 'Ann',
      end: '2026-03-03',
      finished: true,
      hours: 1.2,
      days_read: 3,
    },
  ],
  books: [
    { id: 'alpha', title: 'Alpha', author: 'Ann', status: 'finished' },
    { id: 'beta', title: 'Beta', author: 'Bob Writer', status: 'in_progress', progress: 50 },
  ],
  records: [
    {
      id: 'longest_streak',
      label: 'Longest streak',
      unit: 'days',
      lower_better: false,
      value: 5,
      date: '2026-03-05',
    },
  ],
  friends: [{ slug: 'ada', name: 'Ada', reads: [], books: [] }],
  private: new Set(),
  home: 'https://r.example/',
  ...over,
});

describe('finding events', () => {
  it('sends nothing on the first run, then only what is new', () => {
    const first = detect(null, snap(), null);
    expect(first.events).toEqual([]);
    expect(detect(first.next, snap(), null).events).toEqual([]); // the same data again
    const later = snap({
      reads: [
        ...snap().reads,
        {
          read_id: 'beta#1',
          book_id: 'beta',
          title: 'Beta',
          author: 'Bob',
          end: '2026-03-09',
          finished: true,
          hours: 2,
          days_read: 1,
        },
        // finished long ago (an old import): not news
        { read_id: 'old#1', book_id: 'old', title: 'Old', end: '2020-01-01', finished: true },
      ],
    });
    const { events } = detect(first.next, later, null);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'book_finished',
        title: 'Finished Beta',
        message: 'by Bob · 2 hours over 1 day',
        url: 'https://r.example/#book/beta',
      }),
    ]);
  });

  it('never names a private book', () => {
    const first = detect(null, snap(), null);
    const later = snap({
      private: new Set(['beta']),
      reads: [
        ...snap().reads,
        {
          read_id: 'beta#1',
          book_id: 'beta',
          title: 'Beta',
          author: 'Bob',
          end: '2026-03-09',
          finished: true,
        },
      ],
    });
    const [e] = detect(first.next, later, null).events;
    expect(e.title).toBe('Finished a private book');
    expect(JSON.stringify(e)).not.toContain('Beta');
    expect(JSON.stringify(e)).not.toContain('Bob');
  });

  it('puts many finishes in one message', () => {
    const first = detect(null, snap(), null);
    const many = Array.from({ length: 7 }, (_, i) => ({
      read_id: `b${i}#1`,
      book_id: `b${i}`,
      title: `B${i}`,
      end: '2026-03-09',
      finished: true,
    }));
    const { events } = detect(first.next, snap({ reads: [...snap().reads, ...many] }), null);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('7 books finished');
  });

  it('tells of new records, once', () => {
    const first = detect(null, snap(), null);
    const better = snap({ records: [{ ...snap().records[0], value: 7, date: '2026-03-09' }] });
    const { events, next } = detect(first.next, better, null);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'new_record',
        title: 'New record: longest streak',
        message: '7 days, beating 5 days.',
      }),
    ]);
    expect(detect(next, better, null).events).toEqual([]);
  });

  it('tells of the year goal once a year', () => {
    const reads = [1, 2, 3].map((i) => ({
      read_id: `y${i}#1`,
      book_id: `y${i}`,
      title: `Y${i}`,
      end: `2026-0${i}-01`,
      finished: true,
    }));
    const before = detect(null, snap({ reads: reads.slice(0, 2) }), 3);
    const { events, next } = detect(before.next, snap({ reads }), 3);
    expect(events.find((e) => e.kind === 'year_goal')).toMatchObject({
      title: 'Year goal reached: 3 books',
      url: 'https://r.example/#year/2026',
    });
    expect(detect(next, snap({ reads }), 3).events.filter((e) => e.kind === 'year_goal')).toEqual(
      [],
    );
    // reached already on the first run: no news
    expect(detect(null, snap({ reads }), 3).events).toEqual([]);
  });

  it("tells of a friend finishing a book that's in your library", () => {
    const first = detect(null, snap(), null);
    const ada = {
      slug: 'ada',
      name: 'Ada',
      books: [
        { id: 'x-beta', title: 'The Beta', author: 'Bob Writer' },
        { id: 'zed', title: 'Zed', author: 'Zoe' },
      ],
      reads: [
        {
          read_id: 'x-beta#1',
          book_id: 'x-beta',
          title: 'The Beta',
          end: '2026-03-08',
          finished: true,
        },
        { read_id: 'zed#1', book_id: 'zed', title: 'Zed', end: '2026-03-08', finished: true },
      ],
    };
    const { events, next } = detect(first.next, snap({ friends: [ada] }), null);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'friend_finished',
        title: 'Ada finished Beta',
        message: "You're reading it too (50%).",
      }),
    ]);
    expect(detect(next, snap({ friends: [ada] }), null).events).toEqual([]);
    // a friend added since: what they'd read before isn't news
    const ben = { ...ada, slug: 'ben', name: 'Ben' };
    expect(detect(next, snap({ friends: [ada, ben] }), null).events).toEqual([]);
  });
});

describe('streaks', () => {
  const daily = ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'].map(
    (date) => ({ date, minutes: 20 }),
  );

  it('warns in the evening, once a day, when nothing was read today', () => {
    const s = { streak_hour: 21, streak_min: 3 };
    expect(streakWarning(daily, { date: '2026-03-10', hour: 20 }, s, null)).toBeNull();
    expect(streakWarning(daily, { date: '2026-03-10', hour: 21 }, s, null)).toMatchObject({
      kind: 'streak_at_risk',
      title: 'Your 5-day streak is at risk',
    });
    expect(streakWarning(daily, { date: '2026-03-10', hour: 22 }, s, '2026-03-10')).toBeNull();
    expect(streakWarning(daily, { date: '2026-03-09', hour: 22 }, s, null)).toBeNull(); // read today
    expect(
      streakWarning(daily, { date: '2026-03-10', hour: 22 }, { ...s, streak_min: 6 }, null),
    ).toBeNull();
  });
});

describe('channels', () => {
  const ev = {
    kind: 'book_finished',
    title: 'Finished Ä',
    message: 'by B',
    url: 'https://r/#book/a',
    tags: ['books'],
  };

  it('build each service’s request', () => {
    const ntfy = requestFor(
      { id: '1', type: 'ntfy', name: 'n', url: 'https://ntfy.example/sub/reading', token: 'tk' },
      ev,
      '2026-03-10T09:00:00',
    );
    expect(ntfy.url).toBe('https://ntfy.example/sub');
    expect(ntfy.headers.Authorization).toBe('Bearer tk');
    expect(JSON.parse(ntfy.body)).toMatchObject({
      topic: 'reading',
      title: 'Finished Ä',
      click: 'https://r/#book/a',
      priority: 3,
    });
    const gotify = requestFor(
      { id: '2', type: 'gotify', name: 'g', url: 'https://g.example', token: 'app' },
      ev,
      '2026-03-10T09:00:00',
    );
    expect(gotify.url).toBe('https://g.example/message');
    expect(gotify.headers['X-Gotify-Key']).toBe('app');
    const discord = JSON.parse(
      requestFor(
        {
          id: '3',
          type: 'discord',
          name: 'd',
          url: 'https://discord.example/api/webhooks/1/x',
          token: '',
        },
        ev,
        '2026-03-10T09:00:00',
      ).body,
    );
    expect(discord.embeds[0]).toMatchObject({
      title: 'Finished Ä',
      description: 'by B',
      url: 'https://r/#book/a',
    });
    const hook = JSON.parse(
      requestFor(
        { id: '4', type: 'webhook', name: 'w', url: 'https://h.example/x', token: '' },
        ev,
        '2026-03-10T09:00:00',
      ).body,
    );
    expect(hook).toMatchObject({
      event: 'book_finished',
      title: 'Finished Ä',
      priority: 'default',
      time: '2026-03-10T09:00:00',
    });
  });

  it('are checked when added, and never shown with their secrets', () => {
    expect(() => toChannel({ type: 'pager', url: 'https://x' })).toThrow();
    expect(() => toChannel({ type: 'ntfy', url: 'ftp://x/y' })).toThrow();
    expect(() => toChannel({ type: 'gotify', url: 'https://g' })).toThrow('token');
    const c = toChannel({ type: 'discord', url: 'https://discord.example/api/webhooks/1/SECRET' });
    const s = toNotifySettings({ channels: [c], events: { book_finished: false } });
    const shown = JSON.stringify(publicSettings(s));
    expect(shown).not.toContain('SECRET');
    expect(shown).toContain('discord.example');
    expect(publicSettings(s).events).toMatchObject({ book_finished: false, new_record: true });
  });

  it('options are clamped', () => {
    const s = withOptions(toNotifySettings({}), {
      streak_hour: 30,
      streak_min: 2,
      events: { new_record: false, 'Bad Kind': true },
    });
    expect(s).toMatchObject({
      streak_hour: 21,
      streak_min: 2,
      events: { new_record: false },
    });
    expect(withOptions(s, { streak_min: 0 }).streak_min).toBe(3);
  });
});
