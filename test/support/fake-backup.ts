import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ZipFile } from 'yazl';

export const DAY0 = Date.UTC(2026, 2, 1) / 86_400_000; // 2026-03-01 as days since 1970
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

const ALPHA = '/sdcard/Books/Alpha - Ann Author.epub';
const BETA = '/sdcard/Books/Beta - Bob Writer.epub';

/**
 * A minimal .mrpro: a zip with _names.list, the mrbooks.db database, positions10.xml and
 * Alpha's cover (Beta has none). Alpha is read on 3 days in March and finished; Beta on 2
 * days, half way.
 */
export async function makeBackup(path: string): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'fake-backup-'));
  try {
    const dbPath = join(tmp, 'mrbooks.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      create table books (_id integer primary key, book text, filename text, lowerFilename text,
        author text, description text, category text, thumbFile text, coverFile text,
        addTime text, favorite text, downloadUrl text, rate text, bak1 text, bak2 text);
      create table tmpbooks as select * from books where 0;
      create table statistics (_id integer primary key, filename text, usedTime numeric,
        readWords numeric, dates text);
      create table notes (_id integer primary key, book text, filename text, time numeric,
        note text, original text);
    `);
    db.prepare("insert into books (book, filename, author) values ('Alpha', ?, 'Ann Author')").run(
      ALPHA,
    );
    db.prepare("insert into books (book, filename, author) values ('Beta', ?, 'Bob Writer')").run(
      BETA,
    );
    const alpha = [
      `${DAY0}|1800000@9000`,
      '#40.0%',
      `${DAY0 + 1}|1200000@6000`,
      '#70.0%',
      `${DAY0 + 2}|1500000@7000`,
      '#100%',
    ].join('\n');
    const beta = [`${DAY0 + 3}|600000@3000`, '#20.0%', `${DAY0 + 5}|900000@4000`, '#50.0%'].join(
      '\n',
    );
    const stats = db.prepare(
      'insert into statistics (filename, usedTime, readWords, dates) values (?, ?, ?, ?)',
    );
    stats.run(ALPHA, 4500000, 22000, `${alpha}\n`);
    stats.run(BETA, 1500000, 7000, `${beta}\n`);
    db.close();

    const xml =
      "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n" +
      `<string name="${ALPHA.toLowerCase()}">10@0#0:100%</string>\n` +
      `<string name="${BETA.toLowerCase()}">5@0#0:50.0%</string>\n</map>\n`;
    const base = 'com.flyersoft.moonreaderp/';
    const zip = new ZipFile();
    zip.addBuffer(
      Buffer.from(
        `${base}databases/mrbooks.db\n` +
          `${base}shared_prefs/positions10.xml\n` +
          '?/sdcard/Books/.MoonReader/Alpha - Ann Author.epub_1.png\n' +
          '?/sdcard/Books/.MoonReader/Alpha - Ann Author.epub_2.png\n',
      ),
      `${base}_names.list`,
    );
    zip.addBuffer(await readFile(dbPath), `${base}1.tag`);
    zip.addBuffer(Buffer.from(xml), `${base}2.tag`);
    zip.addBuffer(PNG.subarray(0, 12), `${base}3.tag`); // the small thumbnail
    zip.addBuffer(PNG, `${base}4.tag`); // the cover
    zip.end();
    const out = zip.outputStream.pipe(createWriteStream(path));
    await once(out, 'close');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
