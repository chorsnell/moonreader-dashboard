import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { CoverStore } from '../covers/cover-store.service';
import { StatsService } from '../stats/stats.service';
import { collage } from './collage';
import { shareCard, type ShareCard } from './share-card';

/** Covers read for the collage: enough to fill it after skipping any that can't be read. */
const COVERS_TRIED = 32;

export interface ShareImage {
  jpeg: Buffer;
  /** Changes with the picture, for the image's URL and its ETag. */
  version: string;
}

/**
 * The card a shared link shows, from what the public may see. The collage is made once
 * per data and covers version and kept in memory (it takes a moment to draw).
 */
@Injectable()
export class ShareService {
  private readonly log = new Logger(ShareService.name);
  private image: { key: string; image: Promise<ShareImage | null> } | null = null;

  constructor(
    private readonly stats: StatsService,
    private readonly covers: CoverStore,
  ) {}

  async card(): Promise<ShareCard> {
    const set = await this.stats.get('public');
    const asOf = (set.rows.as_of as { date?: string }[] | undefined)?.[0]?.date ?? null;
    return shareCard(set.inputs.get('books'), set.inputs.get('reads'), asOf);
  }

  /** The collage of the card's covers, or null when there are none to show. */
  async collage(): Promise<ShareImage | null> {
    const card = await this.card();
    const saved = await this.covers.existing();
    const files = card.coverIds
      .map((id) => saved.get(id))
      .filter((f): f is string => Boolean(f))
      .slice(0, COVERS_TRIED);
    if (!files.length) return null;
    const stamps = await Promise.all(
      files.map((f) =>
        stat(join(this.covers.dir, f)).then(
          (s) => `${f}:${s.mtimeMs}`,
          () => `${f}:-`,
        ),
      ),
    );
    const key = createHash('sha256').update(stamps.join('\n')).digest('base64url').slice(0, 16);
    if (this.image?.key !== key) {
      const image = this.draw(files, key);
      this.image = { key, image };
      image.catch(() => this.image?.image === image && (this.image = null));
    }
    return this.image.image;
  }

  private async draw(files: string[], version: string): Promise<ShareImage | null> {
    const started = Date.now();
    const data = await Promise.all(
      files.map((f) => readFile(join(this.covers.dir, f)).catch(() => null)),
    );
    const jpeg = collage(data.filter((d) => d !== null));
    this.log.debug(`share image from ${files.length} covers in ${Date.now() - started} ms`);
    return jpeg ? { jpeg, version } : null;
  }
}
