# What a Moon+ Reader backup holds

Notes on the `.mrpro` backup format, as far as the dashboard uses it. Moon+ Reader isn't open
source and its format isn't documented, so this comes from backups, from other open-source
tools that read Moon+ files, and from what the import has met so far. Where something is a
guess, it says so.

## The archive

A `.mrpro` file is a zip. Every file in it is stored as `<base><n>.tag`, and
`<base>_names.list` gives the real path of each, one per line (line *n* is `<n>.tag`). The
ones the import reads (see `src/backup-import/backup-archive.ts`):

| Path | What it is |
| --- | --- |
| `com.flyersoft.moonreaderp/databases/mrbooks.db` | SQLite: the library, the reading log and highlights |
| `com.flyersoft.moonreaderp/shared_prefs/positions10.xml` | the last position in each book |
| `…/.MoonReader/<book file>_<n>.png` | cover thumbnails |

## mrbooks.db

### `books` and `tmpbooks`

One row per book file: `book` (title), `filename` (full Android path), `lowerFilename`,
`author`, `addTime` (when the book was added, read as milliseconds or seconds since 1970;
anything else is ignored), and fields the dashboard doesn't use (`description`, `category`,
`coverFile`, `favorite`, `rate`, …). A file here with no reading log and no position was
never opened, and goes on the to-read pile (`data/to_read.json`).

> The `addTime` format is assumed, not confirmed against a real backup. If yours holds
> something other than a timestamp, books simply have no "added" date.

### `statistics`

One row per book file: `filename`, `usedTime` (ms read, lifetime), `readWords` (lifetime)
and `dates`, a log of reading days. Each day is a token `<days since 1970>|<ms>@<words>`,
often followed by `#<progress>%` (where the book was at the end of that day). Older
entries can be just `<days since 1970>`. There is no time of day anywhere in this table.

### `notes`: highlights, notes and bookmarks

One row per highlight, note or bookmark. The columns, in the order Moon+ also writes them to
its per-book `.an` note exports:

| Column | Type | Meaning |
| --- | --- | --- |
| `_id` | integer | row id |
| `book` | text | book title |
| `filename` | text | full Android path of the book file (same as in `statistics`) |
| `lowerFilename` | text | the same, lower case |
| `lastChapter` | integer | chapter index, from 0. For an EPUB this is the spine item, so a cover or title page counts as a chapter |
| `lastSplitIndex` | integer | which part of a long chapter (Moon+ splits big chapters); usually 0 |
| `lastPosition` | integer | character offset of the start of the highlight within that chapter (or split) |
| `highlightLength` | integer | length of the highlight in characters; 0 for a bookmark |
| `highlightColor` | integer | Android colour: a signed 32-bit ARGB integer (`-256` is `0xFFFFFF00`, yellow) |
| `time` | integer | when it was made, **milliseconds** since 1970 (UTC) |
| `bookmark` | text | a bookmark's label (usually the start of the page); empty for highlights |
| `note` | text | the note typed against a highlight; empty for a plain highlight |
| `original` | text | the highlighted text. Line breaks are stored as `<BR>` |
| `underline` | 0/1 | drawn as an underline instead of a highlight |
| `strikethrough` | 0/1 | drawn struck through |
| `bak` | text | spare; a third style flag in the `.an` exports (probably the wavy underline) |

Evidence: the `.an` export fixtures in
[MrLokans/MoonReader_tools](https://github.com/MrLokans/MoonReader_tools) (real exports from
the app; the FB2/EPUB records list exactly these fields in this order, e.g. `2754`,
`LoremIpsum`, path, lower-case path, `0`, `0`, `0`, `11`, `1996532479`, `1508168642011`,
``, ``, `Lorem ipsum`, `0`, `0`, `1`), and the column names as Moon+ uses them in its
database. PDF notes use a different, page-based layout in `.an` files; whether they share
these columns in `mrbooks.db` is untested.

### How notes map to books

By file: `notes.filename` is the same path as `statistics.filename` and `books.filename`.
The import ties a note to the book whose files include the same file name (compared without
folders and case, as the rest of the import does), so `catalogue.json` titles, merging of
copies and `exclude` all apply to highlights too. Notes for a file that isn't a book in the
reading history (an excluded file, or one never opened long enough to be logged) are
dropped.

### Where in the book (%)

A note records a chapter and a character offset, but nothing in the backup gives the length
of each chapter or of the book, so it can't be turned into an exact %. The import estimates
it from the reading log instead: a note is placed within the progress made on the day it was
written (from the day before's progress, or 0 at the start of a read, to that day's), with a
day's notes spread evenly across that range in chapter/offset order. On a day with no logged
progress it takes the last known progress. Without a time, or a reading log, `progress` is
null. The estimate is good for books read front to back, and off for notes made while
skimming back or on a re-read.

`chapter` in `highlights.json` is `lastChapter + 1`, so it starts at 1 but still counts
front matter.

### Timestamps

`time` is in milliseconds (10-digit values, which some tools report from older exports, are
read as seconds). The import turns it into the server's local time (set `TZ`), which is also
what makes the time-of-day charts possible: highlights are the only time-of-day data in a
backup.

## What the import writes

`data/highlights.json`, kept apart from the other data files because it holds what you
wrote and highlighted:

```json
{ "id": 7, "book_id": "dune", "date": "2026-03-02", "time": "2026-03-02T21:30:00",
  "progress": 20, "chapter": 3, "text": "Fear is the mind-killer.", "note": null,
  "colour": "#ffff00", "kind": "highlight" }
```

`kind` is `note` when there's a typed note, `highlight` when there's highlighted text and
`bookmark` otherwise. `colour` drops the alpha and is null for bookmarks.

## Being defensive

Moon+ has changed its database over the years, so the import asks SQLite which columns the
`notes` table has and reads only those. With no `notes` table, or no `filename` column, it
imports no highlights and carries on; a missing column just leaves that field null.

## Not yet known

- Whether deleted highlights linger in the table (old `.an` exports marked them
  `*DELETED*`); none have been seen in `mrbooks.db`.
- How PDF highlights are stored in `mrbooks.db` (page numbers rather than chapters?).
- What `bak` holds in current versions.

If your backup disagrees with any of this, please open an issue with the output of
`sqlite3 mrbooks.db '.schema notes'` (no need to share the data itself).
