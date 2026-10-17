import { DatabaseSync } from 'node:sqlite';

/**
 * A small KoboReader.sqlite, laid out like the device's (only the tables and columns the
 * import reads, plus a few it ignores). Times are UTC, as Kobo writes them.
 */
export function makeKoboDb(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    create table content (ContentID text primary key, ContentType text, MimeType text,
      BookID text, BookTitle text, Title text, Attribution text, ISBN text, Series text,
      SeriesNumber text, ___PercentRead integer, ReadStatus integer, DateLastRead text,
      TimeSpentReading integer, LastTimeStartedReading text, LastTimeFinishedReading text,
      DateAdded text, ___NumPages integer);
    create table Bookmark (BookmarkID text primary key, VolumeID text, ContentID text,
      StartContainerPath text, Text text, Annotation text, ChapterProgress real,
      DateCreated text, DateModified text, Type text, Hidden text);
    create table AnalyticsEvents (Id text primary key, Type text, Timestamp text,
      Attributes text, Metrics text);
  `);
  const book = db.prepare(
    `insert into content (ContentID, ContentType, Title, Attribution, ISBN, Series, SeriesNumber,
      ___PercentRead, ReadStatus, DateLastRead, TimeSpentReading, LastTimeStartedReading,
      LastTimeFinishedReading, DateAdded) values (?, 6, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // finished, matched to Moon+'s Alpha by title and author
  book.run(
    'file:///mnt/onboard/alpha.epub',
    'Alpha',
    'Ann Author',
    '',
    null,
    null,
    100,
    2,
    '2026-03-05T20:00:00Z',
    5400,
    '2026-03-04T19:00:00Z',
    '2026-03-05T20:00:00Z',
    '2026-02-01T10:00:00Z',
  );
  // on the go, only on the Kobo, with day data
  book.run(
    'kobo-store-0001',
    'Kobo Only Book',
    'Kit Kobo',
    '978-0-14-143951-8',
    'Kobo Saga',
    '2',
    40,
    1,
    '2026-03-03T21:00:00.000',
    3600,
    '2026-03-01T20:00:00Z',
    null,
    '2026-02-20T10:00:00Z',
  );
  // on the device, never opened: left out
  book.run(
    'kobo-store-0002',
    'Unread',
    'Una Read',
    '',
    null,
    null,
    0,
    0,
    null,
    0,
    null,
    null,
    '2026-02-20T10:00:00Z',
  );
  // a chapter, not a book
  db.prepare(
    "insert into content (ContentID, ContentType, Title) values ('kobo-store-0001!ch1', 9, 'Chapter 1')",
  ).run();
  const mark = db.prepare(
    `insert into Bookmark (BookmarkID, VolumeID, Text, Annotation, DateCreated, Type, Hidden)
      values (?, ?, ?, ?, ?, ?, 'false')`,
  );
  mark.run(
    'b1',
    'kobo-store-0001',
    'A line worth keeping.',
    null,
    '2026-03-01T20:30:00Z',
    'highlight',
  );
  mark.run('b2', 'kobo-store-0001', 'Another line.', 'My thought', '2026-03-02T20:30:00Z', 'note');
  mark.run(
    'b3',
    'file:///mnt/onboard/alpha.epub',
    'From Alpha.',
    null,
    '2026-03-04T19:30:00Z',
    'highlight',
  );
  const event = db.prepare(
    'insert into AnalyticsEvents (Id, Type, Timestamp, Attributes, Metrics) values (?, ?, ?, ?, ?)',
  );
  const leave = (id: string, volume: string, when: string, progress: number, seconds: number) =>
    event.run(
      id,
      'LeaveContent',
      when,
      JSON.stringify({ volumeid: volume, progress: String(progress) }),
      JSON.stringify({ SecondsRead: String(seconds), PagesTurned: '10' }),
    );
  leave('e1', 'kobo-store-0001', '2026-03-01T12:00:00Z', 15, 1200);
  leave('e2', 'kobo-store-0001', '2026-03-01T14:00:00Z', 20, 600);
  leave('e3', 'kobo-store-0001', '2026-03-03T12:00:00Z', 40, 1800);
  event.run('e4', 'OpenContent', '2026-03-03T11:00:00Z', '{}', '{}');
  db.close();
}

/** A My Clippings.txt, as a Kindle writes it (UK dates; a US one too). */
export const MY_CLIPPINGS = [
  '﻿Pride and Prejudice (Austen, Jane)',
  '- Your Highlight on page 1 | Location 7-8 | Added on Sunday, 14 March 2021 21:03:11',
  '',
  'It is a truth universally acknowledged.',
  '==========',
  'Pride and Prejudice (Austen, Jane)',
  '- Your Note on page 1 | Location 8 | Added on Sunday, 14 March 2021 21:04:00',
  '',
  'The famous opening.',
  '==========',
  'Pride and Prejudice (Austen, Jane)',
  '- Your Bookmark on page 30 | Location 400 | Added on Monday, 15 March 2021 07:00:00',
  '',
  '',
  '==========',
  'Beta (Bob Writer)',
  '- Your Highlight at location 120-121 | Added on Tuesday, March 16, 2021 9:15:02 PM',
  '',
  'Beta has a line.',
  '==========',
  '',
].join('\r\n');

/** Amazon's Kindle.Devices.ReadingSession.csv (only the columns the import needs, and one it ignores). */
export const KINDLE_SESSIONS = [
  'start_timestamp,end_timestamp,ASIN,device_family,total_reading_millis',
  '2026-02-10T20:00:00.000Z,2026-02-10T20:30:00.000Z,B00ABCDEF1,Kindle E-reader,1800000',
  '2026-02-10T22:00:00.000Z,2026-02-10T22:10:00.000Z,B00ABCDEF1,Kindle E-reader,600000',
  '2026-02-12T20:00:00.000Z,2026-02-12T20:45:00.000Z,B00ABCDEF1,Kindle E-reader,2700000',
  'Not Available,Not Available,B00ABCDEF1,Kindle E-reader,0',
].join('\n');

export const KINDLE_TITLES = ['ASIN,Title,Author', 'B00ABCDEF1,The Kindle Book,Kay Kindle'].join(
  '\n',
);
