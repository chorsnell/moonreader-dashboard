import type { Gender, MetadataFile } from '../metadata/metadata.types';

/**
 * What the metadata lookup would find for the demo's books, written in so the demo needs no
 * network: first publication year and a typical page count.
 */
export const PUBLISHED: Record<string, [year: number, pages: number]> = {
  'The Time Machine': [1895, 118],
  'The War of the Worlds': [1898, 192],
  'The Invisible Man': [1897, 160],
  'The Island of Doctor Moreau': [1896, 144],
  'Twenty Thousand Leagues Under the Seas': [1870, 426],
  'Journey to the Centre of the Earth': [1864, 240],
  'The Lost World': [1912, 260],
  'A Princess of Mars': [1912, 186],
  'The Gods of Mars': [1918, 240],
  'The Warlord of Mars': [1919, 228],
  Herland: [1915, 146],
  'A Study in Scarlet': [1887, 128],
  'The Sign of the Four': [1890, 132],
  'The Adventures of Sherlock Holmes': [1892, 307],
  'The Memoirs of Sherlock Holmes': [1894, 279],
  'The Hound of the Baskervilles': [1902, 256],
  'The Moonstone': [1868, 528],
  'The Woman in White': [1860, 672],
  'The Mysterious Affair at Styles': [1920, 296],
  'The Secret Adversary': [1922, 320],
  'The Thirty-Nine Steps': [1915, 138],
  'Pride and Prejudice': [1813, 432],
  Emma: [1815, 474],
  Persuasion: [1817, 272],
  'Sense and Sensibility': [1811, 409],
  'Jane Eyre': [1847, 532],
  'Wuthering Heights': [1847, 416],
  'Great Expectations': [1861, 544],
  'A Tale of Two Cities': [1859, 489],
  'A Christmas Carol': [1843, 104],
  Middlemarch: [1871, 880],
  'Moby-Dick': [1851, 720],
  'The Great Gatsby': [1925, 180],
  'Little Women': [1868, 759],
  'The Picture of Dorian Gray': [1890, 272],
  'Anna Karenina': [1878, 864],
  'Crime and Punishment': [1866, 671],
  'Treasure Island': [1883, 292],
  Kidnapped: [1886, 288],
  'The Count of Monte Cristo': [1844, 1276],
  'The Three Musketeers': [1844, 700],
  'Around the World in Eighty Days': [1872, 252],
  'The Call of the Wild': [1903, 172],
  'White Fang': [1906, 298],
  'The Prisoner of Zenda': [1894, 210],
  "King Solomon's Mines": [1885, 320],
  'The Wonderful Wizard of Oz': [1900, 259],
  'The Marvelous Land of Oz': [1904, 287],
  'Ozma of Oz': [1907, 270],
  "Alice's Adventures in Wonderland": [1865, 192],
  'Through the Looking-Glass': [1871, 224],
  'Peter Pan': [1911, 192],
  'The Princess and the Goblin': [1872, 232],
  "The King of Elfland's Daughter": [1924, 301],
  Frankenstein: [1818, 280],
  Dracula: [1897, 488],
  Carmilla: [1872, 108],
  'Strange Case of Dr Jekyll and Mr Hyde': [1886, 141],
  'The Turn of the Screw': [1898, 152],
  'The Phantom of the Opera': [1910, 360],
  Walden: [1854, 352],
  Meditations: [180, 254],
  'On the Origin of Species': [1859, 502],
  'Narrative of the Life of Frederick Douglass': [1845, 159],
  'The Autobiography of Benjamin Franklin': [1791, 216],
};

/** Each author's country (ISO 3166 alpha-2, today's country for historical states) and gender. */
export const AUTHORS: Record<string, [country: string, gender: Gender]> = {
  'H. G. Wells': ['GB', 'male'],
  'Jules Verne': ['FR', 'male'],
  'Arthur Conan Doyle': ['GB', 'male'],
  'Edgar Rice Burroughs': ['US', 'male'],
  'Charlotte Perkins Gilman': ['US', 'female'],
  'Wilkie Collins': ['GB', 'male'],
  'Agatha Christie': ['GB', 'female'],
  'John Buchan': ['GB', 'male'],
  'Jane Austen': ['GB', 'female'],
  'Charlotte Brontë': ['GB', 'female'],
  'Emily Brontë': ['GB', 'female'],
  'Charles Dickens': ['GB', 'male'],
  'George Eliot': ['GB', 'female'],
  'Herman Melville': ['US', 'male'],
  'F. Scott Fitzgerald': ['US', 'male'],
  'Louisa May Alcott': ['US', 'female'],
  'Oscar Wilde': ['IE', 'male'],
  'Leo Tolstoy': ['RU', 'male'],
  'Fyodor Dostoevsky': ['RU', 'male'],
  'Robert Louis Stevenson': ['GB', 'male'],
  'Alexandre Dumas': ['FR', 'male'],
  'Jack London': ['US', 'male'],
  'Anthony Hope': ['GB', 'male'],
  'H. Rider Haggard': ['GB', 'male'],
  'L. Frank Baum': ['US', 'male'],
  'Lewis Carroll': ['GB', 'male'],
  'J. M. Barrie': ['GB', 'male'],
  'George MacDonald': ['GB', 'male'],
  'Lord Dunsany': ['IE', 'male'],
  'Mary Shelley': ['GB', 'female'],
  'Bram Stoker': ['IE', 'male'],
  'Sheridan Le Fanu': ['IE', 'male'],
  'Henry James': ['US', 'male'],
  'Gaston Leroux': ['FR', 'male'],
  'Henry David Thoreau': ['US', 'male'],
  'Marcus Aurelius': ['IT', 'male'],
  'Charles Darwin': ['GB', 'male'],
  'Frederick Douglass': ['US', 'male'],
  'Benjamin Franklin': ['US', 'male'],
};

/** The book id the import gives a title. */
const bookId = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The demo's library/metadata.json. */
export function demoMetadata(): MetadataFile {
  return {
    books: Object.fromEntries(
      Object.entries(PUBLISHED).map(([title, [year, pages]]) => [
        bookId(title),
        { published_year: year, pages },
      ]),
    ),
    authors: Object.fromEntries(
      Object.entries(AUTHORS).map(([name, [country, gender]]) => [
        name.toLowerCase(),
        { name, country, gender },
      ]),
    ),
  };
}
