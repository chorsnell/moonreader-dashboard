import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LibraryService } from '../library/library.service';
import type { MetadataFile, MetadataMisses } from './metadata.types';

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return { ...fallback, ...(JSON.parse(await readFile(path, 'utf8')) as Partial<T>) };
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 1), 'utf8');
  await rename(`${path}.tmp`, path);
}

/**
 * library/metadata.json, what the lookup found, and library/.metadata-misses.json, what it
 * didn't. Only metadata.json is an input to the build.
 */
@Injectable()
export class MetadataStore {
  constructor(private readonly library: LibraryService) {}

  read(): Promise<MetadataFile> {
    return readJson<MetadataFile>(this.library.metadata, { books: {}, authors: {} });
  }

  write(metadata: MetadataFile): Promise<void> {
    return writeJson(this.library.metadata, metadata);
  }

  readMisses(): Promise<MetadataMisses> {
    return readJson<MetadataMisses>(this.missesFile, { books: {}, authors: {} });
  }

  writeMisses(misses: MetadataMisses): Promise<void> {
    return writeJson(this.missesFile, misses);
  }

  private get missesFile(): string {
    return join(this.library.root, '.metadata-misses.json');
  }
}
