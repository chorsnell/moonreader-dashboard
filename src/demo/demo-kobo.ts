import { localDateTime, round1 } from '../common/time';
import type { ImportedBook, ImportFile } from '../imports/imports.types';
import { Random } from './random';

const DAY_MS = 86_400_000;

/** Books read on a Kobo: [title, author, words a minute, where in the history (0..1), highlight]. */
const KOBO: [string, string, number, number, string][] = [
  [
    'The Secret Garden',
    'Frances Hodgson Burnett',
    240,
    0.4,
    'If you look the right way, you can see that the whole world is a garden.',
  ],
  [
    'The Railway Children',
    'E. Nesbit',
    250,
    0.82,
    'Mother always said that if you were in trouble you should go to the station.',
  ],
];

/**
 * A made-up Kobo import for the demo, as if KoboReader.sqlite had been uploaded: two books
 * read on the Kobo, with the days the device logged and a highlight each.
 */
export function demoKobo(firstDay: number, lastDay: number, seed: number): ImportFile {
  const rng = new Random(seed + 57);
  const books: ImportedBook[] = KOBO.map(([title, author, wpm, at, quote], i) => {
    let day = firstDay + Math.round((lastDay - firstDay) * at);
    const daily = [];
    let progress = 0;
    while (progress < 100) {
      const minutes = round1(Math.max(10, rng.lognormal(3.4, 0.4)));
      progress = Math.min(100, round1(progress + (minutes * wpm) / 600));
      daily.push({
        date: new Date(day * DAY_MS).toISOString().slice(0, 10),
        minutes,
        words: null,
        progress,
      });
      day += rng.random() < 0.7 ? 1 : 2;
    }
    const mid = daily[Math.floor(daily.length / 2)].date;
    return {
      id: `kobo-demo-${i + 1}`,
      title,
      author,
      isbn13: null,
      isbn10: null,
      rating: null,
      shelves: [],
      shelf: 'read',
      read_count: 1,
      date_added: daily[0].date,
      pages: null,
      progress: 100,
      daily,
      reads: [
        {
          start: daily[0].date,
          end: daily[daily.length - 1].date,
          finished: true,
          progress: 100,
          minutes: round1(daily.reduce((s, d) => s + d.minutes, 0)),
        },
      ],
      highlights: [
        {
          time: localDateTime(new Date(`${mid}T21:10:00`)),
          progress: null,
          chapter: null,
          location: null,
          text: quote,
          note: null,
          kind: 'highlight',
        },
      ],
    };
  });
  return {
    schema_version: 1,
    source: 'kobo',
    file: 'KoboReader.sqlite',
    imported: '',
    books,
  };
}
