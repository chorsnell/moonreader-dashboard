import type { BibliographySubject } from '../bibliography/bibliography.types';

/** [title, first author as Open Library names them, first published, editions (rough)] */
type DemoSubjectWork = [title: string, author: string, year: number, editions: number];

/**
 * Popular works in the Open Library subjects of the demo's genres, as the genre picks lookup
 * (BOO-105) might find them, most popular first. All public domain. Some are the demo's own
 * books or on its to-read pile, as the real subjects would list them; the build leaves the
 * first out and marks the second. Work ids are left empty: these aren't real Open Library
 * records.
 */
const SUBJECTS: Record<string, DemoSubjectWork[]> = {
  classic_literature: [
    ['Pride and Prejudice', 'Jane Austen', 1813, 3100],
    ['Great Expectations', 'Charles Dickens', 1861, 1500],
    ['Les Misérables', 'Victor Hugo', 1862, 1400],
    ['Don Quixote', 'Miguel de Cervantes Saavedra', 1605, 1600],
    ['Madame Bovary', 'Gustave Flaubert', 1857, 1100],
    ['Vanity Fair', 'William Makepeace Thackeray', 1848, 900],
    ['War and Peace', 'Leo Tolstoy', 1869, 1000],
    ['The Brothers Karamazov', 'Fyodor Dostoyevsky', 1880, 700],
    ['Tess of the d’Urbervilles', 'Thomas Hardy', 1891, 800],
    ['Oliver Twist', 'Charles Dickens', 1838, 2400],
    ['Northanger Abbey', 'Jane Austen', 1817, 820],
    ['Silas Marner', 'George Eliot', 1861, 600],
    ['The Complete Works of Charles Dickens', 'Charles Dickens', 1900, 40],
  ],
  science_fiction: [
    ['The Time Machine', 'H. G. Wells', 1895, 1200],
    ['Frankenstein', 'Mary Shelley', 1818, 2000],
    ['From the Earth to the Moon', 'Jules Verne', 1865, 700],
    ['The First Men in the Moon', 'H. G. Wells', 1901, 640],
    ['The Mysterious Island', 'Jules Verne', 1875, 900],
    ['Flatland', 'Edwin A. Abbott', 1884, 500],
    ['Looking Backward', 'Edward Bellamy', 1888, 450],
    ['The Coming Race', 'Edward Bulwer-Lytton', 1871, 260],
    ['Thuvia, Maid of Mars', 'Edgar Rice Burroughs', 1920, 210],
    ['The Lost World', 'Arthur Conan Doyle', 1912, 600],
  ],
  mystery_and_detective_stories: [
    ['The Hound of the Baskervilles', 'Arthur Conan Doyle', 1902, 1400],
    ['The Murders in the Rue Morgue', 'Edgar Allan Poe', 1841, 400],
    ['The Return of Sherlock Holmes', 'Arthur Conan Doyle', 1905, 640],
    ['The Innocence of Father Brown', 'G. K. Chesterton', 1911, 420],
    ['The Mystery of Edwin Drood', 'Charles Dickens', 1870, 380],
    ['The Murder on the Links', 'Agatha Christie', 1923, 420],
    ['Trent’s Last Case', 'E. C. Bentley', 1913, 300],
    ['The Riddle of the Sands', 'Erskine Childers', 1903, 280],
    ['Sherlock Holmes Study Guide', 'Anonymous', 2001, 12],
  ],
  adventure: [
    ['Robinson Crusoe', 'Daniel Defoe', 1719, 2100],
    ['Treasure Island', 'Robert Louis Stevenson', 1883, 2000],
    ['Kim', 'Rudyard Kipling', 1901, 700],
    ['The Last of the Mohicans', 'James Fenimore Cooper', 1826, 900],
    ['Swiss Family Robinson', 'Johann David Wyss', 1812, 800],
    ['Ivanhoe', 'Walter Scott', 1819, 1000],
    ['Captain Blood', 'Rafael Sabatini', 1922, 300],
    ['The Scarlet Pimpernel', 'Baroness Orczy', 1905, 500],
    ['She', 'H. Rider Haggard', 1887, 450],
  ],
  fantasy: [
    ['Alice’s Adventures in Wonderland', 'Lewis Carroll', 1865, 3000],
    ['The Wind in the Willows', 'Kenneth Grahame', 1908, 1200],
    ['Phantastes', 'George MacDonald', 1858, 300],
    ['The Road to Oz', 'L. Frank Baum', 1909, 240],
    ['The Well at the World’s End', 'William Morris', 1896, 150],
    ['The Worm Ouroboros', 'E. R. Eddison', 1922, 130],
    ['Five Children and It', 'E. Nesbit', 1902, 400],
    ['Lilith', 'George MacDonald', 1895, 200],
  ],
  horror: [
    ['Dracula', 'Bram Stoker', 1897, 2200],
    ['The Legend of Sleepy Hollow', 'Washington Irving', 1820, 600],
    ['The Fall of the House of Usher', 'Edgar Allan Poe', 1839, 500],
    ['The Monkey’s Paw', 'W. W. Jacobs', 1902, 150],
    ['The Great God Pan', 'Arthur Machen', 1894, 160],
    ['The King in Yellow', 'Robert W. Chambers', 1895, 180],
    ['The Beetle', 'Richard Marsh', 1897, 120],
  ],
  gothic: [
    ['The Castle of Otranto', 'Horace Walpole', 1764, 500],
    ['The Mysteries of Udolpho', 'Ann Radcliffe', 1794, 400],
    ['The Monk', 'Matthew Lewis', 1796, 350],
    ['Melmoth the Wanderer', 'Charles Robert Maturin', 1820, 200],
    ['Wuthering Heights', 'Emily Brontë', 1847, 2500],
    ['Northanger Abbey', 'Jane Austen', 1817, 820],
    ['Uncle Silas', 'Sheridan Le Fanu', 1864, 180],
  ],
  detective: [
    ['The Moonstone', 'Wilkie Collins', 1868, 900],
    ['The Big Bow Mystery', 'Israel Zangwill', 1892, 120],
    ['The Leavenworth Case', 'Anna Katharine Green', 1878, 200],
    ['The Mystery of the Yellow Room', 'Gaston Leroux', 1907, 250],
    ['The Valley of Fear', 'Arthur Conan Doyle', 1915, 520],
    ['The Secret of Father Brown', 'G. K. Chesterton', 1927, 200],
  ],
};

/** The demo's library/bibliography.json `subjects`, dated `today` (YYYY-MM-DD). */
export function demoSubjects(today: string): Record<string, BibliographySubject> {
  return Object.fromEntries(
    Object.entries(SUBJECTS).map(([slug, works]) => [
      slug,
      {
        looked_up: today,
        works: works.map(([title, author, year, editions]) => ({
          work_id: null,
          title,
          author,
          year,
          editions,
        })),
      },
    ]),
  );
}
