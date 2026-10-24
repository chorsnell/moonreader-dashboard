import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Body, Controller, Get, Header, HttpCode, Put } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { AdminOnly } from '../access/admin.guard';
import { BibliographyStore } from '../bibliography/bibliography-store.service';
import { DISCOVERY_SECTION, DiscoverySettings } from '../bibliography/discovery-settings.service';
import { discoveryTargets, slugify, type PickBook } from '../bibliography/genre-picks';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService } from '../library/library.service';
import { RebuildService } from '../rebuild/rebuild.service';

const MAX_OVERRIDES = 200;

/**
 * Admin → Discovery (BOO-105): which Open Library subject each of your genres and subgenres
 * is looked up under for "Popular in <genre> you haven't read". Kept in settings.json under
 * `discovery.subjects`.
 */
@Controller('api/admin/discovery')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class DiscoveryController {
  constructor(
    private readonly library: LibraryService,
    private readonly settings: AccessSettingsService,
    private readonly discovery: DiscoverySettings,
    private readonly store: BibliographyStore,
    private readonly rebuild: RebuildService,
    private readonly activity: ActivityLogService,
  ) {}

  /** Each of your genres (and subgenres with 3+ books) with its default subject and override. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list() {
    let books: PickBook[] = [];
    try {
      const raw = JSON.parse(
        await readFile(join(this.library.data, 'books.json'), 'utf8'),
      ) as unknown;
      if (Array.isArray(raw)) books = raw as PickBook[];
    } catch {
      // no data yet
    }
    const overrides = await this.discovery.overrides();
    const cache = (await this.store.read()).subjects ?? {};
    const genres = discoveryTargets(books, overrides).map((t) => {
      const name = t.subgenre ?? t.genre;
      const key = Object.keys(overrides).find((k) => k.toLowerCase() === name.toLowerCase());
      const found = t.subject ? cache[t.subject] : undefined;
      return {
        ...t,
        override: key === undefined ? null : overrides[key],
        looked_up: found?.looked_up ?? null,
        works: found ? found.works.length : null,
      };
    });
    return { genres };
  }

  /**
   * `{subjects: {<genre or subgenre>: <slug> | ""}}`: an override per name (a slug, or ""
   * to skip it); a name left out, or null, goes back to its default. Then rebuilds, and the
   * lookup that follows fetches any new subject.
   */
  @Put()
  @HttpCode(200)
  async save(@Body() body: unknown) {
    const raw = body && typeof body === 'object' ? (body as { subjects?: unknown }).subjects : null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException({ error: 'Send {subjects: {genre: slug}}.' });
    }
    const subjects: Record<string, string> = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string' || !name.trim() || name.length > 100 || value.length > 100) {
        throw new BadRequestException({ error: `The subject for “${name}” must be text.` });
      }
      subjects[name.trim()] = slugify(value);
    }
    if (Object.keys(subjects).length > MAX_OVERRIDES) {
      throw new BadRequestException({ error: `At most ${MAX_OVERRIDES} genres.` });
    }
    const before = JSON.stringify(await this.discovery.overrides());
    await this.settings.saveSection(
      DISCOVERY_SECTION,
      Object.keys(subjects).length ? { subjects } : undefined,
    );
    const changed = before !== JSON.stringify(subjects);
    if (changed) {
      this.activity.record({
        type: 'settings',
        message: 'Changed the Open Library subjects for genre picks',
        trigger: 'admin',
        details: { overrides: Object.keys(subjects).length },
      });
      await this.rebuild.rebuildNow();
    }
    return { ok: true, subjects, rebuilding: changed };
  }
}
