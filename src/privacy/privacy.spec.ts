import {
  PRESETS,
  buildContext,
  coarsenDate,
  filterCovers,
  filterDataFile,
  hiddenCategories,
  toPrivacySettings,
  type BookFacts,
  type Policy,
} from './privacy';

const books: (BookFacts & Record<string, unknown>)[] = [
  {
    id: 'emma',
    title: 'Emma',
    author: 'Jane Austen',
    genre: 'Classics',
    subgenre: 'Romance',
    status: 'finished',
    last_read: '2026-01-10',
    first_read: '2025-12-01',
    series: null,
  },
  {
    id: 'dune',
    title: 'Dune',
    author: 'Frank Herbert',
    genre: 'Science Fiction',
    subgenre: 'Space',
    status: 'in_progress',
    last_read: '2026-03-28',
    first_read: '2026-03-01',
    progress: 40,
    series: 'Dune',
    series_no: 1,
  },
  {
    id: 'diary',
    title: 'My Diary',
    author: 'Me',
    genre: 'Memoir',
    subgenre: 'Personal',
    status: 'in_progress',
    last_read: '2026-03-30',
    first_read: '2026-02-01',
    progress: 10,
  },
];
const reads = [
  {
    read_id: 'emma#1',
    book_id: 'emma',
    title: 'Emma',
    start: '2025-12-01',
    end: '2026-01-10',
    finished: true,
  },
  {
    read_id: 'dune#1',
    book_id: 'dune',
    title: 'Dune',
    start: '2026-03-01',
    end: '2026-03-28',
    finished: false,
  },
  {
    read_id: 'diary#1',
    book_id: 'diary',
    title: 'My Diary',
    start: '2026-02-01',
    end: '2026-03-30',
    finished: false,
  },
];
const daily = [
  { date: '2026-03-23', book_id: 'dune', minutes: 30, words: 9000, progress: 30 },
  { date: '2026-03-25', book_id: 'dune', minutes: 20, words: 6000, progress: 35 },
  { date: '2026-03-26', book_id: 'diary', minutes: 5, words: 100, progress: 10 },
  { date: '2026-01-05', book_id: 'emma', minutes: 60, words: 20000, progress: 90 },
];
const highlights = [
  { id: 1, book_id: 'emma', date: '2026-01-05', time: '22:14', text: 'Badly done, Emma!' },
  { id: 2, book_id: 'diary', date: '2026-03-26', time: '07:02', text: 'Something secret' },
];
const meta = { backup_file: 'x.mrpro', generated: '2026-03-31T21:47:12', untagged: 0 };

const settings = (policy: Policy, extra = {}) => ({
  ...toPrivacySettings({}),
  public: policy,
  ...extra,
});
const ctxFor = (policy: Policy, extra = {}) =>
  buildContext(policy, settings(policy, extra), books, meta.generated);

describe('privacy settings', () => {
  it('fills in defaults: everything but highlights for the public', () => {
    const s = toPrivacySettings(undefined);
    expect(s.public).toEqual({ ...PRESETS.everything, highlights: false });
    expect(s.reader).toEqual(PRESETS.everything);
    expect(s.private_mode).toBe('hide');
    const odd = toPrivacySettings({
      public: { dates: 'year', diary: 'no' },
      private_books: [1, 'a', 'a'],
    });
    expect(odd.public.dates).toBe('day');
    expect(odd.public.diary).toBe(true);
    expect(odd.private_books).toEqual(['a']);
  });

  it('lists what a policy hides', () => {
    // life events are personal: no preset shows them
    expect(hiddenCategories(PRESETS.everything)).toEqual(['life_events']);
    expect(hiddenCategories({ ...PRESETS.everything, life_events: true })).toEqual([]);
    expect(hiddenCategories(PRESETS.taste)).toEqual([
      'exact_dates',
      'diary',
      'current',
      'streaks',
      'money',
      'highlights',
      'life_events',
    ]);
  });

  it('keeps life events from every role by default', () => {
    const s = toPrivacySettings(undefined);
    expect([s.public, s.reader, s.friends].map((p) => p.life_events)).toEqual([
      false,
      false,
      false,
    ]);
    expect(toPrivacySettings({ reader: { life_events: true } }).reader.life_events).toBe(true);
  });
});

describe('coarsenDate', () => {
  it('rounds down to the Monday or the first of the month', () => {
    expect(coarsenDate('2026-03-26', 'week')).toBe('2026-03-23'); // a Thursday
    expect(coarsenDate('2026-03-23', 'week')).toBe('2026-03-23');
    expect(coarsenDate('2026-03-29T21:00:00', 'week')).toBe('2026-03-23'); // Sunday
    expect(coarsenDate('2026-03-26T08:00', 'month')).toBe('2026-03-01');
    expect(coarsenDate('2026-03-26', 'day')).toBe('2026-03-26');
  });
});

describe('filterDataFile', () => {
  it('passes everything through with the everything preset, bar admin-only files', () => {
    const ctx = ctxFor(PRESETS.everything);
    expect(filterDataFile('books.json', books, ctx)).toEqual(books);
    expect(filterDataFile('daily.json', daily, ctx)).toEqual(daily);
    expect(filterDataFile('highlights.json', highlights, ctx)).toEqual(highlights);
    expect(filterDataFile('reading_history.json', { books }, ctx)).toBeNull();
  });

  it('serves hidden categories empty', () => {
    const ctx = ctxFor({ ...PRESETS.everything, diary: false, highlights: false, money: false });
    expect(filterDataFile('daily.json', daily, ctx)).toEqual([]);
    expect(filterDataFile('highlights.json', highlights, ctx)).toEqual([]);
    expect(filterDataFile('prices.json', [{ book_id: 'emma', price: 3 }], ctx)).toEqual([]);
    expect(filterDataFile('books.json', books, ctx)).toEqual(books);
  });

  it('serves life events only when the policy shows them, with dates coarsened', () => {
    const events = [
      { id: 'h', title: 'Holiday', kind: 'holiday', start: '2026-03-26', end: '2026-03-29' },
    ];
    expect(filterDataFile('life_events.json', events, ctxFor(PRESETS.everything))).toEqual([]);
    const shown = { ...PRESETS.everything, dates: 'week' as const, life_events: true };
    expect(filterDataFile('life_events.json', events, ctxFor(shown))).toEqual([
      { ...events[0], start: '2026-03-23', end: '2026-03-23' },
    ]);
  });

  it('leaves ratings and shelves out when ratings are hidden', () => {
    const rated = [{ id: 'emma', title: 'Emma', rating: 4, shelves: ['favourites'] }];
    expect(filterDataFile('books.json', rated, ctxFor(PRESETS.taste))).toMatchObject(rated);
    expect(
      filterDataFile('books.json', rated, ctxFor({ ...PRESETS.everything, ratings: false })),
    ).toEqual([{ id: 'emma', title: 'Emma' }]);
  });

  it('coarsens every date and drops times of day', () => {
    const ctx = ctxFor({ ...PRESETS.everything, dates: 'month' });
    const b = filterDataFile('books.json', books, ctx) as typeof books;
    expect(b.map((x) => [x.first_read, x.last_read])).toEqual([
      ['2025-12-01', '2026-01-01'],
      ['2026-03-01', '2026-03-01'],
      ['2026-02-01', '2026-03-01'],
    ]);
    const h = filterDataFile('highlights.json', highlights, ctx) as typeof highlights;
    expect(h.map((x) => [x.date, x.time])).toEqual([
      ['2026-01-01', null],
      ['2026-03-01', null],
    ]);
    expect(filterDataFile('meta.json', meta, ctx)).toMatchObject({ generated: '2026-03-01' });
    // a day per book per month, minutes and words added up
    const d = filterDataFile('daily.json', daily, ctx) as typeof daily;
    expect(d.find((x) => x.book_id === 'dune')).toEqual({
      date: '2026-03-01',
      book_id: 'dune',
      minutes: 50,
      words: 15000,
      progress: 35,
    });
    expect(d).toHaveLength(3);
    expect(JSON.stringify(d)).not.toMatch(/2026-03-2\d/);
  });

  it('has no exact days in the diary when streaks are hidden', () => {
    const ctx = ctxFor({ ...PRESETS.everything, streaks: false });
    const d = filterDataFile('daily.json', daily, ctx) as typeof daily;
    expect(d.map((x) => x.date).sort()).toEqual(['2026-01-05', '2026-03-23', '2026-03-23']);
    expect(filterDataFile('books.json', books, ctx)).toEqual(books);
  });

  it('hides what is being read now', () => {
    const ctx = ctxFor({ ...PRESETS.everything, current: false });
    const b = filterDataFile('books.json', books, ctx) as typeof books;
    expect(b.find((x) => x.id === 'dune')).toMatchObject({
      status: 'unknown',
      progress: null,
      last_read: null,
    });
    expect(b.every((x) => x.last_read === null)).toBe(true);
    const r = filterDataFile('reads.json', reads, ctx) as typeof reads;
    expect(r.map((x) => x.read_id)).toEqual(['emma#1']);
    const d = filterDataFile('daily.json', daily, ctx) as typeof daily;
    expect(d.map((x) => x.book_id)).toEqual(['emma']);
    const h = filterDataFile('highlights.json', highlights, ctx) as typeof highlights;
    expect(h.map((x) => x.id)).toEqual([1]);
  });

  it('leaves private books and genres out everywhere', () => {
    const ctx = ctxFor(PRESETS.everything, {
      private_books: ['diary'],
      private_genres: ['romance'],
    });
    for (const [name, rows] of [
      ['books.json', books],
      ['reads.json', reads],
      ['daily.json', daily],
      ['highlights.json', highlights],
    ] as const) {
      const text = JSON.stringify(filterDataFile(name, rows, ctx));
      expect([name, text]).not.toEqual([
        name,
        expect.stringMatching(/diary|emma|Emma|Diary|secret/),
      ]);
    }
    expect(filterCovers({ emma: 'covers/emma.jpg', dune: 'covers/dune.jpg' }, ctx)).toEqual({
      dune: 'covers/dune.jpg',
    });
  });

  it('or shows them as "A private book"', () => {
    const ctx = ctxFor(PRESETS.everything, { private_books: ['diary'], private_mode: 'anonymise' });
    const b = filterDataFile('books.json', books, ctx) as typeof books;
    expect(b.find((x) => x.id === 'private-1')).toMatchObject({
      title: 'A private book',
      author: '',
      genre: 'Private',
      subgenre: 'Private',
      status: 'in_progress',
    });
    const r = filterDataFile('reads.json', reads, ctx) as typeof reads;
    expect(r.find((x) => x.book_id === 'private-1')).toMatchObject({
      read_id: 'private-1#1',
      title: 'A private book',
    });
    const all = JSON.stringify([
      b,
      r,
      filterDataFile('daily.json', daily, ctx),
      filterDataFile('highlights.json', highlights, ctx),
    ]);
    expect(all).not.toMatch(/diary|Diary|Memoir|secret/);
  });

  it('hides what an anonymised book is doing now too', () => {
    const policy = { ...PRESETS.everything, current: false };
    const ctx = ctxFor(policy, { private_books: ['diary'], private_mode: 'anonymise' });
    const b = filterDataFile('books.json', books, ctx) as typeof books;
    expect(b.find((x) => x.id === 'private-1')).toMatchObject({
      status: 'unknown',
      progress: null,
    });
  });

  it('keeps the to-read pile in step: private books and genres, rounded dates', () => {
    const pile = [
      {
        book_id: 'goodreads:1',
        title: 'Persuasion',
        genre: 'Classics',
        subgenre: 'Romance',
        added: '2026-03-26',
      },
      {
        book_id: 'goodreads:2',
        title: 'Hyperion',
        genre: 'Science Fiction',
        subgenre: 'Space',
        added: '2026-03-26',
      },
      {
        book_id: 'goodreads:3',
        title: 'Secret',
        genre: 'Science Fiction',
        subgenre: 'Space',
        added: null,
      },
    ];
    const ctx = ctxFor(
      { ...PRESETS.everything, dates: 'month' },
      { private_books: ['goodreads:3'], private_genres: ['romance'] },
    );
    expect(filterDataFile('to_read.json', pile, ctx)).toEqual([
      {
        book_id: 'goodreads:2',
        title: 'Hyperion',
        genre: 'Science Fiction',
        subgenre: 'Space',
        added: '2026-03-01',
      },
    ]);
    const anon = ctxFor(PRESETS.everything, {
      private_genres: ['romance'],
      private_mode: 'anonymise',
    });
    const out = filterDataFile('to_read.json', pile, anon) as typeof pile;
    expect(out[0]).toMatchObject({
      title: 'A private book',
      genre: 'Private',
      added: '2026-03-26',
    });
    expect(out[0].book_id).toMatch(/^private-/);
    expect(JSON.stringify(out)).not.toMatch(/Persuasion|Romance|goodreads:1/);
  });

  it('filters files it has never heard of by the same rules', () => {
    const ctx = ctxFor({ ...PRESETS.everything, dates: 'month' }, { private_books: ['diary'] });
    const rows = [
      { book_id: 'diary', date: '2026-03-26', isbn: 'x' },
      { book_id: 'dune', nested: { finish: '2026-03-28' } },
    ];
    expect(filterDataFile('isbns.json', rows, ctx)).toEqual([
      { book_id: 'dune', nested: { finish: '2026-03-01' } },
    ]);
  });

  it('keeps catalogue facts like ISBNs for visible books but not for private ones', () => {
    const facts = {
      isbn13: '9780141439587',
      isbn10: '0141439580',
      work_id: 'OL1W',
      published_year: 1815,
      pages: 474,
      author_country: 'GB',
      author_gender: 'female',
    };
    const rows = books.map((b) => ({ ...b, ...facts }));
    const shown = filterDataFile('books.json', rows, ctxFor(PRESETS.taste)) as typeof rows;
    expect(
      shown.every(
        (b) => b.isbn13 === facts.isbn13 && b.published_year === 1815 && b.author_country === 'GB',
      ),
    ).toBe(true);
    const hidden = filterDataFile(
      'books.json',
      rows,
      ctxFor(PRESETS.everything, { private_books: ['emma'] }),
    ) as typeof rows;
    expect(hidden.map((b) => b.id)).not.toContain('emma');
    const anon = filterDataFile(
      'books.json',
      rows,
      ctxFor(PRESETS.everything, { private_books: ['emma'], private_mode: 'anonymise' }),
    ) as Record<string, unknown>[];
    const p = anon.find((b) => b.id === 'private-1')!;
    for (const k of Object.keys(facts)) expect([k, p[k]]).toEqual([k, null]);
  });

  describe('prices.json', () => {
    const prices = {
      currency: 'GBP',
      budgets: { '2026': 100 },
      benchmarks: [],
      subscriptions: [
        {
          name: 'Kindle Unlimited',
          monthly_fee: 9.49,
          currency: 'GBP',
          start: '2026-01',
          end: null,
        },
      ],
      books: [
        {
          book_id: 'emma',
          title: 'Emma',
          author: 'Jane Austen',
          price: 2.99,
          list_price: null,
          paid: 2.99,
          paid_currency: 'GBP',
          date: '2026-01-04',
          acquisition: 'bought',
          store: 'Austen Books',
          subscription: null,
          bundle: null,
        },
        {
          book_id: 'dune',
          title: 'Dune',
          author: 'Frank Herbert',
          price: 8,
          list_price: null,
          paid: 8,
          paid_currency: 'GBP',
          date: '2026-03-02',
          acquisition: 'bought',
          store: 'Shop',
          subscription: null,
          bundle: null,
        },
        // bought but never opened, so not in books.json
        {
          book_id: 'secret-unopened',
          title: 'Secret Unopened',
          author: 'Hidden Writer',
          price: 5,
          list_price: null,
          paid: 5,
          paid_currency: 'GBP',
          date: '2026-02-10',
          acquisition: 'bought',
          store: 'Shop',
          subscription: null,
          bundle: null,
        },
      ],
    };
    const priv = { private_books: ['emma', 'secret-unopened'] };

    it('leaves private books out when money is shown', () => {
      const out = filterDataFile(
        'prices.json',
        prices,
        ctxFor(PRESETS.everything, priv),
      ) as typeof prices;
      expect(out.books.map((b) => b.book_id)).toEqual(['dune']);
      expect(JSON.stringify(out)).not.toMatch(/Emma|Austen|Secret|Hidden/);
      expect(out.subscriptions).toEqual(prices.subscriptions);
    });

    it('or keeps what they cost under "A private book"', () => {
      const ctx = ctxFor(PRESETS.everything, { ...priv, private_mode: 'anonymise' });
      const out = filterDataFile('prices.json', prices, ctx) as typeof prices;
      expect(JSON.stringify(out)).not.toMatch(/Emma|Austen|Secret|Hidden|emma|secret/);
      const anon = out.books.filter((b) => b.title === 'A private book');
      expect(anon.map((b) => [b.price, b.store, b.author])).toEqual([
        [2.99, null, ''],
        [5, null, ''],
      ]);
    });

    it('is served empty when money is hidden', () => {
      expect(filterDataFile('prices.json', prices, ctxFor(PRESETS.taste))).toEqual([]);
    });
  });
});

describe('bibliography.json', () => {
  const row = (title: string, author: string, series: string | null = null) => ({
    work_id: null,
    title,
    author,
    published_year: 1900,
    editions: 2,
    series,
    series_no: series ? 2 : null,
    isbn13: null,
    why: series ? ['author', 'series'] : ['author'],
    on_pile: false,
  });
  const rows = [
    row('Persuasion', 'Jane Austen'),
    row('Dune Messiah', 'Frank Herbert', 'Dune'),
    row('Children of Dune', 'Someone Else', 'The Dune Saga'),
    row('My Other Diary', 'Me'),
  ];
  const titles = (out: unknown) => (out as { title: string }[]).map((r) => r.title);

  it('passes through when nothing is private', () => {
    expect(filterDataFile('bibliography.json', rows, ctxFor(PRESETS.everything))).toEqual(rows);
  });

  it('leaves out authors and series whose books are all private', () => {
    const ctx = ctxFor(PRESETS.everything, { private_books: ['dune', 'diary'] });
    expect(titles(filterDataFile('bibliography.json', rows, ctx))).toEqual(['Persuasion']);
    // anonymising the books still hides the rows that would name them
    const anon = ctxFor(PRESETS.everything, {
      private_books: ['dune', 'diary'],
      private_mode: 'anonymise',
    });
    expect(titles(filterDataFile('bibliography.json', rows, anon))).toEqual(['Persuasion']);
  });

  it('does so for private genres and subgenres too', () => {
    const ctx = ctxFor(PRESETS.taste, { private_genres: ['personal', 'Romance'] });
    expect(titles(filterDataFile('bibliography.json', rows, ctx))).toEqual([
      'Dune Messiah',
      'Children of Dune',
    ]);
  });

  it('keeps an author with a public book as well as a private one', () => {
    const more = [
      ...books,
      { id: 'persuasion', title: 'Persuasion', author: 'Jane Austen', genre: 'Classics' },
    ];
    const policy = PRESETS.everything;
    const s = settings(policy, { private_books: ['emma'] });
    const ctx = buildContext(policy, s, more, '2026-03-31');
    expect(titles(filterDataFile('bibliography.json', rows, ctx))).toContain('Persuasion');
    expect(titles(filterDataFile('bibliography.json', rows, ctxFor(policy, s)))).not.toContain(
      'Persuasion',
    );
  });

  it('copes with a file that is not a list', () => {
    expect(filterDataFile('bibliography.json', { x: 1 }, ctxFor(PRESETS.everything))).toEqual([]);
  });
});
