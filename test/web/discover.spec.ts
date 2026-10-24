import { loadCalcs } from '../support/feature-calcs';

type Work = {
  title: string;
  editions: number | null;
  published_year: number | null;
  on_pile: boolean;
  series_mine: boolean;
};
type Author = {
  author: string;
  books: number;
  finished: number;
  avg_rating: number | null;
  hours: number;
  works: Work[];
  on_pile: number;
};
type Entry = { title: string; series_no: number | null; state: string; next: boolean };
type Gap = {
  series: string;
  read: number;
  reading: number;
  unread: number;
  missing: number;
  entries: Entry[];
  next_up: Entry | null;
};
type Pick = { kind: string; title: string; author: string; series: string | null };

const run = loadCalcs('calcs.js', 'features/discover.js');

let n = 0;
function book(o: Record<string, unknown>) {
  n++;
  return {
    id: 'b' + n,
    title: 'Book ' + n,
    author: 'Someone',
    series: null,
    series_no: null,
    genre: 'Mystery',
    status: 'finished',
    hours: 5,
    last_read: '2026-01-01',
    ...o,
  };
}
function work(o: Record<string, unknown>) {
  return {
    work_id: null,
    title: 'Work',
    author: 'Someone',
    published_year: 1900,
    editions: 100,
    series: null,
    series_no: null,
    isbn13: null,
    why: ['author'],
    on_pile: false,
    ...o,
  };
}

const books = [
  book({ title: 'Styles', author: 'Agatha Christie', series: 'Poirot', series_no: 1, rating: 5 }),
  book({ title: 'Links', author: 'Agatha Christie', series: 'Poirot', series_no: 3, rating: 4 }),
  book({
    title: 'Ackroyd',
    author: 'Agatha Christie',
    series: 'Poirot',
    series_no: 5,
    status: 'not_started',
    hours: 0,
  }),
  book({
    title: 'Adversary',
    author: 'Agatha Christie',
    series: 'Tommy and Tuppence',
    series_no: null,
    last_read: '2026-05-01',
  }),
  book({
    title: 'Emma',
    author: 'Jane Austen',
    status: 'in_progress',
    hours: 2.25,
    last_read: '2026-06-01',
  }),
  book({
    title: 'Unread one',
    author: 'Nobody',
    series: 'Untouched',
    series_no: 1,
    status: 'not_started',
  }),
];
const bibliography = [
  work({
    title: 'Blue Train',
    author: 'Agatha Christie',
    series: 'Poirot',
    series_no: 6,
    published_year: 1928,
    editions: 300,
  }),
  work({
    title: 'Big Four',
    author: 'Agatha Christie',
    series: 'Poirot',
    series_no: 4,
    published_year: 1927,
    editions: 200,
    on_pile: true,
  }),
  work({
    title: 'Lost Poirot',
    author: 'Agatha Christie',
    series: 'Poirot',
    series_no: null,
    published_year: 1940,
    editions: null,
  }),
  work({ title: 'Murder Is Easy', author: 'Agatha Christie', published_year: 1939, editions: 300 }),
  work({ title: 'Mansfield Park', author: 'Jane Austen', published_year: 1814, editions: 900 }),
  work({ title: 'Lady Susan', author: 'Jane Austen', published_year: 1871, editions: 160 }),
  work({
    title: 'Partners in Crime',
    author: 'Agatha Christie',
    series: 'Tommy and Tuppence',
    series_no: null,
    published_year: 1929,
  }),
  work({
    title: 'Secret of Chimneys',
    author: 'Agatha Christie',
    series: 'Not Mine',
    series_no: 1,
    published_year: 1925,
  }),
];
const data = (bib: unknown = bibliography, reads: unknown[] = []) => ({
  books,
  reads,
  bibliography: bib,
});

describe('unread_by_author', () => {
  const rows = run<Author>('unread_by_author', data());
  const christie = rows.find((r) => r.author === 'Agatha Christie')!;
  const austen = rows.find((r) => r.author === 'Jane Austen')!;

  it('groups the works by author, most editions first, then oldest', () => {
    expect(rows.map((r) => r.author)).toEqual(['Agatha Christie', 'Jane Austen']);
    expect(christie.works.map((w) => w.title)).toEqual([
      'Blue Train',
      'Murder Is Easy',
      'Big Four',
      'Secret of Chimneys',
      'Partners in Crime',
      'Lost Poirot',
    ]);
    expect(austen.works.map((w) => w.title)).toEqual(['Mansfield Park', 'Lady Susan']);
  });

  it('adds what you have of theirs: finished, average rating and hours', () => {
    expect(christie).toMatchObject({
      books: 4,
      finished: 3,
      avg_rating: 4.5,
      hours: 15,
      on_pile: 1,
    });
    expect(austen).toMatchObject({ books: 1, finished: 0, avg_rating: null, hours: 2.3 });
  });

  it('marks series that are yours', () => {
    expect(christie.works.find((w) => w.title === 'Blue Train')!.series_mine).toBe(true);
    expect(christie.works.find((w) => w.title === 'Secret of Chimneys')!.series_mine).toBe(false);
  });

  it('counts a finished read as finished', () => {
    const r = run<Author>(
      'unread_by_author',
      data(bibliography, [{ book_id: books[4].id, finished: true }]),
    );
    expect(r.find((x) => x.author === 'Jane Austen')!.finished).toBe(1);
  });

  it('is empty without a bibliography', () => {
    expect(run('unread_by_author', data([]))).toEqual([]);
    expect(run('unread_by_author', data({}))).toEqual([]);
  });
});

describe('series_gaps', () => {
  const rows = run<Gap>('series_gaps', data());
  const poirot = rows.find((r) => r.series === 'Poirot')!;

  it('lists every known entry in order, numbered ones first and the rest by year', () => {
    expect(poirot.entries.map((e) => [e.series_no, e.title, e.state])).toEqual([
      [1, 'Styles', 'read'],
      [3, 'Links', 'read'],
      [4, 'Big Four', 'on_pile'],
      [5, 'Ackroyd', 'not_started'],
      [6, 'Blue Train', 'unread'],
      [null, 'Lost Poirot', 'unread'],
    ]);
    expect(poirot).toMatchObject({ read: 2, reading: 0, unread: 4, missing: 3 });
  });

  it('takes next up as the first unread after the highest one read', () => {
    expect(poirot.next_up).toMatchObject({ title: 'Big Four', series_no: 4 });
    expect(poirot.entries.filter((e) => e.next).map((e) => e.title)).toEqual(['Big Four']);
  });

  it('skips a gap before what you have read', () => {
    const bib = [
      work({ title: 'Prequel', author: 'Agatha Christie', series: 'Poirot', series_no: 2 }),
    ];
    const p = run<Gap>('series_gaps', data(bib)).find((r) => r.series === 'Poirot')!;
    expect(p.entries.map((e) => e.title)).toEqual(['Styles', 'Prequel', 'Links', 'Ackroyd']);
    expect(p.next_up!.title).toBe('Ackroyd');
  });

  it('falls back to the first unread when the numbers are missing', () => {
    const tt = rows.find((r) => r.series === 'Tommy and Tuppence')!;
    expect(tt.entries.map((e) => [e.title, e.state])).toEqual([
      ['Partners in Crime', 'unread'],
      ['Adversary', 'read'],
    ]);
    expect(tt.next_up!.title).toBe('Partners in Crime');
  });

  it('leaves out series you have not started and ones that are not yours', () => {
    expect(rows.map((r) => r.series)).toEqual(['Tommy and Tuppence', 'Poirot']);
  });

  it('has no next up when everything is read', () => {
    const solo = [book({ title: 'Only', series: 'Solo', series_no: 1 })];
    const r = run<Gap>('series_gaps', { books: solo, reads: [], bibliography: [] });
    expect(r[0]).toMatchObject({ series: 'Solo', unread: 0, missing: 0, next_up: null });
  });

  it('still shows your own series without a bibliography', () => {
    const r = run<Gap>('series_gaps', data([]));
    const p = r.find((x) => x.series === 'Poirot')!;
    expect(p.missing).toBe(0);
    expect(p.next_up!.title).toBe('Ackroyd');
  });
});

describe('discover_picks', () => {
  it('puts series next-ups first, most recent series first, then liked authors', () => {
    const rows = run<Pick>('discover_picks', data());
    expect(rows.map((r) => [r.kind, r.title])).toEqual([
      ['series', 'Partners in Crime'],
      ['series', 'Big Four'],
      ['author', 'Blue Train'],
      ['author', 'Murder Is Easy'],
      ['author', 'Secret of Chimneys'],
      ['author', 'Lost Poirot'],
    ]);
  });

  it('leaves out authors you have not finished two of or rated 4+', () => {
    const rows = run<Pick>('discover_picks', data());
    expect(rows.some((r) => r.author === 'Jane Austen')).toBe(false);
  });

  it('is empty without a bibliography or a started series', () => {
    expect(run('discover_picks', { books: [], reads: [], bibliography: [] })).toEqual([]);
  });
});
