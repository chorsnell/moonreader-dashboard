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
  HttpException,
  NotFoundException,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AdminOnly } from '../access/admin.guard';
import { ActivityLogService } from '../library/activity-log.service';
import { ArrError } from './arr.client';
import { type BookRequest, ArrService } from './arr.service';

const MAX_TEXT = 300;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function text(v: unknown, name: string, required = false): string {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw new BadRequestException({ error: `Say which ${name}.` });
  if (s.length > MAX_TEXT) throw new BadRequestException({ error: `That ${name} is too long.` });
  return s;
}

/** A book manager error as the HTTP error the page shows. */
function asHttp(e: unknown): unknown {
  if (!(e instanceof ArrError)) return e;
  if (e.status === 404) return new NotFoundException({ error: e.message });
  if (e.status === 409) return new ConflictException({ error: e.message });
  return new BadGatewayException({ error: e.message });
}

/**
 * The admin's *arr book manager (Readarr v1 API, e.g. Bookshelf): its connection, where
 * books stand there, and requests. Admin only: the URL and API key never reach anyone else,
 * and every call goes from this server to that instance. The dashboard itself never searches
 * for or downloads books.
 */
@Controller('api/admin/arr')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class ArrController {
  constructor(
    private readonly arr: ArrService,
    private readonly activity: ActivityLogService,
  ) {}

  /** The connection, without the API key. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async settings() {
    const c = await this.arr.config();
    return { configured: !!c, url: c?.url ?? '', has_key: !!c?.api_key };
  }

  /** Sets the URL (and API key, if given) and checks they work. */
  @Put()
  @HttpCode(200)
  async configure(@Body() body: unknown) {
    const b = obj(body);
    const url = text(b.url, 'URL', true);
    if (!/^https?:\/\/[^\s/]+/i.test(url)) {
      throw new BadRequestException({ error: 'The URL must start with http:// or https://.' });
    }
    try {
      return {
        ok: true,
        ...(await this.arr.configure(url, text(b.api_key, 'API key') || undefined)),
      };
    } catch (e) {
      throw asHttp(e);
    }
  }

  @Delete()
  @HttpCode(200)
  async disconnect() {
    await this.arr.disconnect();
    return { ok: true };
  }

  /** Where each of the dashboard's books stands in the book manager, and its books in your series. */
  @Get('status')
  @Header('Cache-Control', 'no-store')
  async status() {
    try {
      return await this.arr.dashboardStatus();
    } catch (e) {
      throw asHttp(e);
    }
  }

  @Get('author')
  @Header('Cache-Control', 'no-store')
  async author(@Query('name') name: unknown) {
    try {
      return { books: await this.arr.authorBooks(text(name, 'author', true)) };
    } catch (e) {
      throw asHttp(e);
    }
  }

  /** Asks for a book: { title?, author, isbn13?, series?, series_no? }. */
  @Post('request')
  @HttpCode(200)
  async request(@Body() body: unknown) {
    const b = obj(body);
    const q: BookRequest = {
      title: text(b.title, 'title') || undefined,
      author: text(b.author, 'author', true),
      isbn13: text(b.isbn13, 'ISBN') || null,
      series: text(b.series, 'series') || null,
      series_no: b.series_no == null || b.series_no === '' ? null : Number(b.series_no),
    };
    if (!q.title && !(q.series && Number.isFinite(q.series_no))) {
      throw new BadRequestException({ error: 'Say which book: a title, or a series and number.' });
    }
    return this.run(
      () => this.arr.requestBook(q, q.title ? 'book' : 'series'),
      q.title ?? `#${q.series_no} of ${q.series}`,
    );
  }

  /** Asks for every book by an author: { author }. */
  @Post('request-author')
  @HttpCode(200)
  async requestAuthor(@Body() body: unknown) {
    const author = text(obj(body).author, 'author', true);
    return this.run(() => this.arr.requestAuthor(author), `everything by ${author}`);
  }

  private async run<T>(fn: () => Promise<T>, what: string) {
    try {
      return { ok: true, request: await fn() };
    } catch (e) {
      const err = asHttp(e);
      if (err instanceof HttpException) {
        this.activity.record({
          type: 'request',
          message: `Asked the book manager for ${what}`,
          outcome: 'failed',
          trigger: 'admin',
          error: e instanceof Error ? e.message : String(e),
        });
      }
      throw err;
    }
  }
}
