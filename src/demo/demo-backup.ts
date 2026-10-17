import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ZipFile } from 'yazl';
import { BOOKS, fileName } from './demo-books';
import type { DemoDay } from './simulate';

/** Writes the simulated history as a Moon+ backup, laid out the way the app writes one. */
export async function writeDemoBackup(
  path: string,
  log: Map<string, DemoDay[]>,
  firstDay: number,
): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'demo-backup-'));
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
    `);
    const addBook = db.prepare(
      'insert into books (book, filename, lowerFilename, author) values (?, ?, ?, ?)',
    );
    const addStats = db.prepare(
      'insert into statistics (filename, usedTime, readWords, dates) values (?, ?, ?, ?)',
    );
    const authors = new Map(
      BOOKS.map(([title, author]) => [fileName(title, author), [title, author]]),
    );
    const positions: string[] = [];
    for (const [file, entries] of log) {
      const full = `/sdcard/Books/${file}`;
      const [title, author] = authors.get(file)!;
      addBook.run(title, full, full.toLowerCase(), author);
      const ms = (m: number) => Math.floor(m * 60000);
      const dates = entries
        .map((e) => `${firstDay + e.day}|${ms(e.minutes)}@${e.words}\n#${e.progress}%\n`)
        .join('');
      addStats.run(
        full,
        entries.reduce((s, e) => s + ms(e.minutes), 0),
        entries.reduce((s, e) => s + e.words, 0),
        dates,
      );
      positions.push(
        `<string name="${full.toLowerCase()}">1@0#0:${entries.at(-1)!.progress}%</string>`,
      );
    }
    db.close();

    const xml =
      "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n" +
      positions.join('\n') +
      '\n</map>\n';
    const base = 'com.flyersoft.moonreaderp/';
    const zip = new ZipFile();
    zip.addBuffer(
      Buffer.from(`${base}databases/mrbooks.db\n${base}shared_prefs/positions10.xml\n`),
      `${base}_names.list`,
    );
    zip.addBuffer(await readFile(dbPath), `${base}1.tag`);
    zip.addBuffer(Buffer.from(xml), `${base}2.tag`);
    zip.end();
    await once(zip.outputStream.pipe(createWriteStream(path)), 'close');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
