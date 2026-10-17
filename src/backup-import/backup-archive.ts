import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import * as yauzl from 'yauzl';

/** What the import needs from a Moon+ backup. */
export interface BackupContents {
  /** mrbooks.db, written to a temporary file (SQLite needs a real file). */
  databasePath: string | null;
  /** shared_prefs/positions10.xml: the last reading position of every book. */
  positionsXml: string | null;
  /** Lower-case book file name -> the largest cover image Moon+ cached for it. */
  covers: Map<string, Buffer>;
}

export class NotABackupError extends Error {
  constructor() {
    super('This does not look like a Moon+ Reader backup (no _names.list).');
  }
}

/**
 * Reads a .mrpro backup. It's a zip where every file is stored as <base><n>.tag, and
 * <base>_names.list says, line n, what the original path of file n was.
 */
export async function readBackup(path: string, tmpDir: string): Promise<BackupContents> {
  const zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false });
  try {
    const entries = new Map<string, yauzl.Entry>();
    for await (const entry of zip.eachEntry()) entries.set(entry.fileName, entry);
    const read = async (entry: yauzl.Entry) => buffer(await zip.openReadStreamPromise(entry));

    const namesEntry = [...entries.values()].find((e) => e.fileName.endsWith('_names.list'));
    if (!namesEntry) throw new NotABackupError();
    const base = namesEntry.fileName.slice(0, -'_names.list'.length);
    const listing = (await read(namesEntry)).toString('utf8').split(/\r?\n/);
    const tag = (lineNo: number) => entries.get(`${base}${lineNo}.tag`);

    const find = (suffix: string) => {
      const i = listing.findIndex((line) => line.trim().endsWith(suffix));
      return i < 0 ? undefined : tag(i + 1);
    };

    const dbEntry = find('databases/mrbooks.db');
    let databasePath: string | null = null;
    if (dbEntry) {
      databasePath = join(tmpDir, 'mrbooks.db');
      await writeFile(databasePath, await read(dbEntry));
    }
    const positionsEntry = find('shared_prefs/positions10.xml');
    const positionsXml = positionsEntry ? (await read(positionsEntry)).toString('utf8') : null;

    // Moon+ caches each book's cover as .MoonReader/<book file>_<n>.png; keep the largest
    const best = new Map<string, yauzl.Entry>();
    listing.forEach((line, i) => {
      const m = /\/\.moonreader\/([^/]+)_\d\.png$/.exec(line.trim().toLowerCase());
      const entry = tag(i + 1);
      if (m && entry && entry.uncompressedSize > (best.get(m[1])?.uncompressedSize ?? 0)) {
        best.set(m[1], entry);
      }
    });
    const covers = new Map<string, Buffer>();
    for (const [name, entry] of best) covers.set(name, await read(entry));

    return { databasePath, positionsXml, covers };
  } finally {
    zip.close();
  }
}
