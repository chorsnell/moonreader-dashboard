import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LibraryService } from '../library/library.service';
import { readOverrides, type SubjectOverrides } from './genre-picks';

/** settings.json's section for the genre picks (BOO-105). */
export const DISCOVERY_SECTION = 'discovery';

/**
 * Reads the admin's genre → Open Library subject choices from library/settings.json
 * (`discovery.subjects`) for the lookup and the build. The admin page saves them through
 * AccessSettingsService, which keeps the file's other sections.
 */
@Injectable()
export class DiscoverySettings {
  constructor(private readonly library: LibraryService) {}

  async overrides(): Promise<SubjectOverrides> {
    try {
      const raw = JSON.parse(
        await readFile(join(this.library.root, 'settings.json'), 'utf8'),
      ) as Record<string, unknown> | null;
      return readOverrides(raw?.[DISCOVERY_SECTION]);
    } catch {
      return {};
    }
  }
}
