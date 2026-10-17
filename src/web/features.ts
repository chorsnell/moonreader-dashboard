import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Feature scripts live one per file in web/features/ (with an optional .css of the same
 * name) and are added to the page here, so a new view needs no edit to index.html.
 */
export async function withFeatures(page: string, webDir: string): Promise<string> {
  const files = (await readdir(join(webDir, 'features')).catch(() => [] as string[])).sort();
  const css = files.filter((f) => f.endsWith('.css'));
  const js = files.filter((f) => f.endsWith('.js'));
  const links = css.map((f) => `<link rel="stylesheet" href="features/${f}">`).join('\n');
  const scripts = js.map((f) => `<script src="features/${f}"></script>`).join('\n');
  return page.replace('</head>', `${links}\n</head>`).replace('<!-- features -->', scripts);
}
