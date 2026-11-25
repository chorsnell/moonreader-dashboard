import { loadCalcs } from '../support/feature-calcs';

const run = loadCalcs('calcs.js', 'features/records.js', 'features/reread-speed.js');

// 30 minutes and 6000 words in Moon+ (200 wpm), 20 minutes in KOReader, which logs no words
const by_source = {
  moonplus: { minutes: 30, words: 6000 },
  koreader: { minutes: 20, words: null },
};
const mixed = (date: string, extra: object = { by_source }) => ({
  date,
  book_id: 'a',
  title: 'A',
  genre: 'G',
  minutes: 50,
  words: 6000,
  progress: null,
  ...extra,
});
const daily = ['01', '02', '03', '04'].map((d) => mixed(`2026-01-${d}`));
const books = [{ id: 'a', title: 'A', author: 'Ann', genre: 'G', subgenre: 'S' }];

describe('words a minute on days read in several apps', () => {
  it('uses only the minutes the words were counted in', () => {
    expect(run('speed_days', { daily })[0]).toMatchObject({ minutes: 30, wpm: 200 });
    expect(run('speed_year', { daily })).toEqual([{ year: 2026, wpm: 200 }]);
    expect(run('book_speed', { daily, books })[0]).toMatchObject({ wpm: 200, hours: 2 });
    expect(run('group_speed', { daily: [...daily, ...daily], books })[0]).toMatchObject({
      wpm: 200,
    });
  });

  it('prefers timed_minutes, which survives where by_source is dropped', () => {
    const rows = [mixed('2026-01-01', { timed_minutes: 30 })];
    expect(run('speed_days', { daily: rows })[0]).toMatchObject({ wpm: 200 });
  });

  it('keeps a day the extra minutes would have pushed under 40 wpm', () => {
    const slow = mixed('2026-01-01', {
      minutes: 330,
      by_source: { ...by_source, koreader: { minutes: 300, words: null } },
    });
    expect(run('speed_days', { daily: [slow] })).toHaveLength(1);
  });

  it('counts all the minutes when there is no per-source split', () => {
    expect(run('speed_days', { daily: [mixed('2026-01-01', {})] })[0]).toMatchObject({
      minutes: 50,
      wpm: 120,
    });
  });

  it('leaves total reading time alone', () => {
    expect(run('day_totals', { daily })[0]).toMatchObject({ minutes: 50, words: 6000 });
    expect(run('diary', { daily, reads: [] })[0]).toMatchObject({
      minutes: 50,
      timed_minutes: 30,
    });
  });
});
