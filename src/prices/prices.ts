/**
 * What each book cost: library/prices.json, kept apart from catalogue.json. Pure functions
 * for checking what the admin sends, converting currencies, importing a CSV and building
 * the copy the page reads (data/prices.json).
 */

export const ACQUISITIONS = ['bought', 'free', 'library', 'subscription', 'gift'] as const;
export type Acquisition = (typeof ACQUISITIONS)[number];

/** What one book cost and how it was got. Prices are in the currency they were paid in. */
export interface PriceEntry {
  /** Kept so the entry can be matched again after a rename, and for books never opened. */
  title: string;
  author: string;
  price: number | null;
  currency: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  acquisition: Acquisition;
  store: string | null;
  notes: string | null;
  /** What buying it would have cost: for subscription, library and gifted books. */
  list_price: number | null;
  /** Which subscription it came with, when acquisition is 'subscription'. */
  subscription: string | null;
  /** The bundle or box set it was part of; price is then this book's share. */
  bundle: string | null;
  isbn: string | null;
}

export interface Subscription {
  name: string;
  monthly_fee: number;
  currency: string;
  /** YYYY-MM */
  start: string;
  /** YYYY-MM, or null while it runs. */
  end: string | null;
}

export interface Benchmark {
  name: string;
  /** Rough cost of an hour of it, in the home currency. */
  per_hour: number;
}

export interface PriceSettings {
  home_currency: string;
  /** How much one unit of each other currency is worth in the home currency. Fixed, by hand. */
  rates: Record<string, number>;
  /** Yearly budgets in the home currency, by year. */
  budgets: Record<string, number>;
  benchmarks: Benchmark[];
}

export interface PricesFile {
  settings: PriceSettings;
  subscriptions: Subscription[];
  /** By book id (the dashboard's slug of the title). */
  books: Record<string, PriceEntry>;
}

/** A book of the last build, for matching. */
export interface BookRef {
  id: string;
  title: string;
  author?: string | null;
  words?: number | null;
  isbn?: string | null;
  isbns?: string[] | null;
}

/** A problem with what was sent, worded for the admin. */
export class PriceError extends Error {}

/** Rough costs of an hour of other things, in pounds. Labelled as rough wherever shown. */
export const DEFAULT_BENCHMARKS: Benchmark[] = [
  { name: 'Streaming subscription', per_hour: 0.4 },
  { name: 'Video game', per_hour: 1.5 },
  { name: 'New hardback', per_hour: 2.5 },
  { name: 'Cinema ticket', per_hour: 6 },
  { name: 'Theatre or concert', per_hour: 20 },
];

export function emptyPrices(): PricesFile {
  return {
    settings: { home_currency: 'GBP', rates: {}, budgets: {}, benchmarks: DEFAULT_BENCHMARKS },
    subscriptions: [],
    books: {},
  };
}

/** The id the dashboard gives a book with this title (as reading-history.ts does). */
export function bookId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------- checking ----------

const MAX_TEXT = 300;
const MAX_MONEY = 1_000_000;
const CURRENCY = /^[A-Z]{3}$/;
const MONTH = /^\d{4}-\d{2}$/;

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function text(v: unknown, name: string): string | null {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (s.length > MAX_TEXT) throw new PriceError(`That ${name} is too long.`);
  return s || null;
}

function money(v: unknown, name: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseMoney(String(v)).amount;
  if (n === null || !Number.isFinite(n) || n < 0 || n > MAX_MONEY) {
    throw new PriceError(`The ${name} must be a number of 0 or more.`);
  }
  return Math.round(n * 100) / 100;
}

function currency(v: unknown): string | null {
  const s = text(v, 'currency');
  if (!s) return null;
  const c = s.toUpperCase();
  if (!CURRENCY.test(c))
    throw new PriceError('Give the currency as a three-letter code, e.g. GBP.');
  return c;
}

function date(v: unknown): string | null {
  const s = text(v, 'date');
  if (!s) return null;
  const d = parseDate(s);
  if (!d) throw new PriceError(`"${s}" isn't a date I understand. Use YYYY-MM-DD.`);
  return d;
}

function acquisition(v: unknown, price: number | null): Acquisition {
  const s = text(v, 'acquisition');
  if (!s) return price === 0 ? 'free' : 'bought';
  const a = parseAcquisition(s);
  if (!a) throw new PriceError(`How the book was got must be one of: ${ACQUISITIONS.join(', ')}.`);
  return a;
}

/** Checks one book's price entry from the admin page. */
export function toPriceEntry(body: unknown): PriceEntry {
  const b = asObject(body);
  const title = text(b.title, 'title');
  if (!title) throw new PriceError('Give the book a title.');
  const price = money(b.price, 'price');
  const acq = acquisition(b.acquisition, price);
  return {
    title,
    author: text(b.author, 'author') ?? '',
    price,
    currency: currency(b.currency),
    date: date(b.date),
    acquisition: acq,
    store: text(b.store, 'store'),
    notes: text(b.notes, 'note'),
    list_price: money(b.list_price, 'list price'),
    subscription: acq === 'subscription' ? text(b.subscription, 'subscription') : null,
    bundle: text(b.bundle, 'bundle'),
    isbn: text(b.isbn, 'ISBN'),
  };
}

/** Checks the settings from the admin page. */
export function toSettings(body: unknown): PriceSettings {
  const b = asObject(body);
  const home = currency(b.home_currency) ?? 'GBP';
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(asObject(b.rates))) {
    const c = currency(k)!;
    const r = Number(v);
    if (!Number.isFinite(r) || r <= 0 || r > MAX_MONEY) {
      throw new PriceError(`The rate for ${c} must be a number above 0.`);
    }
    if (c !== home) rates[c] = r;
  }
  const budgets: Record<string, number> = {};
  for (const [k, v] of Object.entries(asObject(b.budgets))) {
    if (!/^\d{4}$/.test(k)) throw new PriceError('Budgets are by year, e.g. 2026.');
    const n = money(v, 'budget');
    if (n) budgets[k] = n;
  }
  const benchmarks = Array.isArray(b.benchmarks)
    ? b.benchmarks.slice(0, 20).map((x) => {
        const o = asObject(x);
        const name = text(o.name, 'benchmark name');
        const perHour = money(o.per_hour, 'cost per hour');
        if (!name || perHour === null) throw new PriceError('Give each benchmark a name and cost.');
        return { name, per_hour: perHour };
      })
    : DEFAULT_BENCHMARKS;
  return { home_currency: home, rates, budgets, benchmarks };
}

/** Checks the list of subscriptions from the admin page. */
export function toSubscriptions(body: unknown): Subscription[] {
  const list = Array.isArray(body) ? body : asObject(body).subscriptions;
  if (!Array.isArray(list)) throw new PriceError('Send a list of subscriptions.');
  const seen = new Set<string>();
  return list.slice(0, 50).map((x) => {
    const o = asObject(x);
    const name = text(o.name, 'subscription name');
    if (!name) throw new PriceError('Give each subscription a name.');
    if (seen.has(name)) throw new PriceError(`There are two subscriptions called ${name}.`);
    seen.add(name);
    const fee = money(o.monthly_fee, 'monthly fee');
    if (fee === null) throw new PriceError(`Give ${name} a monthly fee.`);
    const start = text(o.start, 'start')?.slice(0, 7) ?? null;
    const end = text(o.end, 'end')?.slice(0, 7) ?? null;
    if (!start || !MONTH.test(start)) throw new PriceError(`Give ${name} a start month (YYYY-MM).`);
    if (end && (!MONTH.test(end) || end < start)) {
      throw new PriceError(`The end of ${name} must be a month (YYYY-MM) after its start.`);
    }
    return { name, monthly_fee: fee, currency: currency(o.currency) ?? 'GBP', start, end };
  });
}

/** Reads library/prices.json leniently: whatever doesn't check out is left out. */
export function normalisePrices(raw: unknown): PricesFile {
  const r = asObject(raw);
  const out = emptyPrices();
  try {
    if (r.settings) out.settings = toSettings(r.settings);
  } catch {
    // keep the defaults
  }
  try {
    if (r.subscriptions) out.subscriptions = toSubscriptions(r.subscriptions);
  } catch {
    // none
  }
  for (const [id, e] of Object.entries(asObject(r.books))) {
    try {
      out.books[id] = toPriceEntry(e);
    } catch {
      // skip it
    }
  }
  return out;
}

// ---------- parsing loose values (CSV cells) ----------

const SYMBOLS: [RegExp, string][] = [
  [/£/, 'GBP'],
  [/€/, 'EUR'],
  [/US\$|\$/, 'USD'],
  [/¥/, 'JPY'],
];

/** "£4.99", "4,99 €", "USD 12" → an amount and, if it says, a currency. */
export function parseMoney(s: string): { amount: number | null; currency: string | null } {
  const t = s.trim();
  if (!t) return { amount: null, currency: null };
  let cur: string | null = null;
  const code = /\b([A-Z]{3})\b/.exec(t.toUpperCase());
  if (code && !/^\d/.test(code[1])) cur = code[1];
  for (const [re, c] of SYMBOLS) if (!cur && re.test(t)) cur = c;
  let num = t.replace(/[^\d.,-]/g, '');
  if (/^-?\d+,\d{1,2}$/.test(num))
    num = num.replace(',', '.'); // a decimal comma
  else num = num.replace(/,/g, '');
  if (!num || !/^-?\d*\.?\d+$/.test(num)) return { amount: null, currency: cur };
  return { amount: Number(num), currency: cur };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function ymd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const back = new Date(`${iso}T00:00:00Z`);
  return back.getUTCDate() === d ? iso : null;
}

/** YYYY-MM-DD, DD/MM/YYYY (British order), YYYY/MM/DD or "12 Mar 2024"; ISO date-times too. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(t);
  if (m) return ymd(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i.exec(t);
  if (m && MONTHS.includes(m[2].toLowerCase())) {
    return ymd(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  }
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(t);
  if (m && MONTHS.includes(m[1].toLowerCase())) {
    return ymd(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  }
  return null;
}

const ACQ_WORDS: Record<string, Acquisition> = {
  bought: 'bought',
  buy: 'bought',
  purchase: 'bought',
  purchased: 'bought',
  paid: 'bought',
  free: 'free',
  library: 'library',
  loan: 'library',
  borrowed: 'library',
  subscription: 'subscription',
  ku: 'subscription',
  'kindle unlimited': 'subscription',
  'kobo plus': 'subscription',
  gift: 'gift',
  gifted: 'gift',
  present: 'gift',
};

export function parseAcquisition(s: string): Acquisition | null {
  return ACQ_WORDS[s.trim().toLowerCase()] ?? null;
}

// ---------- converting ----------

/** An amount in the home currency, or null when there's no rate for its currency. */
export function toHome(
  amount: number | null,
  cur: string | null,
  settings: PriceSettings,
): number | null {
  if (amount === null) return null;
  const c = cur || settings.home_currency;
  if (c === settings.home_currency) return amount;
  const rate = settings.rates[c];
  return rate ? Math.round(amount * rate * 100) / 100 : null;
}

/** Currencies used without a rate to convert them. */
export function missingRates(file: PricesFile): string[] {
  const { settings } = file;
  const used = [
    ...Object.values(file.books).map((e) => e.currency),
    ...file.subscriptions.map((s) => s.currency),
  ];
  return [...new Set(used)]
    .filter((c): c is string => !!c && c !== settings.home_currency && !settings.rates[c])
    .sort();
}

/** One book's row in data/prices.json: amounts in the home currency, no notes. */
export interface ServedPrice {
  book_id: string;
  title: string;
  author: string;
  price: number | null;
  list_price: number | null;
  paid: number | null;
  paid_currency: string | null;
  date: string | null;
  acquisition: Acquisition;
  store: string | null;
  subscription: string | null;
  bundle: string | null;
}

export interface ServedPrices {
  currency: string;
  budgets: Record<string, number>;
  benchmarks: Benchmark[];
  subscriptions: Subscription[];
  books: ServedPrice[];
}

/** data/prices.json: everything converted to the home currency, without the admin's notes. */
export function servedPrices(file: PricesFile): ServedPrices {
  const s = file.settings;
  return {
    currency: s.home_currency,
    budgets: s.budgets,
    benchmarks: s.benchmarks,
    subscriptions: file.subscriptions.map((x) => ({
      ...x,
      monthly_fee: toHome(x.monthly_fee, x.currency, s) ?? x.monthly_fee,
      currency: s.home_currency,
    })),
    books: Object.entries(file.books)
      .map(([id, e]) => ({
        book_id: id,
        title: e.title,
        author: e.author,
        price: toHome(e.price, e.currency, s),
        list_price: toHome(e.list_price, e.currency, s),
        paid: e.price,
        paid_currency: e.currency || s.home_currency,
        date: e.date,
        acquisition: e.acquisition,
        store: e.store,
        subscription: e.subscription,
        bundle: e.bundle,
      }))
      .sort((a, b) => a.book_id.localeCompare(b.book_id)),
  };
}

// ---------- CSV ----------

/** Splits CSV text into rows of cells: quotes, doubled quotes, CRLF; comma, semicolon or tab. */
export function parseCsv(input: string): string[][] {
  const textIn = input.replace(/^﻿/, '');
  const firstLine = textIn.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => firstLine.split(c).length;
  const sep = [',', ';', '\t'].reduce((a, c) => (count(c) > count(a) ? c : a), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < textIn.length; i++) {
    const ch = textIn[i];
    if (quoted) {
      if (ch === '"' && textIn[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && textIn[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_COLUMNS = [
  'title',
  'author',
  'isbn',
  'price',
  'currency',
  'date',
  'acquisition',
  'store',
  'subscription',
  'list_price',
  'bundle',
  'notes',
] as const;
type Column = (typeof CSV_COLUMNS)[number];

/** Header names stores and spreadsheets use for each column. */
const HEADERS: Record<Column, string[]> = {
  title: ['title', 'book', 'book title', 'product', 'product name', 'item', 'name'],
  author: ['author', 'authors', 'author(s)', 'creator', 'by', 'writer'],
  isbn: ['isbn', 'isbn13', 'isbn-13', 'isbn10', 'isbn-10', 'ean'],
  price: ['price', 'amount', 'total', 'cost', 'paid', 'price paid', 'unit price', 'order total'],
  currency: ['currency', 'curr', 'currency code'],
  date: ['date', 'purchase date', 'order date', 'date bought', 'bought', 'purchased', 'date added'],
  acquisition: ['acquisition', 'how', 'how got', 'type', 'source', 'acquired'],
  store: ['store', 'shop', 'retailer', 'seller', 'website', 'vendor'],
  subscription: ['subscription', 'service'],
  list_price: ['list price', 'list_price', 'rrp', 'full price', 'retail price'],
  bundle: ['bundle', 'box set', 'boxset', 'set', 'collection'],
  notes: ['notes', 'note', 'comment', 'comments'],
};

/** All the entries as a CSV in the same columns the import reads. */
export function toCsv(file: PricesFile): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of Object.values(file.books)) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(e[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

/** How each CSV row was matched, for the preview. */
export interface ImportRow {
  line: number;
  title: string;
  author: string;
  status: 'matched' | 'unmatched' | 'error';
  /** isbn, title and author, title, or an earlier price entry */
  matched_by: 'isbn' | 'title_author' | 'title' | 'price_entry' | null;
  book_id: string | null;
  /** Set for matched and unmatched rows. */
  entry: PriceEntry | null;
  replaces: boolean;
  error: string | null;
}

export interface ImportResult {
  rows: ImportRow[];
  matched: number;
  unmatched: number;
  errors: number;
  columns: Column[];
}

const STOP = /^(the|a|an)\s+/;
export const normTitle = (s: string) =>
  (s.split(/\s*(?::|\(|\s[-–—]\s)/)[0] || s) // without a subtitle or "(Book 1)"
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(STOP, '');
const normAuthor = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** Same author if the whole name or the surname matches ("Wells, H. G." and "H. G. Wells"). */
function sameAuthor(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = normAuthor(a.includes(',') ? a.split(',').reverse().join(' ') : a);
  const y = normAuthor(b.includes(',') ? b.split(',').reverse().join(' ') : b);
  return x === y || x.split(' ').pop() === y.split(' ').pop();
}
const normIsbn = (s: string | null | undefined) => (s ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();

/** Works out which book each row of a CSV is, and the entry it would save. Changes nothing. */
export function previewImport(csv: string, books: BookRef[], file: PricesFile): ImportResult {
  const [header = [], ...data] = parseCsv(csv);
  const at: Partial<Record<Column, number>> = {};
  header.forEach((h, i) => {
    const name = h.trim().toLowerCase();
    for (const c of CSV_COLUMNS) {
      if (at[c] === undefined && HEADERS[c].includes(name)) at[c] = i;
    }
  });
  if (at.title === undefined) {
    throw new PriceError('The CSV needs a header row with a "title" column.');
  }
  const cell = (r: string[], c: Column) => (at[c] === undefined ? '' : (r[at[c]] ?? '').trim());

  const byIsbn = new Map<string, BookRef>();
  for (const b of books) {
    for (const i of [b.isbn, ...(b.isbns ?? [])]) if (normIsbn(i)) byIsbn.set(normIsbn(i), b);
  }
  // books not in the reading data that already have a price entry (never opened)
  const known = new Set(books.map((b) => b.id));
  const unopened = Object.entries(file.books)
    .filter(([id]) => !known.has(id))
    .map(([id, e]) => ({ id, title: e.title, author: e.author, isbn: e.isbn }));

  const rows: ImportRow[] = data.map((r, i) => {
    const title = cell(r, 'title');
    const author = cell(r, 'author');
    const base = { line: i + 2, title, author, replaces: false };
    try {
      if (!title) throw new PriceError('No title.');
      const m = parseMoney(cell(r, 'price'));
      if (cell(r, 'price') && m.amount === null) {
        throw new PriceError(`"${cell(r, 'price')}" isn't a price.`);
      }
      const entry = toPriceEntry({
        title,
        author,
        price: m.amount,
        currency: cell(r, 'currency') || m.currency,
        date: cell(r, 'date'),
        acquisition: cell(r, 'acquisition') || (cell(r, 'subscription') ? 'subscription' : ''),
        store: cell(r, 'store'),
        notes: cell(r, 'notes'),
        list_price: parseMoney(cell(r, 'list_price')).amount,
        subscription: cell(r, 'subscription'),
        bundle: cell(r, 'bundle'),
        isbn: cell(r, 'isbn'),
      });
      const isbn = normIsbn(entry.isbn);
      const t = normTitle(title);
      const sameTitle = (b: { title: string }) => normTitle(b.title) === t;
      let book: { id: string } | undefined;
      let by: ImportRow['matched_by'] = null;
      if (isbn && byIsbn.has(isbn)) [book, by] = [byIsbn.get(isbn), 'isbn'];
      if (!book) {
        const hits = books.filter(sameTitle);
        const withAuthor = hits.filter((b) => sameAuthor(b.author ?? '', author));
        if (withAuthor.length === 1) [book, by] = [withAuthor[0], 'title_author'];
        else if (hits.length === 1 && (!author || !hits[0].author)) [book, by] = [hits[0], 'title'];
      }
      if (!book) {
        const prior = unopened.find(
          (u) =>
            (isbn && normIsbn(u.isbn) === isbn) ||
            (sameTitle(u) && (!author || sameAuthor(u.author, author))),
        );
        if (prior) [book, by] = [prior, 'price_entry'];
      }
      return {
        ...base,
        status: book ? 'matched' : 'unmatched',
        matched_by: by,
        book_id: book?.id ?? null,
        entry,
        replaces: !!book && !!file.books[book.id],
        error: null,
      };
    } catch (e) {
      return {
        ...base,
        status: 'error',
        matched_by: null,
        book_id: null,
        entry: null,
        error: e instanceof PriceError ? e.message : 'Not understood.',
      };
    }
  });
  splitBundles(rows, books);
  return {
    rows,
    matched: rows.filter((r) => r.status === 'matched').length,
    unmatched: rows.filter((r) => r.status === 'unmatched').length,
    errors: rows.filter((r) => r.status === 'error').length,
    columns: CSV_COLUMNS.filter((c) => at[c] !== undefined),
  };
}

/**
 * Rows sharing a bundle name split the bundle's price (the sum of their prices, usually given
 * on one row) between them by word count, or evenly when any book's length isn't known.
 */
export function splitBundles(rows: ImportRow[], books: BookRef[]): void {
  const groups = new Map<string, ImportRow[]>();
  for (const r of rows) {
    if (r.entry?.bundle) groups.set(r.entry.bundle, [...(groups.get(r.entry.bundle) ?? []), r]);
  }
  const words = new Map(books.map((b) => [b.id, b.words ?? 0]));
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const total = group.reduce((s, r) => s + (r.entry!.price ?? 0), 0);
    const w = group.map((r) => (r.book_id ? (words.get(r.book_id) ?? 0) : 0));
    const sum = w.reduce((a, b) => a + b, 0);
    const shares = w.every((x) => x > 0) ? w.map((x) => x / sum) : w.map(() => 1 / group.length);
    let left = Math.round(total * 100);
    group.forEach((r, i) => {
      const pence = i === group.length - 1 ? left : Math.round(total * 100 * shares[i]);
      left -= pence;
      r.entry!.price = pence / 100;
    });
  }
}

/**
 * Saves the matched rows of a preview; with addUnmatched, unmatched rows become books that
 * were bought but never opened. Returns the new file and how many were saved.
 */
export function applyImport(
  file: PricesFile,
  preview: ImportResult,
  addUnmatched: boolean,
): { file: PricesFile; saved: number; added: number } {
  const books = { ...file.books };
  let saved = 0;
  let added = 0;
  for (const r of preview.rows) {
    if (!r.entry) continue;
    if (r.status === 'matched' && r.book_id) {
      books[r.book_id] = r.entry;
      saved++;
    } else if (r.status === 'unmatched' && addUnmatched) {
      const base = bookId(r.entry.title) || 'book';
      let id = base;
      for (let n = 2; books[id] && normTitle(books[id].title) !== normTitle(r.entry.title); n++) {
        id = `${base}-${n}`;
      }
      books[id] = r.entry;
      added++;
    }
  }
  return { file: { ...file, books }, saved, added };
}
