import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { LibraryService } from '../library/library.service';
import { type Challenge, readChallenges } from './challenges';

const SECTION = 'challenges';

/**
 * The admin's reading challenges: kept in settings.json (section "challenges", next to the
 * other features' sections), and copied to data/challenges.json for the page and the
 * server's stats. They name no books, so every viewer gets the same file.
 */
@Injectable()
export class ChallengesService implements OnModuleInit {
  readonly served: string;

  constructor(
    private readonly settings: AccessSettingsService,
    private readonly library: LibraryService,
  ) {
    this.served = join(library.data, 'challenges.json');
  }

  async onModuleInit(): Promise<void> {
    await this.publish();
  }

  async load(): Promise<{ challenges: Challenge[]; custom: boolean }> {
    return readChallenges(await this.settings.section(SECTION));
  }

  /** Saves the list (undefined: back to the defaults) and publishes it. */
  async save(challenges: Challenge[] | undefined): Promise<Challenge[]> {
    await this.settings.saveSection(SECTION, challenges);
    return this.publish();
  }

  /** Writes data/challenges.json from settings.json. */
  async publish(): Promise<Challenge[]> {
    const { challenges } = await this.load();
    await mkdir(this.library.data, { recursive: true });
    await writeFile(`${this.served}.tmp`, JSON.stringify(challenges), 'utf8');
    await rename(`${this.served}.tmp`, this.served);
    return challenges;
  }
}
