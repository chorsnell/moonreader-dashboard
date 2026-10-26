import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
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
} from '@nestjs/common';
import { AdminOnly } from '../access/admin.guard';
import { localDate } from '../common/time';
import { OpenLibraryClient } from '../covers/open-library.client';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import {
  duplicateOf,
  editBook,
  MAX_BOOKS,
  MAX_HIDDEN,
  moveInOrder,
  toHiddenKey,
  toOrderKey,
  toNewBook,
  WantError,
} from './want-to-read';
import { WantStore } from './want-to-read.store';

const SEARCH_RESULTS = 10;
const MAX_QUERY = 200;

/** Turns a WantError into a 400 the page shows. */
function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof WantError) throw new BadRequestException({ error: e.message });
    throw e;
  }
}

/**
 * The owner's own want-to-read list (BOO-102): library/want_to_read.json, edited from the To
 * read tab. Every change rebuilds, so the list's books reach data/to_read.json. Admin only.
 */
@Controller('api/admin/want')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class WantToReadController {
  constructor(
    private readonly store: WantStore,
    private readonly library: LibraryService,
    private readonly openLibrary: OpenLibraryClient,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.store.load();
  }

  /** Books on Open Library matching `q`, to pick one to add. */
  @Get('search')
  @Header('Cache-Control', 'no-store')
  async search(@Query('q') q?: string) {
    const query = String(q ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (query.length < 2) throw new BadRequestException({ error: 'Type a title or an author.' });
    if (query.length > MAX_QUERY)
      throw new BadRequestException({ error: 'That search is too long.' });
    try {
      return { results: await this.openLibrary.searchBooks(query, SEARCH_RESULTS) };
    } catch (e) {
      throw new BadGatewayException({
        error: `Open Library couldn't be reached (${(e as Error).message}). Try again, or type the book in.`,
      });
    }
  }

  @Post()
  @HttpCode(200)
  async add(@Body() body: unknown) {
    const book = await this.store.update((file) => {
      const book = checked(() => toNewBook(body, file, localDate()));
      const dup = duplicateOf(book, file);
      if (dup)
        throw new ConflictException({
          error: `“${dup.title}” is on your list already.`,
          id: dup.id,
        });
      if (file.books.length >= MAX_BOOKS) {
        throw new BadRequestException({ error: 'Your list is full.' });
      }
      return { file: { ...file, books: [...file.books, book] }, result: book };
    });
    this.activity.log(`“${book.title}” added to the want-to-read list`);
    this.library.changed('want-to-read');
    return { ok: true, book };
  }

  @Put(':id')
  @HttpCode(200)
  async edit(@Param('id') id: string, @Body() body: unknown) {
    const book = await this.store.update((file) => {
      const at = file.books.findIndex((b) => b.id === id);
      if (at < 0) throw new NotFoundException({ error: 'That book isn’t on your list.' });
      const book = checked(() => editBook(file.books[at], body));
      const dup = duplicateOf(book, file);
      if (dup)
        throw new ConflictException({
          error: `“${dup.title}” is on your list already.`,
          id: dup.id,
        });
      const books = [...file.books];
      books[at] = book;
      return { file: { ...file, books }, result: book };
    });
    this.library.changed('want-to-read');
    return { ok: true, book };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    const gone = await this.store.update((file) => {
      const book = file.books.find((b) => b.id === id);
      if (!book) throw new NotFoundException({ error: 'That book isn’t on your list.' });
      return { file: { ...file, books: file.books.filter((b) => b !== book) }, result: book };
    });
    this.activity.log(`“${gone.title}” removed from the want-to-read list`);
    this.library.changed('want-to-read');
    return { ok: true };
  }

  /** Leaves a pile row (a shelf's book or an unopened Moon+ file) off the pile. */
  @Post('hide')
  @HttpCode(200)
  async hide(@Body() body: unknown) {
    const key = checked(() => toHiddenKey((body as { key?: unknown } | null)?.key));
    await this.store.update((file) => {
      if (file.hidden.includes(key)) return { file, result: null };
      if (file.hidden.length >= MAX_HIDDEN) {
        throw new BadRequestException({ error: 'Too many hidden books.' });
      }
      return { file: { ...file, hidden: [...file.hidden, key] }, result: null };
    });
    this.library.changed('want-to-read');
    return { ok: true, key };
  }

  @Delete('hide/:key')
  @HttpCode(200)
  async unhide(@Param('key') key: string) {
    await this.store.update((file) => {
      if (!file.hidden.includes(key)) {
        throw new NotFoundException({ error: 'That book isn’t hidden.' });
      }
      return { file: { ...file, hidden: file.hidden.filter((k) => k !== key) }, result: null };
    });
    this.library.changed('want-to-read');
    return { ok: true };
  }

  /**
   * Up next: { key, to } moves a pile book to place `to` (0 = first), { key, to: null } takes
   * it out, { reset: true } clears the order. Returns the new order.
   */
  @Post('order')
  @HttpCode(200)
  async order(@Body() body: unknown) {
    const b = (body && typeof body === 'object' ? body : {}) as {
      key?: unknown;
      to?: unknown;
      reset?: unknown;
    };
    const order = await this.store.update((file) => {
      if (b.reset === true) return { file: { ...file, order: [] }, result: [] as string[] };
      const key = checked(() => toOrderKey(b.key));
      const to = b.to === null ? null : typeof b.to === 'number' ? b.to : NaN;
      const next = checked(() => moveInOrder(file.order, key, to));
      return { file: { ...file, order: next }, result: next };
    });
    this.library.changed('want-to-read');
    return { ok: true, order };
  }
}
