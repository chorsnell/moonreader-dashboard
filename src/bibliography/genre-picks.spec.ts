import type { BibliographyFile, SubjectWork } from './bibliography.types';
import {
  PICKS_PER_GENRE,
  buildGenrePicks,
  defaultSubject,
  discoveryTargets,
  readOverrides,
  slugify,
  subjectFor,
  subjectWorks,
  subjectsToLookUp,
} from './genre-picks';

describe('genre → Open Library subject', () => {
  it('maps the known genres', () => {
    expect(defaultSubject('Science Fiction')).toBe('science_fiction');
    expect(defaultSubject('Fantasy')).toBe('fantasy');
    expect(defaultSubject('Horror')).toBe('horror');
    expect(defaultSubject('Thriller')).toBe('thrillers');
    expect(defaultSubject('Young Adult')).toBe('young_adult_fiction');
    expect(defaultSubject('Literary Fiction')).toBe('literary_fiction');
    expect(defaultSubject('Classics')).toBe('classic_literature');
    expect(defaultSubject('LitRPG')).toBe('litrpg');
    expect(defaultSubject('Mystery')).toBe('mystery_and_detective_stories');
    expect(defaultSubject('Crime')).toBe('mystery_and_detective_stories');
    expect(defaultSubject('Mystery/Crime')).toBe('mystery_and_detective_stories');
    expect(defaultSubject('Romance')).toBe('romance');
    expect(defaultSubject('Historical Fiction')).toBe('historical_fiction');
  });

  it('skips Non-fiction and untagged books', () => {
    expect(defaultSubject('Non-fiction')).toBeNull();
    expect(defaultSubject('Nonfiction')).toBeNull();
    expect(defaultSubject('Untagged')).toBeNull();
    expect(defaultSubject('')).toBeNull();
    expect(defaultSubject(null)).toBeNull();
  });

  it('slugifies anything else', () => {
    expect(defaultSubject('Time Travel')).toBe('time_travel');
    expect(defaultSubject('Sword & Sorcery')).toBe('sword_and_sorcery');
    expect(defaultSubject("Children's Books")).toBe('children_s_books');
    expect(slugify('  Ghost  Story! ')).toBe('ghost_story');
    expect(slugify('Fantastique Ésotérique')).toBe('fantastique_esoterique');
  });

  it('lets the admin override a genre, or skip it', () => {
    const overrides = readOverrides({
      subjects: { 'Portal Fantasy': 'Fantasy Fiction', classics: '', Bad: 3 },
    });
    expect(overrides).toEqual({ 'Portal Fantasy': 'fantasy_fiction', classics: '' });
    expect(subjectFor('Portal Fantasy', overrides)).toBe('fantasy_fiction');
    expect(subjectFor('Classics', overrides)).toBeNull(); // case doesn't matter
    expect(subjectFor('Horror', overrides)).toBe('horror');
    expect(subjectFor('Untagged', { Untagged: 'x' })).toBeNull();
    expect(readOverrides(null)).toEqual({});
    expect(readOverrides({ subjects: ['x'] })).toEqual({});
  });
});

describe('discoveryTargets', () => {
  const book = (genre: string, subgenre: string) => ({ title: 'x', genre, subgenre });
  const books = [
    book('Classics', 'Gothic'),
    book('Classics', 'Gothic'),
    book('Horror', 'Gothic'),
    book('Classics', 'Victorian'),
    book('Classics', 'Victorian'),
    book('Non-fiction', 'Memoir'),
    book('Untagged', 'Untagged'),
  ];

  it('lists every genre and the subgenres with three or more books', () => {
    expect(discoveryTargets(books).map((t) => [t.genre, t.subgenre, t.books, t.subject])).toEqual([
      ['Classics', null, 4, 'classic_literature'],
      ['Horror', null, 1, 'horror'],
      ['Non-fiction', null, 1, null],
      // counted across genres, under the genre most of its books are in
      ['Classics', 'Gothic', 3, 'gothic'],
    ]);
  });

  it('looks each subject up once', () => {
    const targets = discoveryTargets(books, { Gothic: 'horror' });
    expect(targets.find((t) => t.subgenre === 'Gothic')).toMatchObject({
      default_subject: 'gothic',
      subject: 'horror',
    });
    expect(subjectsToLookUp(targets)).toEqual(['classic_literature', 'horror']);
  });
});

describe('subjectWorks', () => {
  it('reads Open Library’s subject works defensively, in its order', () => {
    expect(
      subjectWorks([
        {
          key: '/works/OL27448W',
          title: ' The  Lord of the Rings ',
          authors: [{ key: '/authors/OL26320A', name: 'J.R.R. Tolkien' }],
          first_publish_year: 1954,
          edition_count: 200,
          cover_id: 1,
        },
        { key: 'nonsense', title: 'No Author', authors: 'x', first_publish_year: '1900' },
        { title: '' },
        null,
        'x',
      ]),
    ).toEqual([
      {
        work_id: 'OL27448W',
        title: 'The Lord of the Rings',
        author: 'J.R.R. Tolkien',
        year: 1954,
        editions: 200,
      },
      { work_id: null, title: 'No Author', author: '', year: null, editions: null },
    ]);
    expect(subjectWorks({ works: [] })).toEqual([]);
  });
});

describe('buildGenrePicks', () => {
  const w = (n: number, title: string, author = 'Some Author'): SubjectWork => ({
    work_id: `OL${n}W`,
    title,
    author,
    year: 1900 + n,
    editions: 100 - n,
  });
  const file: BibliographyFile = {
    authors: {},
    subjects: {
      classic_literature: {
        looked_up: '2026-10-01',
        works: [
          w(1, 'Pride and Prejudice', 'Jane Austen'), // read, by work id
          w(2, 'Emma', 'Austen, Jane'), // read, by title and author
          w(3, 'Moby Dick', 'Herman Melville'),
          w(4, 'Study Guide: Moby Dick'),
          w(5, 'The Brontë Sisters Box Set'),
          w(6, 'Middlemarch', 'George Eliot'), // on the pile
          w(3, 'Moby Dick', 'Herman Melville'), // twice
        ],
      },
      gothic: { looked_up: '2026-10-01', works: [w(7, 'Rebecca', 'Daphne du Maurier')] },
    },
  };
  const books = [
    {
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      genre: 'Classics',
      subgenre: 'Romance',
      work_id: 'OL1W',
    },
    { title: 'Emma', author: 'Jane Austen', genre: 'Classics', subgenre: 'Gothic' },
    { title: 'Jane Eyre', author: 'Charlotte Brontë', genre: 'Classics', subgenre: 'Gothic' },
    { title: 'Dracula', author: 'Bram Stoker', genre: 'Horror', subgenre: 'Gothic' },
  ];
  const pile = [{ title: 'Middlemarch', author: 'George Eliot' }];

  it('keeps unread works in Open Library’s order, without junk, marking the pile', () => {
    const rows = buildGenrePicks(books, pile, file);
    expect(rows.map((r) => [r.genre, r.subgenre, r.title, r.author, r.rank, r.on_pile])).toEqual([
      ['Classics', null, 'Moby Dick', 'Herman Melville', 3, false],
      ['Classics', null, 'Middlemarch', 'George Eliot', 6, true],
      ['Classics', 'Gothic', 'Rebecca', 'Daphne du Maurier', 1, false],
    ]);
    expect(rows[0]).toEqual({
      genre: 'Classics',
      subgenre: null,
      work_id: 'OL3W',
      title: 'Moby Dick',
      author: 'Herman Melville',
      published_year: 1903,
      editions: 97,
      rank: 3,
      on_pile: false,
    });
  });

  it('follows the overrides, and copes with no subjects', () => {
    expect(buildGenrePicks(books, pile, file, { Classics: '' }).map((r) => r.title)).toEqual([
      'Rebecca',
    ]);
    expect(buildGenrePicks(books, pile, file, { Horror: 'gothic' }).map((r) => r.genre)).toEqual([
      'Classics',
      'Classics',
      'Horror',
      'Classics',
    ]);
    expect(buildGenrePicks(books, pile, { authors: {} })).toEqual([]);
    expect(buildGenrePicks(books, pile, null)).toEqual([]);
  });

  it('keeps at most 25 a genre', () => {
    const many: BibliographyFile = {
      authors: {},
      subjects: {
        horror: {
          looked_up: '2026-10-01',
          works: Array.from({ length: 50 }, (_, i) => w(100 + i, `Book ${i}`)),
        },
      },
    };
    const rows = buildGenrePicks([{ title: 'Dracula', genre: 'Horror' }], [], many);
    expect(rows).toHaveLength(PICKS_PER_GENRE);
    expect(rows.at(-1)!.rank).toBe(25);
  });
});
