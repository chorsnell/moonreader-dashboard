import { parseAuthorWorks } from '../metadata/wikidata.client';
import { isNotAWork, keepWorks, mergeWikidata } from './works';

describe('isNotAWork', () => {
  it.each([
    'SparkNotes: Pride and Prejudice',
    'Pride and Prejudice (Spark Notes)',
    'Study Guide to Emma',
    'Summary of Persuasion',
    'CliffsNotes on Austen',
    'The Complete Novels of Jane Austen',
    'Complete Works',
    'Collected Stories',
    'The Jane Austen Collection',
    'Jane Austen Box Set',
    'The Hunger Games Trilogy Boxed Set',
    'Discworld Books 1-3',
    'Barsoom Books 1 to 5',
    'Sherlock Holmes Omnibus',
    'Selected Short Stories',
    '',
  ])('drops "%s"', (title) => expect(isNotAWork(title)).toBe(true));

  it.each([
    'Emma',
    'Northanger Abbey',
    'The Hobbit',
    'A Study in Scarlet',
    'The Collector',
    'Trilogy of Terror',
    'Complicity',
  ])('keeps "%s"', (title) => expect(isNotAWork(title)).toBe(false));
});

describe('keepWorks', () => {
  it('keeps works with editions and a year, without guides, sets or other languages', () => {
    const works = keepWorks([
      {
        key: '/works/OL1W',
        title: 'Emma',
        first_publish_year: 1815,
        edition_count: 900,
        language: ['eng', 'fre'],
        isbn: ['0141439580'],
      },
      { key: '/works/OL2W', title: 'Lady Susan', first_publish_year: 1871, edition_count: 80 },
      // one edition only
      { key: '/works/OL3W', title: 'Letters', first_publish_year: 1900, edition_count: 1 },
      // no year
      { key: '/works/OL4W', title: 'Juvenilia', edition_count: 5 },
      { key: '/works/OL5W', title: 'SparkNotes Emma', first_publish_year: 2002, edition_count: 4 },
      { key: '/works/OL6W', title: 'Novels 1-4', first_publish_year: 2002, edition_count: 4 },
      // only French editions
      {
        key: '/works/OL7W',
        title: 'Orgueil et préjugés',
        first_publish_year: 1813,
        edition_count: 50,
        language: ['fre'],
      },
      // a second record of the same work, fewer editions, earlier year
      { key: '/works/OL8W', title: 'Emma: A Novel', first_publish_year: 1814, edition_count: 3 },
      // a title only in another script
      { key: '/works/OL9W', title: 'エマ', first_publish_year: 1815, edition_count: 3 },
      // nonsense
      null as never,
      { title: 42 as never, edition_count: 'x' as never },
    ]);
    expect(works).toEqual([
      {
        work_id: 'OL1W',
        title: 'Emma',
        year: 1814,
        editions: 900,
        series: null,
        series_no: null,
        isbn13: '9780141439587',
        sources: ['openlibrary'],
      },
      {
        work_id: 'OL2W',
        title: 'Lady Susan',
        year: 1871,
        editions: 80,
        series: null,
        series_no: null,
        isbn13: null,
        sources: ['openlibrary'],
      },
    ]);
  });
});

describe('mergeWikidata', () => {
  const ol = keepWorks([
    { key: '/works/OL1W', title: 'A Study in Scarlet', first_publish_year: 1887, edition_count: 9 },
    { key: '/works/OL2W', title: 'The Lost World', first_publish_year: 1912, edition_count: 9 },
  ]);

  it('adds series to works both know, and series works only Wikidata knows', () => {
    const merged = mergeWikidata(ol, [
      { id: 'Q1', title: 'A Study in Scarlet', year: 1887, series: 'Sherlock Holmes', series_no: 1 },
      { id: 'Q2', title: 'The Valley of Fear', year: 1915, series: 'Sherlock Holmes', series_no: 7 },
      // not in a series, so not added
      { id: 'Q3', title: 'Micah Clarke', year: 1889, series: null, series_no: null },
      { id: 'Q4', title: 'The Lost World', year: 1912, series: null, series_no: null },
    ]);
    expect(merged.map((w) => [w.title, w.series, w.series_no, w.sources])).toEqual([
      ['A Study in Scarlet', 'Sherlock Holmes', 1, ['openlibrary', 'wikidata']],
      ['The Lost World', null, null, ['openlibrary', 'wikidata']],
      ['The Valley of Fear', 'Sherlock Holmes', 7, ['wikidata']],
    ]);
    expect(merged[2]).toMatchObject({ work_id: null, editions: null, year: 1915 });
    // the input is left as it was
    expect(ol[0].series).toBeNull();
  });
});

describe('parseAuthorWorks', () => {
  const b = (work: string, label: string, extra: Record<string, string> = {}) => ({
    work: { value: `http://www.wikidata.org/entity/${work}` },
    workLabel: { value: label },
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }])),
  });

  it('keeps one row per work, with its earliest year and a numbered series', () => {
    const works = parseAuthorWorks({
      results: {
        bindings: [
          b('Q1', 'Ozma of Oz', { date: '1907-07-30T00:00:00Z', seriesLabel: 'Oz' }),
          b('Q1', 'Ozma of Oz', {
            date: '1907-01-01T00:00:00Z',
            seriesLabel: 'Oz',
            ordinal: '3',
          }),
          b('Q2', 'Q2'), // no English label
          b('Q3', 'Glinda of Oz', { seriesLabel: 'Oz', ordinal: 'fourteen' }),
          { workLabel: { value: 'no item' } },
        ],
      },
    });
    expect(works).toEqual([
      { id: 'Q1', title: 'Ozma of Oz', year: 1907, series: 'Oz', series_no: 3 },
      { id: 'Q3', title: 'Glinda of Oz', year: null, series: 'Oz', series_no: null },
    ]);
    expect(parseAuthorWorks(null)).toEqual([]);
    expect(parseAuthorWorks({ results: {} })).toEqual([]);
  });
});
