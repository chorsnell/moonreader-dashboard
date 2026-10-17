/**
 * Books, authors, series, genres and years link through the helpers in charts.js's links
 * section (pages/*.js get them from rh), so they link the same way everywhere. These catch
 * code that goes around them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_DIR } from '../../src/paths';

const src = readFileSync(join(WEB_DIR, 'charts.js'), 'utf8');
const start = src.indexOf('// ---------- links ----------');
const end = src.indexOf('// ----------', start + 10);
// pages/*.js and features/*.js draw with the same helpers
const pages = ['pages', 'features'].flatMap((dir) =>
  readdirSync(join(WEB_DIR, dir))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => readFileSync(join(WEB_DIR, dir, f), 'utf8')),
);
const links = src.slice(start, end);
const rest = [src.slice(0, start) + src.slice(end), ...pages].join('\n');
const fields = [...links.matchAll(/field: '(\w+)'/g)].map((m) => m[1]).filter((f) => f !== 'title');

describe('links on the page', () => {
  it('finds the links section', () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
  });

  it('makes links only with the helpers', () => {
    const made = rest.match(/(?:setAttribute|\.attr)\(\s*'data-(?:link|id|book)'/g) ?? [];
    expect(made).toEqual([]); // make links with link() or links() instead
  });

  it('never shows a linkable field as plain text', () => {
    expect([...fields].sort()).toEqual(['author', 'genre', 'series', 'subgenre', 'year']);
    const f = fields.join('|');
    const plain = [
      new RegExp(`\\bel\\([^()]*,\\s*\\w+\\.(?:${f})\\s*\\)`, 'g'), // el('small', null, r.author)
      new RegExp(`textContent\\s*=\\s*\\w+\\.(?:${f})\\b`, 'g'), // td.textContent = r.series
      new RegExp(`createTextNode\\(\\s*\\w+\\.(?:${f})\\s*\\)`, 'g'), // createTextNode(b.genre)
    ];
    for (const pattern of plain) {
      // show these with ref(), byline() or chip() so they link
      expect(rest.match(pattern) ?? []).toEqual([]);
    }
  });
});
