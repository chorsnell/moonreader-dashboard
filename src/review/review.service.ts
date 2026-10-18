import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { localDate } from '../common/time';
import { LibraryService } from '../library/library.service';
import { NotifierService } from '../notify/notifier.service';
import { filterDataFile, type FilterContext } from '../privacy/privacy';
import {
  type Action,
  ankiText,
  answer,
  type Card,
  inWords,
  type ReviewBook,
  type ReviewHighlight,
  reviewable,
  type ReviewSettings,
  type ReviewState,
  summary,
  today,
  toSettings,
  toState,
} from './review';

const TICK = 'review-tick';
const TICK_MS = 10 * 60_000;
export const NOTIFY_KIND = 'highlight_review';

/** One of today's highlights, as the page shows it. */
export interface TodayItem {
  key: string;
  book_id: string;
  title: string;
  author: string;
  genre: string | null;
  text: string;
  note: string | null;
  date: string | null;
  /** The admin only: how it's scheduled. */
  card?: Card | null;
}

/**
 * The daily highlight review (BOO-83): today's few highlights, the owner's answers, and the
 * morning send through notifications (BOO-72). The state is the owner's alone
 * (library/highlight-review.json); visitors get a read-only list filtered like the data.
 */
@Injectable()
export class ReviewService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(ReviewService.name);
  readonly file: string;
  /** One write at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly library: LibraryService,
    private readonly notifier: NotifierService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.file = join(library.root, 'highlight-review.json');
    notifier.registerKind(
      NOTIFY_KIND,
      'Daily highlights',
      'Each morning, the highlights for today’s review (switched on in Admin → Daily review).',
    );
  }

  onApplicationBootstrap(): void {
    const timer = setInterval(() => void this.morning().catch((e) => this.log.warn(e)), TICK_MS);
    timer.unref();
    this.scheduler.addInterval(TICK, timer);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  private async data<T>(name: string, ctx: FilterContext | null): Promise<T[]> {
    try {
      let v = JSON.parse(await readFile(join(this.library.data, name), 'utf8')) as unknown;
      if (ctx) v = filterDataFile(name, v, ctx);
      return Array.isArray(v) ? (v as T[]) : [];
    } catch {
      return [];
    }
  }

  async load(): Promise<ReviewState> {
    try {
      return toState(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return toState(null);
    }
  }

  private async save(s: ReviewState): Promise<void> {
    await writeFile(this.file + '.part', JSON.stringify(s));
    await rename(this.file + '.part', this.file);
  }

  /** Runs a change to the state after any other, and saves it. */
  private change<T>(
    fn: (s: ReviewState) => Promise<[ReviewState, T]> | [ReviewState, T],
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const [next, out] = await fn(await this.load());
      await this.save(next);
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async pool(ctx: FilterContext | null) {
    const books = await this.data<ReviewBook>('books.json', ctx);
    const highlights = await this.data<ReviewHighlight>('highlights.json', ctx);
    return { books, pool: reviewable(highlights, books) };
  }

  private items(
    keys: string[],
    pool: Map<string, ReviewHighlight>,
    books: ReviewBook[],
    cards: Record<string, Card> | null,
  ): TodayItem[] {
    const byId = new Map(books.map((b) => [b.id, b]));
    return keys
      .filter((k) => pool.has(k))
      .map((key) => {
        const h = pool.get(key)!;
        const b = byId.get(h.book_id)!;
        return {
          key,
          book_id: h.book_id,
          title: b.title,
          author: b.author,
          genre: b.genre ?? null,
          text: h.text,
          note: h.note,
          date: h.date,
          ...(cards ? { card: cards[key] ?? null } : {}),
        };
      });
  }

  /**
   * Today's highlights. The admin (ctx null) gets the day's pick, made and saved the first
   * time it's asked for, with each one's schedule. A visitor gets the same pick read-only,
   * less anything their filter leaves out (all of it when highlights are hidden), and no
   * schedule.
   */
  async today(ctx: FilterContext | null, date = localDate()) {
    const { books, pool } = await this.pool(null);
    let state = await this.load();
    if (state.today?.date !== date) {
      state = await this.change((s) => {
        const t = today(s, pool, date);
        return [t.state, t.state];
      });
    }
    const keys = today(state, pool, date).keys;
    if (!ctx) {
      return {
        date,
        items: this.items(keys, pool, books, state.cards),
        settings: state.settings,
        ...summary(state, pool, date),
      };
    }
    const seen = await this.pool(ctx);
    return { date, items: this.items(keys, seen.pool, seen.books, null) };
  }

  /** The owner's answer for one highlight; returns when it's next due ("never": null). */
  async answer(key: string, action: Action, date = localDate()) {
    const { pool } = await this.pool(null);
    if (!pool.has(key)) return null;
    return this.change((s) => {
      const card = answer(s.cards[key], action, date);
      const cards = { ...s.cards };
      if (card) cards[key] = card;
      else delete cards[key];
      const next = card && !card.never ? { due: card.due, when: inWords(date, card.due) } : null;
      return [
        { ...s, cards },
        { ok: true, card: card ?? null, next },
      ];
    });
  }

  async settings(): Promise<ReviewSettings & { notifier: boolean }> {
    const s = await this.load();
    return { ...s.settings, notifier: await this.notifier.wants(NOTIFY_KIND) };
  }

  saveSettings(raw: unknown): Promise<ReviewSettings> {
    return this.change((s) => {
      const settings = toSettings(raw, s.settings);
      // a new number a day applies from today
      const keep = s.today && settings.per_day === s.settings.per_day ? s.today : null;
      return [{ ...s, settings, today: keep }, settings];
    });
  }

  async anki(): Promise<string> {
    const { books, pool } = await this.pool(null);
    return ankiText(pool, books, (await this.load()).cards);
  }

  /**
   * The morning send: once a day, from the chosen hour, today's highlights go to the owner's
   * notification channels, if switched on. Returns whether it sent.
   */
  async morning(now = new Date()): Promise<boolean> {
    const s = await this.load();
    const date = localDate(now);
    if (!s.settings.notify || s.sent === date || now.getHours() < s.settings.hour) return false;
    const t = await this.today(null, date);
    // mark it first, so a slow or failing channel doesn't get it twice
    await this.change((st) => [{ ...st, sent: date }, null]);
    if (!t.items.length) return false;
    const message = t.items
      .map((i) => `“${i.text || i.note}”\n— ${i.title}, ${i.author}`)
      .join('\n\n');
    const r = await this.notifier.send({
      kind: NOTIFY_KIND,
      title: `Today's highlights (${t.items.length})`,
      message: message.length > 3500 ? message.slice(0, 3499) + '…' : message,
      tags: ['books'],
      priority: 'low',
      data: { date, items: t.items.map(({ card: _c, ...i }) => i) },
    });
    return r.enabled && r.sent > 0;
  }
}
