import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ZipFile } from 'yazl';
import { addedLead, BOOKS, fileName, UNOPENED } from './demo-books';
import type { DemoNote } from './demo-highlights';
import type { DemoDay } from './simulate';

/** Writes the simulated history as a Moon+ backup, laid out the way the app writes one. */
export async function writeDemoBackup(
  path: string,
  log: Map<string, DemoDay[]>,
  firstDay: number,
  highlights: Map<string, DemoNote[]> = new Map(),
  lastDay?: number,
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
      create table notes (_id integer primary key, book text, filename text, lowerFilename text,
        lastChapter numeric, lastSplitIndex numeric, lastPosition numeric,
        highlightLength numeric, highlightColor numeric, time numeric, bookmark text,
        note text, original text, underline numeric, strikethrough numeric, bak text);
    `);
    const addBook = db.prepare(
      'insert into books (book, filename, lowerFilename, author, addTime) values (?, ?, ?, ?, ?)',
    );
    // addTime: when the file was added to Moon+, in ms (as text, as Moon+ keeps it)
    const at = (day: number) => String(day * 86_400_000 + 9 * 3_600_000);
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
      addBook.run(
        title,
        full,
        full.toLowerCase(),
        author,
        at(firstDay + Math.max(0, entries[0].day - addedLead(title))),
      );
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
    // never opened: in the library, with no reading log or position
    if (lastDay !== undefined) {
      for (const [title, author, , , , , , ago] of UNOPENED) {
        const full = `/sdcard/Books/${fileName(title, author)}`;
        addBook.run(title, full, full.toLowerCase(), author, at(lastDay - ago));
      }
    }
    const addNote = db.prepare(
      `insert into notes (book, filename, lowerFilename, lastChapter, lastSplitIndex,
        lastPosition, highlightLength, highlightColor, time, bookmark, note, original,
        underline, strikethrough) values (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    );
    const notes = [...highlights].flatMap(([file, list]) => list.map((n) => ({ file, ...n })));
    for (const n of notes.sort((a, b) => a.day - b.day || a.minute - b.minute)) {
      const full = `/sdcard/Books/${n.file}`;
      // a local time, as the phone would have recorded it
      const [y, m, d] = new Date((firstDay + n.day) * 86_400_000)
        .toISOString()
        .slice(0, 10)
        .split('-')
        .map(Number);
      const time = new Date(y, m - 1, d, 0, n.minute).getTime();
      addNote.run(
        authors.get(n.file)![0],
        full,
        full.toLowerCase(),
        n.chapter,
        n.position,
        n.original.length,
        n.colour,
        time,
        n.bookmark,
        n.note,
        n.original,
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
