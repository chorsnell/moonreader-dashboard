import type { IncomingMessage } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { AccessService, cookie } from '../access/access.service';
import { localDate } from '../common/time';
import { LibraryService } from '../library/library.service';
import {
  buildContext,
  hiddenCategories,
  type BookFacts,
  type Category,
  type FilterContext,
  type Policy,
  type ViewerRole,
} from './privacy';

/** Set by the admin's "preview as visitor": the admin then gets what that role would. */
export const PREVIEW_COOKIE = 'mrd_preview';

export interface Viewer {
  /** Who is asking: the admin, or a visitor (public, or with the read password). */
  role: 'admin' | ViewerRole;
  /** The admin previewing as a visitor. */
  preview: ViewerRole | null;
  /** The policy to filter with, or null for the admin's own view (everything). */
  policy: Policy | null;
}

/** What /api/config tells the page about what's hidden from this viewer. */
export interface PrivacySummary {
  hidden: Category[];
  dates: Policy['dates'];
  private_books: boolean;
}

/** Works out who is asking and what they may see; the filter itself is in privacy.ts. */
@Injectable()
export class PrivacyService {
  private books: { mtime: number; rows: BookFacts[] } | null = null;

  constructor(
    private readonly access: AccessService,
    private readonly settings: AccessSettingsService,
    private readonly library: LibraryService,
  ) {}

  async viewer(req: IncomingMessage): Promise<Viewer> {
    const role = await this.access.role(req);
    const { privacy } = await this.settings.load();
    if (role === 'admin') {
      const as = cookie(req, PREVIEW_COOKIE);
      if (as === 'public' || as === 'reader' || as === 'friends') {
        return { role: 'admin', preview: as, policy: privacy[as] };
      }
      return { role: 'admin', preview: null, policy: null };
    }
    const visitor = role === 'reader' ? 'reader' : 'public';
    return { role: visitor, preview: null, policy: privacy[visitor] };
  }

  /** The filter context for a viewer, or null when they see everything untouched. */
  async context(viewer: Viewer): Promise<FilterContext | null> {
    if (!viewer.policy) return null;
    const { privacy } = await this.settings.load();
    const meta = await this.library.meta();
    const asOf = typeof meta.generated === 'string' ? meta.generated : localDate();
    return buildContext(viewer.policy, privacy, await this.bookFacts(), asOf);
  }

  async summary(viewer: Viewer, ctx: FilterContext | null): Promise<PrivacySummary | null> {
    if (!viewer.policy) return null;
    return {
      hidden: hiddenCategories(viewer.policy),
      dates: viewer.policy.dates,
      private_books: Boolean(ctx && ctx.private.size),
    };
  }

  /** books.json, read again only when it changes. */
  private async bookFacts(): Promise<BookFacts[]> {
    const file = join(this.library.data, 'books.json');
    const mtime = await stat(file).then(
      (s) => s.mtimeMs,
      () => 0,
    );
    if (this.books?.mtime === mtime) return this.books.rows;
    let rows: BookFacts[] = [];
    try {
      rows = JSON.parse(await readFile(file, 'utf8')) as BookFacts[];
    } catch {
      // no data yet
    }
    this.books = { mtime, rows };
    return rows;
  }
}
