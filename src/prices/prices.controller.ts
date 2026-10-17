import type { IncomingMessage } from 'node:http';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly } from '../access/admin.guard';
import { ActivityLogService } from '../library/activity-log.service';
import {
  ACQUISITIONS,
  applyImport,
  bookId,
  missingRates,
  previewImport,
  PriceError,
  toCsv,
  toPriceEntry,
  toSettings,
  toSubscriptions,
} from './prices';
import { PricesService } from './prices.service';

const BOOK_ID = /^[a-z0-9-]{1,200}$/;
const MAX_CSV_BYTES = 2 * 1024 * 1024;

/** Turns a PriceError into a 400 the admin page shows. */
function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof PriceError) throw new BadRequestException({ error: e.message });
    throw e;
  }
}

async function readCsv(req: IncomingMessage): Promise<string> {
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  // not a type a form on another site can send without asking first
  if (!type.startsWith('text/csv')) {
    req.resume();
    throw new BadRequestException({ error: 'Send the CSV as text/csv.' });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_CSV_BYTES) {
      throw new BadRequestException({ error: 'That CSV is too large (2 MB at most).' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The admin's price list: per book, settings, subscriptions and CSV import. Admin only. */
@Controller('api/admin/prices')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class PricesController {
  constructor(
    private readonly prices: PricesService,
    private readonly activity: ActivityLogService,
  ) {}

  /** Everything the Prices section needs: the price list and the books it can price. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list() {
    const prices = await this.prices.load();
    const books = (await this.prices.books()).map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author ?? '',
      status: b.status ?? null,
      hours: b.hours ?? null,
      words: b.words ?? null,
    }));
    return {
      prices,
      books,
      acquisitions: ACQUISITIONS,
      missing_rates: missingRates(prices),
    };
  }

  /** Sets one book's price. The id is a book of the last build, or one made by POST. */
  @Put('books/:id')
  @HttpCode(200)
  async setBook(@Param('id') id: string, @Body() body: unknown) {
    if (!BOOK_ID.test(id)) throw new NotFoundException({ error: 'No such book.' });
    const entry = checked(() => toPriceEntry(body));
    await this.prices.update((p) => ({
      prices: { ...p, books: { ...p.books, [id]: entry } },
      result: null,
    }));
    this.activity.log(`Price for ${id} saved from the admin page`);
    return { ok: true, entry };
  }

  /** Adds a book that was bought but isn't in the reading data (never opened). */
  @Post('books')
  @HttpCode(200)
  async addBook(@Body() body: unknown) {
    const entry = checked(() => toPriceEntry(body));
    const id = await this.prices.update((p) => {
      const base = bookId(entry.title) || 'book';
      let next = base;
      for (let n = 2; p.books[next]; n++) next = `${base}-${n}`;
      return { prices: { ...p, books: { ...p.books, [next]: entry } }, result: next };
    });
    this.activity.log(`Price for ${id} (not in the reading data) added from the admin page`);
    return { ok: true, id, entry };
  }

  @Delete('books/:id')
  @HttpCode(200)
  async removeBook(@Param('id') id: string) {
    if (!BOOK_ID.test(id)) throw new NotFoundException({ error: 'No such book.' });
    await this.prices.update((p) => {
      const books = { ...p.books };
      delete books[id];
      return { prices: { ...p, books }, result: null };
    });
    this.activity.log(`Price for ${id} removed from the admin page`);
    return { ok: true };
  }

  /** Home currency, exchange rates, budgets and benchmarks. */
  @Put('settings')
  @HttpCode(200)
  async setSettings(@Body() body: unknown) {
    const settings = checked(() => toSettings(body));
    const missing = await this.prices.update((p) => {
      const next = { ...p, settings };
      return { prices: next, result: missingRates(next) };
    });
    this.activity.log('Price settings saved from the admin page');
    return { ok: true, settings, missing_rates: missing };
  }

  @Put('subscriptions')
  @HttpCode(200)
  async setSubscriptions(@Body() body: unknown) {
    const subscriptions = checked(() => toSubscriptions(body));
    await this.prices.update((p) => ({ prices: { ...p, subscriptions }, result: null }));
    this.activity.log('Subscriptions saved from the admin page');
    return { ok: true, subscriptions };
  }

  /**
   * A CSV of prices (text/csv). Without confirm it only shows what would match; with
   * confirm=1 it saves the matched rows, and with add_unmatched=1 the rest too, as books
   * bought but never opened.
   */
  @Post('import')
  @HttpCode(200)
  async importCsv(
    @Req() req: Request,
    @Query('confirm') confirm?: string,
    @Query('add_unmatched') addUnmatched?: string,
  ) {
    const csv = await readCsv(req);
    const books = await this.prices.books();
    if (confirm !== '1') {
      const current = await this.prices.load();
      const preview = checked(() => previewImport(csv, books, current));
      return { ok: true, saved: false, ...preview };
    }
    const result = await this.prices.update((p) => {
      const preview = checked(() => previewImport(csv, books, p));
      const done = applyImport(p, preview, addUnmatched === '1');
      return { prices: done.file, result: { ...preview, saved: done.saved, added: done.added } };
    });
    this.activity.log(
      `Prices imported from a CSV: ${result.saved} matched` +
        (result.added ? `, ${result.added} added as not yet opened` : '') +
        (result.errors ? `, ${result.errors} row(s) not understood` : ''),
    );
    return { ok: true, ...result };
  }

  /** Every entry as a CSV in the import's columns, as a backup or to edit in a spreadsheet. */
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="prices.csv"')
  @Header('Cache-Control', 'no-store')
  async exportCsv() {
    return toCsv(await this.prices.load());
  }
}
