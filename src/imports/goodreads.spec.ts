import { parseCsv } from './csv';
import { goodreadsCsv, parseReadingExport } from './goodreads';

const GOODREADS_HEADER =
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies';

const GOODREADS_CSV = [
  GOODREADS_HEADER,
  '1885,Pride and Prejudice,Jane Austen,"Austen, Jane",,"=""0141439513""","=""9780141439518""",5,4.29,Penguin,Paperback,480,2002,1813,2021/03/14,2020/12/01,"classics, favourites","classics (#3), favourites (#1)",read,"Loved it, again.",,,2,0',
  '34,"The Colour of Magic (Discworld, #1)",Terry Pratchett,"Pratchett, Terry",,"=""""","=""""",3,3.98,,,288,1985,1983,,2019/05/02,,,read,,,,1,0',
  '99,Middlemarch,George Eliot,"Eliot, George",,"=""""","=""""",0,3.99,,,880,2003,1871,,2022/01/02,to-read,to-read (#4),to-read,,,,0,0',
].join('\r\n');

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and newlines inside quotes', () => {
    expect(parseCsv('a,"b ""c""","d\ne"\r\n1,2,3\n')).toEqual([
      ['a', 'b "c"', 'd\ne'],
      ['1', '2', '3'],
    ]);
  });
});

describe('parseReadingExport', () => {
  it('reads a Goodreads library export', () => {
    const { source, books } = parseReadingExport(GOODREADS_CSV);
    expect(source).toBe('goodreads');
    expect(books).toHaveLength(3);
    expect(books[0]).toEqual({
      id: '1885',
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      isbn13: '9780141439518',
      isbn10: '0141439513',
      rating: 5,
      shelves: ['classics', 'favourites'],
      shelf: 'read',
      read_count: 2,
      date_added: '2020-12-01',
      pages: 480,
      reads: [{ start: null, end: '2021-03-14', finished: true }],
    });
    // no ISBN, no date read: finished at an unknown time
    expect(books[1]).toMatchObject({ isbn13: null, rating: 3, reads: [], read_count: 1 });
    // unrated (0) and to-read
    expect(books[2]).toMatchObject({ rating: null, shelf: 'to-read', shelves: [] });
  });

  it('reads a StoryGraph export', () => {
    const csv = [
      'Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?',
      'Emma,Jane Austen,,9780141439587,paperback,read,2023/01/01,2024/02/09,"2023/01/05-2023/01/20, 2024/02/01-2024/02/09",2,,,,,,,,4.25,,,,"comfort, classics",Yes',
      'Ulysses,"James Joyce, Someone Else",,a1b2c3,ebook,did-not-finish,2023/03/01,2023/04/01,2023/03/02-2023/04/01,0,,,,,,,,,,,,,No',
    ].join('\n');
    const { source, books } = parseReadingExport(csv);
    expect(source).toBe('storygraph');
    expect(books[0]).toMatchObject({
      id: '9780141439587',
      isbn13: '9780141439587',
      rating: 4.25,
      shelves: ['comfort', 'classics'],
      read_count: 2,
      reads: [
        { start: '2023-01-05', end: '2023-01-20', finished: true },
        { start: '2024-02-01', end: '2024-02-09', finished: true },
      ],
    });
    expect(books[1]).toMatchObject({
      author: 'James Joyce',
      isbn13: null,
      shelf: 'did-not-finish',
      reads: [{ start: '2023-03-02', end: '2023-04-01', finished: false }],
    });
  });

  it('refuses anything else', () => {
    expect(() => parseReadingExport('a,b\n1,2\n')).toThrow(/Goodreads or StoryGraph/);
  });
});

describe('goodreadsCsv', () => {
  it('writes finished books in the layout Goodreads imports, and reads back', () => {
    const csv = goodreadsCsv([
      {
        title: 'Emma, Volume 1',
        author: 'Jane Austen',
        isbn10: '0141439580',
        isbn13: '9780141439587',
        rating: 4.25,
        shelves: ['classics'],
        finished: ['2023-01-20', '2024-02-09'],
        first_read: '2023-01-05',
      },
    ]);
    const [header, row] = parseCsv(csv);
    expect(header).toContain('Exclusive Shelf');
    expect(row).toEqual([
      'Emma, Volume 1',
      'Jane Austen',
      '="0141439580"',
      '="9780141439587"',
      '4',
      '2024/02/09',
      '2023/01/05',
      'classics',
      'read',
      '2',
    ]);
  });
});
