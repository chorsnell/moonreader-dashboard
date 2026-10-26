import { BadRequestException, Body, Controller, Get, Header, Put } from '@nestjs/common';
import { AdminOnly } from '../access/admin.guard';
import { AccessSettingsService } from '../access/access-settings.service';
import { ActivityLogService } from '../library/activity-log.service';
import {
  readSearchLinks,
  SEARCH_LINKS_SECTION,
  SearchLinkError,
  toSearchLinks,
} from './search-links';

/** Admin → Discovery → Search links. Everyone else gets theirs in /api/config. */
@Controller('api/admin/search-links')
@AdminOnly({ denied: 'Only the admin can do this.' })
export class SearchLinksController {
  constructor(
    private readonly settings: AccessSettingsService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list() {
    return { links: readSearchLinks(await this.settings.section(SEARCH_LINKS_SECTION)) };
  }

  @Put()
  async save(@Body() body: unknown) {
    let links;
    try {
      links = toSearchLinks(body);
    } catch (e) {
      if (e instanceof SearchLinkError) throw new BadRequestException({ error: e.message });
      throw e;
    }
    await this.settings.saveSection(SEARCH_LINKS_SECTION, links.length ? links : undefined);
    this.activity.log(`Search links saved: ${links.map((l) => l.name).join(', ') || 'none'}`);
    return { ok: true, links };
  }
}
