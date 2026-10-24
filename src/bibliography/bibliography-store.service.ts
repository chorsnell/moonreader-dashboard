import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LibraryService } from '../library/library.service';
import type { BibliographyFile, BibliographyMisses } from './bibliography.types';

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return { ...fallback, ...(JSON.parse(await readFile(path, 'utf8')) as Partial<T>) };
  } catch {
    return fallback;
  }
}

/** Writes through a .tmp file, so a reader never sees half of it. */
async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 1), 'utf8');
  await rename(`${path}.tmp`, path);
}

/**
 * library/bibliography.json, what the bibliography lookup found (an input to the build), and
 * library/.bibliography-misses.json, the authors it couldn't find.
 */
@Injectable()
export class BibliographyStore {
  constructor(private readonly library: LibraryService) {}

  read(): Promise<BibliographyFile> {
    return readJson<BibliographyFile>(this.library.bibliography, { authors: {} });
  }

  write(file: BibliographyFile): Promise<void> {
    return writeJson(this.library.bibliography, file);
  }

  readMisses(): Promise<BibliographyMisses> {
    return readJson<BibliographyMisses>(this.missesFile, { authors: {} });
  }

  writeMisses(misses: BibliographyMisses): Promise<void> {
    return writeJson(this.missesFile, misses);
  }

  private get missesFile(): string {
    return join(this.library.root, '.bibliography-misses.json');
  }
}
