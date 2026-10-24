import type {
  BibliographyAuthor,
  BibliographyFile,
  WorkSource,
} from '../bibliography/bibliography.types';

/** [title, first published, editions (rough), series, number in the series] */
type DemoWork = [
  title: string,
  year: number,
  editions: number | null,
  series?: string,
  no?: number,
];

/**
 * Other books by a few of the demo's authors, and the rest of their series, as the
 * bibliography lookup (BOO-103) might find them. All public domain. Some are on the demo's
 * to-read pile, some are only known to "Wikidata" (no editions), and a couple of the demo's
 * own books are here too, as the real lookup would list them; the build leaves those out.
 * Work ids are left empty: these aren't real Open Library records.
 */
const WORKS: Record<string, DemoWork[]> = {
  'Jane Austen': [
    ['Pride and Prejudice', 1813, 3100],
    ['Emma', 1815, 1500],
    ['Northanger Abbey', 1817, 820],
    ['Mansfield Park', 1814, 900],
    ['Lady Susan', 1871, 160],
  ],
  'Charles Dickens': [
    ['Oliver Twist', 1838, 2400],
    ['David Copperfield', 1850, 1600],
    ['Bleak House', 1853, 700],
    ['Hard Times', 1854, 850],
  ],
  'Arthur Conan Doyle': [
    ['A Study in Scarlet', 1887, 1300, 'Sherlock Holmes', 1],
    ['The Return of Sherlock Holmes', 1905, 640, 'Sherlock Holmes', 6],
    ['The Valley of Fear', 1915, 520, 'Sherlock Holmes', 7],
    ['His Last Bow', 1917, 430, 'Sherlock Holmes', 8],
    ['The Case-Book of Sherlock Holmes', 1927, 380, 'Sherlock Holmes', 9],
    ['The Poison Belt', 1913, 120, 'Professor Challenger', 2],
  ],
  'Edgar Rice Burroughs': [
    ['Thuvia, Maid of Mars', 1920, 210, 'Barsoom', 4],
    ['The Chessmen of Mars', 1922, 190, 'Barsoom', 5],
    ['The Master Mind of Mars', 1928, null, 'Barsoom', 6],
  ],
  'L. Frank Baum': [
    ['Dorothy and the Wizard in Oz', 1908, 260, 'Oz', 4],
    ['The Road to Oz', 1909, 240, 'Oz', 5],
    ['The Emerald City of Oz', 1910, 230, 'Oz', 6],
  ],
  'H. G. Wells': [
    ['The First Men in the Moon', 1901, 640],
    ['The Food of the Gods', 1904, 300],
  ],
  'Jules Verne': [
    ['From the Earth to the Moon', 1865, 700],
    ['The Mysterious Island', 1875, 900],
  ],
  'Agatha Christie': [['The Murder on the Links', 1923, 420, 'Hercule Poirot', 2]],
  'John Buchan': [['Greenmantle', 1916, 260, 'Richard Hannay', 2]],
  'Charlotte Brontë': [['Villette', 1853, 520]],
};

/** The demo's library/bibliography.json, dated `today` (YYYY-MM-DD). */
export function demoBibliography(today: string): BibliographyFile {
  const authors: Record<string, BibliographyAuthor> = {};
  for (const [name, works] of Object.entries(WORKS)) {
    authors[name.toLowerCase()] = {
      author_key: null,
      wikidata: null,
      looked_up: today,
      works: works.map(([title, year, editions, series, no]) => {
        const sources: WorkSource[] =
          editions === null ? ['wikidata'] : series ? ['openlibrary', 'wikidata'] : ['openlibrary'];
        return {
          work_id: null,
          title,
          year,
          editions,
          series: series ?? null,
          series_no: no ?? null,
          isbn13: null,
          sources,
        };
      }),
    };
  }
  return { authors };
}
