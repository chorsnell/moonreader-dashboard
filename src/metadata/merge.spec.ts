import type { BookHistory, Catalogue } from '../backup-import/reading-history.types';
import { bookFacts, countryName, normaliseCountry, normaliseGender } from './merge';
import type { MetadataFile } from './metadata.types';

const book = (over: Partial<BookHistory> = {}): BookHistory => ({
  id: 'emma',
  title: 'Emma',
  author: 'Jane Austen',
  series: null,
  series_no: null,
  genre: 'Classics',
  subgenre: 'Romance',
  isbn13: null,
  isbn10: null,
  work_id: null,
  status: 'finished',
  progress: 100,
  total_minutes: 0,
  total_words: 0,
  times_read: 1,
  first_read: null,
  last_read: null,
  reads: [],
  daily: [],
  synced: null,
  source_files: ['Emma.epub'],
  ...over,
});

const found: MetadataFile = {
  books: {
    emma: {
      work_id: 'OL66562W',
      isbn13: '9780141439587',
      isbn10: '0141439580',
      published_year: 1815,
      pages: 474,
      author_key: 'OL21594A',
    },
  },
  authors: { 'jane austen': { country: 'GB', gender: 'female', wikidata: 'Q36322' } },
};

describe('countries and genders', () => {
  it('reads codes and English names', () => {
    expect(normaliseCountry('gb')).toBe('GB');
    expect(normaliseCountry('UK')).toBe('GB');
    expect(normaliseCountry('United Kingdom')).toBe('GB');
    expect(normaliseCountry('scotland')).toBe('GB');
    expect(normaliseCountry('France')).toBe('FR');
    expect(normaliseCountry('United States')).toBe('US');
    expect(normaliseCountry('ZZ')).toBeNull();
    expect(normaliseCountry('Narnia')).toBeNull();
    expect(normaliseCountry(3)).toBeNull();
    expect(countryName('IE')).toBe('Ireland');
    expect(countryName(null)).toBeNull();
  });

  it('reads genders', () => {
    expect(normaliseGender('F')).toBe('female');
    expect(normaliseGender('Male')).toBe('male');
    expect(normaliseGender('nonbinary')).toBe('non-binary');
    expect(normaliseGender('?')).toBeNull();
  });
});

describe('bookFacts', () => {
  it('uses what the lookup found when the catalogue says nothing', () => {
    const catalogue: Catalogue = { books: {}, exclude: [] };
    expect(bookFacts(book(), catalogue, found)).toEqual({
      isbn13: '9780141439587',
      isbn10: '0141439580',
      work_id: 'OL66562W',
      published_year: 1815,
      pages: 474,
      author_country: 'GB',
      author_country_name: 'United Kingdom',
      author_gender: 'female',
    });
    expect(bookFacts(book(), catalogue, { books: {}, authors: {} })).toMatchObject({
      isbn13: null,
      published_year: null,
      author_country: null,
    });
  });

  it('lets hand-entered values win', () => {
    const catalogue: Catalogue = {
      books: { 'emma.epub': { title: 'Emma', author: 'Jane Austen', pages: 400 } },
      authors: { 'JANE AUSTEN': { country: 'Ireland' } },
      exclude: [],
    };
    const b = book({ isbn13: '9780141439518', isbn10: '0141439513', work_id: 'mine' });
    expect(bookFacts(b, catalogue, found)).toMatchObject({
      isbn13: '9780141439518',
      work_id: 'mine',
      pages: 400,
      published_year: 1815,
      author_country: 'IE',
      author_gender: 'female',
    });
    catalogue.books['emma.epub'].author_country = 'FR';
    catalogue.books['emma.epub'].author_gender = 'male';
    expect(bookFacts(b, catalogue, found)).toMatchObject({
      author_country: 'FR',
      author_gender: 'male',
    });
  });
});
