import {
  suggestFromPeers,
  suggestFromSubjects,
  suggestGenre,
  vocabulary,
  type TaggedBook,
} from './genre-suggest';

const book = (
  title: string,
  author: string,
  genre: string,
  subgenre: string,
  series: string | null = null,
): TaggedBook => ({ title, author, series, genre, subgenre });

/** A catalogue like the starter one: its own names, such as "Military SF" and "LitRPG". */
const tagged: TaggedBook[] = [
  book('A', 'Ann Author', 'Science Fiction', 'Space Opera'),
  book('B', 'Ann Author', 'Science Fiction', 'Space Opera'),
  book('C', 'Bo Writer', 'Science Fiction', 'Military SF'),
  book('D', 'Bo Writer', 'Science Fiction', 'Hard SF'),
  book('E', 'Cy Penman', 'Fantasy', 'Epic Fantasy', 'The Long Road'),
  book('F', 'Cy Penman', 'Fantasy', 'Epic Fantasy', 'The Long Road'),
  book('G', 'Cy Penman', 'Horror', 'Supernatural'),
  book('H', 'Di Gamer', 'LitRPG', 'LitRPG'),
  book('I', 'Ed Noir', 'Thriller', 'Crime'),
  book('J', 'Fi Teen', 'Young Adult', 'YA Sci-Fi'),
  book('K', 'Fi Teen', 'Young Adult', 'YA Dystopian'),
  book('L', 'Gus Coder', 'Non-fiction', 'Programming'),
  book('M', 'Hal Heist', 'Fantasy', 'Heist Fantasy'),
  book('N', 'Ivy Untagged', 'Untagged', 'Untagged'),
];
const vocab = vocabulary(tagged);
const fromSubjects = (...subjects: string[]) => {
  const s = suggestFromSubjects(subjects, vocab);
  return s && [s.genre, s.subgenre];
};

describe('vocabulary', () => {
  it('lists the pairs in use, most used first, leaving out Untagged', () => {
    expect(vocab[0]).toEqual({ genre: 'Fantasy', subgenre: 'Epic Fantasy', count: 2 });
    expect(vocab.some((v) => v.genre === 'Untagged')).toBe(false);
    expect(vocab).toHaveLength(11);
  });
});

describe('suggestFromSubjects', () => {
  it('maps common Open Library subjects onto the catalogue’s own names', () => {
    expect(fromSubjects('Science fiction', 'Space warfare', 'Fiction')).toEqual([
      'Science Fiction',
      'Military SF',
    ]);
    expect(fromSubjects('Fiction, science fiction, space opera', 'Interstellar travel')).toEqual([
      'Science Fiction',
      'Space Opera',
    ]);
    expect(fromSubjects('Fantasy fiction', 'Fiction, fantasy, epic', 'Dragons')).toEqual([
      'Fantasy',
      'Epic Fantasy',
    ]);
    expect(fromSubjects('LitRPG', 'Fantasy fiction')).toEqual(['LitRPG', 'LitRPG']);
    expect(fromSubjects('Detective and mystery stories', 'Murder')).toEqual(['Thriller', 'Crime']);
    expect(fromSubjects('Ghost stories', 'Horror tales', 'Haunted houses')).toEqual([
      'Horror',
      'Supernatural',
    ]);
    expect(fromSubjects('Computer programming', 'JavaScript (Computer program language)')).toEqual([
      'Non-fiction',
      'Programming',
    ]);
  });

  it('matches names however they are written', () => {
    const v = vocabulary([book('X', 'Y', 'Sci-Fi', 'Military Science Fiction')]);
    const s = suggestFromSubjects(['Science fiction', 'Military science fiction'], v);
    expect([s?.genre, s?.subgenre]).toEqual(['Sci-Fi', 'Military Science Fiction']);
  });

  it('falls back to a common name when the catalogue has nothing that fits', () => {
    expect(fromSubjects('Love stories', 'Romance fiction')).toEqual(['Romance', 'Romance']);
    expect(fromSubjects('Biography', 'Musicians')).toEqual(['Non-fiction', 'Biography']);
    // a genre without a subgenre signal gets the genre's own name as its subgenre
    expect(fromSubjects('Espionage', 'Suspense fiction')).toEqual(['Thriller', 'Thriller']);
  });

  it('uses a subgenre the catalogue pairs with the genre, even from a loose subject', () => {
    expect(fromSubjects('Fantasy fiction', 'Thieves', 'Magic')).toEqual([
      'Fantasy',
      'Heist Fantasy',
    ]);
    // but not under a genre the owner never pairs it with
    expect(fromSubjects('Thieves', 'Thrillers (Fiction)')).toEqual(['Thriller', 'Thriller']);
  });

  it('files young adult books the way the owner does', () => {
    expect(fromSubjects('Young adult fiction', 'Science fiction')).toEqual([
      'Young Adult',
      'YA Sci-Fi',
    ]);
    expect(fromSubjects('Juvenile fiction', 'Dystopias', 'Science fiction')).toEqual([
      'Young Adult',
      'YA Dystopian',
    ]);
    // a catalogue without a YA genre just gets the genre
    const noYa = vocabulary(tagged.filter((b) => b.genre !== 'Young Adult'));
    expect(suggestFromSubjects(['Young adult fiction', 'Science fiction'], noYa)?.genre).toBe(
      'Science Fiction',
    );
  });

  it('does not take historical fiction for history', () => {
    expect(fromSubjects('History', 'Rome')).toEqual(['Non-fiction', 'History']);
    expect(fromSubjects('Historical fiction', 'Fantasy fiction', 'Rome, history')).toEqual([
      'Fantasy',
      'Fantasy',
    ]);
  });

  it('shows which subjects led to it, and how sure it is', () => {
    const s = suggestFromSubjects(
      [
        'Accessible book',
        'Science fiction',
        'Space opera',
        'Interstellar travel',
        'Large type books',
      ],
      vocab,
    )!;
    expect(s.subjects).toEqual(['Science fiction', 'Space opera', 'Interstellar travel']);
    expect(s.basis).toBe('subjects');
    expect(s.confidence).toBe('high');
    expect(suggestFromSubjects(['Robots'], vocab)?.confidence).toBe('low');
  });

  it('suggests nothing when no subject says anything about genre', () => {
    expect(fromSubjects('Accessible book', 'Protected DAISY', 'In library')).toBeNull();
    expect(fromSubjects()).toBeNull();
  });

  it('works with an empty catalogue', () => {
    const s = suggestFromSubjects(['Science fiction', 'Time travel'], []);
    expect([s?.genre, s?.subgenre]).toEqual(['Science Fiction', 'Time Travel']);
  });
});

describe('suggestFromPeers', () => {
  it('follows the series first', () => {
    const s = suggestFromPeers({ author: 'Cy Penman', series: 'the long road' }, tagged)!;
    expect(s).toMatchObject({
      genre: 'Fantasy',
      subgenre: 'Epic Fantasy',
      basis: 'series',
      confidence: 'high',
      like: ['E', 'F'],
    });
  });

  it('then the author, when two thirds of their books share a genre', () => {
    expect(suggestFromPeers({ author: 'ann author', series: null }, tagged)).toMatchObject({
      genre: 'Science Fiction',
      subgenre: 'Space Opera',
      basis: 'author',
      confidence: 'medium',
    });
    // Bo Writer: always SF, the subgenre is the commonest (a tie goes to the first name)
    expect(suggestFromPeers({ author: 'Bo Writer', series: null }, tagged)?.genre).toBe(
      'Science Fiction',
    );
    // Cy Penman: 2 of 3 fantasy, which is enough
    expect(suggestFromPeers({ author: 'Cy Penman', series: null }, tagged)?.genre).toBe('Fantasy');
    // half and half isn't
    const mixed = [book('P', 'Mo', 'Fantasy', 'Epic Fantasy'), book('Q', 'Mo', 'Horror', 'Zombie')];
    expect(suggestFromPeers({ author: 'Mo', series: null }, mixed)).toBeNull();
  });

  it('ignores unknown authors and untagged books', () => {
    const t = [book('P', 'Unknown', 'Fantasy', 'Epic Fantasy')];
    expect(suggestFromPeers({ author: 'Unknown', series: null }, t)).toBeNull();
    expect(suggestFromPeers({ author: 'Ivy Untagged', series: null }, [])).toBeNull();
  });
});

describe('suggestGenre', () => {
  it('prefers series and author over subjects', () => {
    const s = suggestGenre({ author: 'Ann Author', series: null }, ['Horror tales'], tagged);
    expect([s?.genre, s?.basis]).toEqual(['Science Fiction', 'author']);
    const t = suggestGenre({ author: 'Nobody', series: null }, ['Horror tales'], tagged);
    expect([t?.genre, t?.basis]).toEqual(['Horror', 'subjects']);
  });
});
