import {
  duplicateOf,
  editBook,
  emptyWant,
  MAX_ORDER,
  moveInOrder,
  normaliseWant,
  toHiddenKey,
  toNewBook,
  toOrderKey,
  WantError,
  type WantFile,
  wantId,
} from './want-to-read';

const TODAY = '2026-10-24';

describe('the want-to-read list', () => {
  it('makes a book from what the admin sends, tidied, with a free id', () => {
    const file: WantFile = {
      ...emptyWant(),
      books: [toNewBook({ title: 'Kim' }, emptyWant(), TODAY)],
    };
    const b = toNewBook(
      {
        title: '  Kim  ',
        author: ' Rudyard   Kipling ',
        series: '',
        series_no: '2',
        isbn13: '978-0-14-144237-2',
        work_id: '/works/OL1W',
        note: ' mine ',
        from: 'search',
      },
      file,
      TODAY,
    );
    expect(b).toMatchObject({
      id: 'mine:kim-2',
      title: 'Kim',
      author: 'Rudyard Kipling',
      series: null,
      series_no: 2,
      isbn13: '9780141442372',
      work_id: 'OL1W',
      genre: 'Untagged',
      note: 'mine',
      added: TODAY,
      from: 'search',
    });
    expect(file.books[0]).toMatchObject({ id: 'mine:kim', from: 'manual' });
  });

  it('keeps the day a kept book went on its shelf, but never a day to come', () => {
    const kept = toNewBook(
      { title: 'A', added: '2020-01-02', from: 'goodreads' },
      emptyWant(),
      TODAY,
    );
    expect(kept.added).toBe('2020-01-02');
    expect(toNewBook({ title: 'A', added: '2030-01-02' }, emptyWant(), TODAY).added).toBe(TODAY);
  });

  it('turns down what it cannot keep', () => {
    const bad = (body: unknown) =>
      expect(() => toNewBook(body, emptyWant(), TODAY)).toThrow(WantError);
    bad({});
    bad({ title: '   ' });
    bad({ title: 'x'.repeat(301) });
    bad({ title: 'A', isbn13: '123' });
    bad({ title: 'A', from: 'nowhere' });
    bad({ title: 'A', pages: -1 });
    bad({ title: 'A', work_id: 'javascript:1' });
    bad({ title: 'A', note: 'x'.repeat(2001) });
    bad([]);
    const a = toNewBook({ title: 'A' }, emptyWant(), TODAY);
    expect(() => editBook(a, { title: '' })).toThrow(WantError);
  });

  it('edits only the fields sent', () => {
    const b = toNewBook({ title: 'Kim', author: 'Kipling' }, emptyWant(), TODAY);
    expect(editBook(b, { note: 'later' })).toEqual({ ...b, note: 'later' });
  });

  it('finds a duplicate by ISBN, then title and author', () => {
    const kim = toNewBook(
      { title: 'Kim', author: 'Rudyard Kipling', isbn13: '9780141442372' },
      emptyWant(),
      TODAY,
    );
    const file = { ...emptyWant(), books: [kim] };
    const like = (body: object) => duplicateOf(toNewBook(body, file, TODAY), file);
    expect(like({ title: 'Kim (Penguin)', author: 'Kipling, Rudyard' })).toBe(kim);
    expect(like({ title: 'Other', isbn13: '9780141442372' })).toBe(kim);
    expect(like({ title: 'Kim', author: 'Someone Else' })).toBeNull();
    // not a duplicate of itself
    expect(duplicateOf(kim, file)).toBeNull();
  });

  it('checks a key to hide', () => {
    expect(toHiddenKey(' goodreads:12 ')).toBe('goodreads:12');
    expect(() => toHiddenKey('')).toThrow(WantError);
    expect(() => toHiddenKey('mine:kim')).toThrow(WantError);
    expect(() => toHiddenKey(3)).toThrow(WantError);
  });

  it('reads a hand-edited file leniently', () => {
    const f = normaliseWant({
      books: [
        { title: 'Kim', id: 'mine:kim' },
        { title: 'Kim', id: 'mine:kim' },
        { id: 'x' },
        null,
      ],
      hidden: ['a', 'a', 3],
    });
    expect(f.books.map((b) => [b.id, b.genre, b.from])).toEqual([
      ['mine:kim', 'Untagged', 'manual'],
      ['mine:kim-2', 'Untagged', 'manual'],
    ]);
    expect(f.hidden).toEqual(['a']);
    expect(normaliseWant('nonsense')).toEqual(emptyWant());
  });

  it('slugs ids from titles', () => {
    expect(wantId('Les Misérables!', [])).toBe('mine:les-miserables');
    expect(wantId('???', [])).toBe('mine:book');
  });
});

describe('Up next', () => {
  it('moves a book to a place, takes it out, and keeps one copy', () => {
    let o: string[] = [];
    o = moveInOrder(o, 'a', 0);
    o = moveInOrder(o, 'b', 5); // past the end: last
    o = moveInOrder(o, 'c', 0);
    expect(o).toEqual(['c', 'a', 'b']);
    expect(moveInOrder(o, 'b', 0)).toEqual(['b', 'c', 'a']);
    expect(moveInOrder(o, 'c', 2)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(o, 'a', null)).toEqual(['c', 'b']);
    expect(() => moveInOrder(o, 'd', -1)).toThrow(WantError);
    expect(() => moveInOrder(o, 'd', 1.5)).toThrow(WantError);
  });

  it('holds a limited number, and checks keys', () => {
    const full = Array.from({ length: MAX_ORDER }, (_, i) => `k${i}`);
    expect(() => moveInOrder(full, 'new', 0)).toThrow(WantError);
    expect(moveInOrder(full, 'k5', 0)[0]).toBe('k5'); // moving within is fine
    expect(toOrderKey(' mine:kim ')).toBe('mine:kim');
    expect(() => toOrderKey('')).toThrow(WantError);
    expect(() => toOrderKey('a\nb')).toThrow(WantError);
  });

  it('is read leniently, and an old file has none', () => {
    expect(normaliseWant({ books: [] }).order).toEqual([]);
    expect(normaliseWant({ order: ['a', 3, 'a', 'b'] }).order).toEqual(['a', 'b']);
  });
});
