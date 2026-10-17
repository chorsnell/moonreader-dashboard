/**
 * Made-up prices for the demo's books, so every money view has something to show: mostly
 * free or cheap public-domain ebooks, some paperbacks, a few library loans and gifts, a
 * stretch of Kindle Unlimited, a box set, one book bought in dollars and a few bought but
 * never opened.
 */
import { bookId, emptyPrices, type PriceEntry, type PricesFile } from '../prices/prices';
import { ABANDON, BOOKS, CURRENT, fileName } from './demo-books';
import { Random } from './random';
import type { DemoDay } from './simulate';

const DAY_MS = 86_400_000;
const iso = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);

/** Bought in a box set: its price is split across the three books by length. */
const BOX_SET = { name: 'Barsoom Trilogy', series: 'Barsoom', price: 2.99 };
/** Bought but never opened, so not in Moon+ at all. */
const UNOPENED: [title: string, author: string, price: number, store: string][] = [
  ['Ulysses', 'James Joyce', 9.99, 'Waterstones'],
  ['War and Peace', 'Leo Tolstoy', 1.99, 'Kobo'],
  ['The Brothers Karamazov', 'Fyodor Dostoevsky', 0.99, 'Amazon Kindle'],
];
/** Fixed prices: paperbacks (one second-hand) and the re-read books. */
const PAPERBACKS: Record<string, [price: number, store: string]> = {
  Middlemarch: [9.99, 'Waterstones'],
  'Moby-Dick': [8.99, 'Waterstones'],
  'Anna Karenina': [10.99, 'Blackwell’s'],
  'The Great Gatsby': [2.5, 'Oxfam Books'],
  'Crime and Punishment': [7.99, 'Waterstones'],
  // re-read, so cost per hour falls
  'Pride and Prejudice': [8.99, 'Waterstones'],
  'Treasure Island': [0.99, 'Amazon Kindle'],
  'A Christmas Carol': [0.49, 'Kobo'],
};
const LIBRARY = ['Little Women', 'The Woman in White', 'Wuthering Heights'];
const GIFTS = ['The Count of Monte Cristo', 'Meditations'];
const KU_FEE = 9.49;

export function demoPrices(
  log: Map<string, DemoDay[]>,
  firstDay: number,
  seed: number,
): PricesFile {
  const rng = new Random(seed + 101);
  const file = emptyPrices();
  file.settings.rates = { USD: 0.79, EUR: 0.86 };

  const firstRead = new Map<string, number>();
  for (const [title, author] of BOOKS) {
    const days = log.get(fileName(title, author));
    if (days?.length) firstRead.set(title, firstDay + Math.min(...days.map((d) => d.day)));
  }
  const lastDay = Math.max(...firstRead.values());
  const bought = (title: string) => iso((firstRead.get(title) ?? lastDay) - rng.randint(0, 21));

  // Kindle Unlimited for ten months in the middle of the history: the books first read then
  const sorted = [...firstRead.values()].sort((a, b) => a - b);
  const kuStart = sorted[Math.floor(sorted.length * 0.55)];
  const kuEnd = kuStart + 300;
  const month = (d: number) => iso(d).slice(0, 7);
  file.subscriptions = [
    {
      name: 'Kindle Unlimited',
      monthly_fee: KU_FEE,
      currency: 'GBP',
      start: month(kuStart),
      end: month(kuEnd),
    },
  ];

  const entry = (title: string, author: string, e: Partial<PriceEntry>): PriceEntry => ({
    title,
    author,
    price: null,
    currency: 'GBP',
    date: bought(title),
    acquisition: 'bought',
    store: null,
    notes: null,
    list_price: null,
    subscription: null,
    bundle: null,
    isbn: null,
    ...e,
  });

  const boxWords = BOOKS.filter((b) => b[4] === BOX_SET.series).reduce((s, b) => s + b[6], 0);
  let usd = false;
  for (const [title, author, , , series, , words] of BOOKS) {
    if (!firstRead.has(title)) continue;
    const id = bookId(title);
    const read = firstRead.get(title)!;
    if (series === BOX_SET.series) {
      file.books[id] = entry(title, author, {
        price: Math.round((BOX_SET.price * words * 100) / boxWords) / 100,
        store: 'Amazon Kindle',
        bundle: BOX_SET.name,
        date: bought(BOOKS.find((b) => b[4] === BOX_SET.series)![0]),
      });
    } else if (PAPERBACKS[title]) {
      const [price, store] = PAPERBACKS[title];
      file.books[id] = entry(title, author, { price, store });
    } else if (LIBRARY.includes(title)) {
      file.books[id] = entry(title, author, {
        price: 0,
        acquisition: 'library',
        store: 'Libby',
        list_price: 7.99,
      });
    } else if (GIFTS.includes(title)) {
      file.books[id] = entry(title, author, {
        price: 0,
        acquisition: 'gift',
        list_price: 12.99,
        notes: 'Birthday present',
      });
    } else if (read >= kuStart && read <= kuEnd && rng.random() < 0.75) {
      file.books[id] = entry(title, author, {
        price: 0,
        acquisition: 'subscription',
        subscription: 'Kindle Unlimited',
        store: 'Amazon Kindle',
        list_price: [1.99, 2.99, 3.99, 4.99][rng.randint(0, 3)],
      });
    } else if (!usd && rng.random() < 0.1) {
      usd = true;
      file.books[id] = entry(title, author, { price: 2.99, currency: 'USD', store: 'Kobo (US)' });
    } else if (rng.random() < 0.55 && title !== CURRENT && !(title in ABANDON)) {
      file.books[id] = entry(title, author, {
        price: 0,
        acquisition: 'free',
        store: rng.random() < 0.6 ? 'Standard Ebooks' : 'Project Gutenberg',
      });
    } else {
      file.books[id] = entry(title, author, {
        price: [0.49, 0.99, 0.99, 1.49, 1.99, 2.99][rng.randint(0, 5)],
        store: rng.random() < 0.6 ? 'Amazon Kindle' : 'Kobo',
      });
    }
  }
  for (const [title, author, price, store] of UNOPENED) {
    file.books[bookId(title)] = entry(title, author, {
      price,
      store,
      date: iso(lastDay - rng.randint(20, 300)),
    });
  }

  // a budget for each of the last three years
  const year = Number(iso(lastDay).slice(0, 4));
  file.settings.budgets = { [year - 2]: 40, [year - 1]: 40, [year]: 30 };
  return file;
}
