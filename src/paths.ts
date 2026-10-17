import { join, resolve } from 'node:path';

/** The project root. This file sits directly in src/ (or dist/ once built), one level below it. */
export const ROOT = resolve(__dirname, '..');

/** The dashboard page: index.html and its scripts. */
export const WEB_DIR = join(ROOT, 'web');

/** The starting catalogue.json, copied into the library on first run. */
export const SEED_CATALOGUE = join(ROOT, 'seed', 'catalogue.json');
