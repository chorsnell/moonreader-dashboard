/** title, author, genre, subgenre, series, series number, words: all public domain. */
export type DemoBook = [
  title: string,
  author: string,
  genre: string,
  subgenre: string,
  series: string | null,
  seriesNo: number | null,
  words: number,
];

export const BOOKS: DemoBook[] = [
  ['The Time Machine', 'H. G. Wells', 'Science Fiction', 'Time Travel', null, null, 32000],
  ['The War of the Worlds', 'H. G. Wells', 'Science Fiction', 'Alien Invasion', null, null, 60000],
  ['The Invisible Man', 'H. G. Wells', 'Science Fiction', 'Scientific Romance', null, null, 49000],
  [
    'The Island of Doctor Moreau',
    'H. G. Wells',
    'Science Fiction',
    'Scientific Romance',
    null,
    null,
    43000,
  ],
  [
    'Twenty Thousand Leagues Under the Seas',
    'Jules Verne',
    'Science Fiction',
    'Voyages Extraordinaires',
    null,
    null,
    138000,
  ],
  [
    'Journey to the Centre of the Earth',
    'Jules Verne',
    'Science Fiction',
    'Voyages Extraordinaires',
    null,
    null,
    80000,
  ],
  ['The Lost World', 'Arthur Conan Doyle', 'Science Fiction', 'Lost World', null, null, 75000],
  [
    'A Princess of Mars',
    'Edgar Rice Burroughs',
    'Science Fiction',
    'Planetary Romance',
    'Barsoom',
    1,
    63000,
  ],
  [
    'The Gods of Mars',
    'Edgar Rice Burroughs',
    'Science Fiction',
    'Planetary Romance',
    'Barsoom',
    2,
    75000,
  ],
  [
    'The Warlord of Mars',
    'Edgar Rice Burroughs',
    'Science Fiction',
    'Planetary Romance',
    'Barsoom',
    3,
    70000,
  ],
  ['Herland', 'Charlotte Perkins Gilman', 'Science Fiction', 'Utopia', null, null, 57000],
  ['A Study in Scarlet', 'Arthur Conan Doyle', 'Mystery', 'Detective', 'Sherlock Holmes', 1, 43000],
  [
    'The Sign of the Four',
    'Arthur Conan Doyle',
    'Mystery',
    'Detective',
    'Sherlock Holmes',
    2,
    43000,
  ],
  [
    'The Adventures of Sherlock Holmes',
    'Arthur Conan Doyle',
    'Mystery',
    'Detective',
    'Sherlock Holmes',
    3,
    105000,
  ],
  [
    'The Memoirs of Sherlock Holmes',
    'Arthur Conan Doyle',
    'Mystery',
    'Detective',
    'Sherlock Holmes',
    4,
    92000,
  ],
  [
    'The Hound of the Baskervilles',
    'Arthur Conan Doyle',
    'Mystery',
    'Detective',
    'Sherlock Holmes',
    5,
    59000,
  ],
  ['The Moonstone', 'Wilkie Collins', 'Mystery', 'Sensation Novel', null, null, 196000],
  ['The Woman in White', 'Wilkie Collins', 'Mystery', 'Sensation Novel', null, null, 245000],
  [
    'The Mysterious Affair at Styles',
    'Agatha Christie',
    'Mystery',
    'Detective',
    'Hercule Poirot',
    1,
    57000,
  ],
  ['The Secret Adversary', 'Agatha Christie', 'Mystery', 'Spy', 'Tommy and Tuppence', 1, 75000],
  ['The Thirty-Nine Steps', 'John Buchan', 'Mystery', 'Spy', 'Richard Hannay', 1, 41000],
  ['Pride and Prejudice', 'Jane Austen', 'Classics', 'Romance', null, null, 122000],
  ['Emma', 'Jane Austen', 'Classics', 'Romance', null, null, 160000],
  ['Persuasion', 'Jane Austen', 'Classics', 'Romance', null, null, 84000],
  ['Sense and Sensibility', 'Jane Austen', 'Classics', 'Romance', null, null, 119000],
  ['Jane Eyre', 'Charlotte Brontë', 'Classics', 'Gothic', null, null, 183000],
  ['Wuthering Heights', 'Emily Brontë', 'Classics', 'Gothic', null, null, 107000],
  ['Great Expectations', 'Charles Dickens', 'Classics', 'Victorian', null, null, 183000],
  ['A Tale of Two Cities', 'Charles Dickens', 'Classics', 'Historical', null, null, 135000],
  ['A Christmas Carol', 'Charles Dickens', 'Classics', 'Victorian', null, null, 29000],
  ['Middlemarch', 'George Eliot', 'Classics', 'Victorian', null, null, 316000],
  ['Moby-Dick', 'Herman Melville', 'Classics', 'Sea Story', null, null, 206000],
  ['The Great Gatsby', 'F. Scott Fitzgerald', 'Classics', 'Modernist', null, null, 47000],
  ['Little Women', 'Louisa May Alcott', 'Classics', 'Coming of Age', null, null, 185000],
  ['The Picture of Dorian Gray', 'Oscar Wilde', 'Classics', 'Gothic', null, null, 78000],
  ['Anna Karenina', 'Leo Tolstoy', 'Classics', 'Russian', null, null, 350000],
  ['Crime and Punishment', 'Fyodor Dostoevsky', 'Classics', 'Russian', null, null, 211000],
  ['Treasure Island', 'Robert Louis Stevenson', 'Adventure', 'Pirates', null, null, 67000],
  ['Kidnapped', 'Robert Louis Stevenson', 'Adventure', 'Historical', null, null, 85000],
  ['The Count of Monte Cristo', 'Alexandre Dumas', 'Adventure', 'Revenge', null, null, 464000],
  ['The Three Musketeers', 'Alexandre Dumas', 'Adventure', 'Swashbuckler', null, null, 228000],
  ['Around the World in Eighty Days', 'Jules Verne', 'Adventure', 'Travel', null, null, 63000],
  ['The Call of the Wild', 'Jack London', 'Adventure', 'Wilderness', null, null, 32000],
  ['White Fang', 'Jack London', 'Adventure', 'Wilderness', null, null, 72000],
  ['The Prisoner of Zenda', 'Anthony Hope', 'Adventure', 'Swashbuckler', null, null, 58000],
  [
    "King Solomon's Mines",
    'H. Rider Haggard',
    'Adventure',
    'Lost World',
    'Allan Quatermain',
    1,
    80000,
  ],
  ['The Wonderful Wizard of Oz', 'L. Frank Baum', 'Fantasy', 'Portal Fantasy', 'Oz', 1, 39000],
  ['The Marvelous Land of Oz', 'L. Frank Baum', 'Fantasy', 'Portal Fantasy', 'Oz', 2, 41000],
  ['Ozma of Oz', 'L. Frank Baum', 'Fantasy', 'Portal Fantasy', 'Oz', 3, 40000],
  [
    "Alice's Adventures in Wonderland",
    'Lewis Carroll',
    'Fantasy',
    'Portal Fantasy',
    null,
    null,
    27000,
  ],
  ['Through the Looking-Glass', 'Lewis Carroll', 'Fantasy', 'Portal Fantasy', null, null, 30000],
  ['Peter Pan', 'J. M. Barrie', 'Fantasy', 'Fairy Tale', null, null, 47000],
  ['The Princess and the Goblin', 'George MacDonald', 'Fantasy', 'Fairy Tale', null, null, 54000],
  ["The King of Elfland's Daughter", 'Lord Dunsany', 'Fantasy', 'High Fantasy', null, null, 76000],
  ['Frankenstein', 'Mary Shelley', 'Horror', 'Gothic', null, null, 75000],
  ['Dracula', 'Bram Stoker', 'Horror', 'Vampires', null, null, 160000],
  ['Carmilla', 'Sheridan Le Fanu', 'Horror', 'Vampires', null, null, 30000],
  [
    'Strange Case of Dr Jekyll and Mr Hyde',
    'Robert Louis Stevenson',
    'Horror',
    'Gothic',
    null,
    null,
    25000,
  ],
  ['The Turn of the Screw', 'Henry James', 'Horror', 'Ghost Story', null, null, 42000],
  ['The Phantom of the Opera', 'Gaston Leroux', 'Horror', 'Gothic', null, null, 85000],
  ['Walden', 'Henry David Thoreau', 'Non-fiction', 'Philosophy', null, null, 114000],
  ['Meditations', 'Marcus Aurelius', 'Non-fiction', 'Philosophy', null, null, 67000],
  ['On the Origin of Species', 'Charles Darwin', 'Non-fiction', 'Science', null, null, 150000],
  [
    'Narrative of the Life of Frederick Douglass',
    'Frederick Douglass',
    'Non-fiction',
    'Memoir',
    null,
    null,
    41000,
  ],
  [
    'The Autobiography of Benjamin Franklin',
    'Benjamin Franklin',
    'Non-fiction',
    'Memoir',
    null,
    null,
    70000,
  ],
];

/** Typical reading speed (wpm) by genre; each book and each day varies around it. */
export const SPEED: Record<string, number> = {
  'Science Fiction': 270,
  Mystery: 300,
  Classics: 225,
  Adventure: 285,
  Fantasy: 290,
  Horror: 265,
  'Non-fiction': 190,
};

/** Books given up at this %. */
export const ABANDON: Record<string, number> = {
  Middlemarch: 23.0,
  'On the Origin of Species': 17.0,
  'The Princess and the Goblin': 41.0,
};
/** Read early on and again years later (a little faster the second time). */
export const REREADS = [
  'Pride and Prejudice',
  'The Time Machine',
  'A Christmas Carol',
  'Treasure Island',
];
/** The book on the go, left part way through. */
export const CURRENT = 'The Count of Monte Cristo';
// a few quirks real logs have, so the Data checks tab has something to show
/** Opened once, this many days before starting. */
export const STRAY: Record<string, number> = { 'Jane Eyre': 52, 'The Moonstone': 41, Dracula: 64 };
/** Put down for a couple of months at this %. */
export const PAUSE: Record<string, number> = {
  'Anna Karenina': 50.0,
  'The Three Musketeers': 60.0,
};

/**
 * How a book gets read: devoured (long sessions most days), slow (short sessions), stop-start
 * (breaks of a week or so) or steady. Each genre has its own odds; titles here are fixed.
 */
export type Style = 'devour' | 'slow' | 'stopstart' | 'steady';
export const STYLE_ODDS: Record<string, [devour: number, slow: number, stopstart: number]> = {
  'Science Fiction': [0.3, 0.15, 0.15],
  Mystery: [0.6, 0.05, 0.1],
  Classics: [0.1, 0.4, 0.2],
  Adventure: [0.45, 0.1, 0.15],
  Fantasy: [0.35, 0.15, 0.2],
  Horror: [0.5, 0.1, 0.1],
  'Non-fiction': [0, 0.6, 0.3],
};
export const STYLE: Record<string, Style> = {
  'The Time Machine': 'devour',
  'A Study in Scarlet': 'devour',
  Walden: 'stopstart',
  'Moby-Dick': 'slow',
};

export const fileName = (title: string, author: string) => `${title} - ${author}.epub`;
