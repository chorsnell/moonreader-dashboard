import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withFeatures } from './features';

const PAGE =
  '<html><head>\n</head><body>\n<script src="charts.js"></script>\n<!-- features -->\n</body></html>';

describe('feature scripts', () => {
  let dir: string;
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'features-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('adds every script and stylesheet in name order', async () => {
    await mkdir(join(dir, 'features'));
    for (const f of ['b.js', 'a.js', 'a.css', 'README.md'])
      await writeFile(join(dir, 'features', f), '');
    const page = await withFeatures(PAGE, dir);
    expect(page).toContain('<link rel="stylesheet" href="features/a.css">\n</head>');
    expect(page).toContain(
      '<script src="features/a.js"></script>\n<script src="features/b.js"></script>',
    );
    expect(page).not.toContain('README');
    expect(page).not.toContain('<!-- features -->');
  });

  it('leaves the page alone without a features folder', async () => {
    const page = await withFeatures(PAGE, dir);
    expect(page).toContain('<script src="charts.js"></script>');
  });
});
