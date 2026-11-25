# Reading position sync: KOReader and Moon+ Reader

The dashboard is a KOReader progress sync server, so the place you got to in a book follows
you between devices.

## Set up

**Moon+:** sync reading positions over WebDAV (**Settings → Sync → WebDAV**) to
`<dashboard address>/dav/`, with any username and `UPLOAD_TOKEN` as the password, and let it
sync each book once.

**KOReader**, on each device, with a book open, under **Tools → Progress sync**:

| Setting | Choose |
| --- | --- |
| Custom sync server | the dashboard's address followed by `/kosync`, e.g. `https://example.duckdns.org/books/kosync` |
| Register / Login | **Login**, with any username and `UPLOAD_TOKEN` as the password |
| Document matching method | **Filename** |
| Send document metadata | on, if your KOReader has it |
| Automatically keep documents in sync | on (some devices first need Network → *Action when Wi-Fi is off* → *turn on*) |
| Sync behavior → Sync to a newer state | **Silently** |
| Sync behavior → Sync to an older state | **Prompt** (it starts as *Never*) |
| Device hostname | leave empty, or KOReader doesn't recognise its own positions |

KOReader calls these "newer" and "older", but the dashboard sends no time with a position, so
KOReader compares how far through the book you are: it jumps by itself when the other place is
further on, and asks when it would take you back.

**Filename** matching finds Moon+'s `<file name>.po` by itself, so the files need the same
name, capitals included, on both devices. **Binary** (KOReader's default) works too, but only
once the dashboard has learnt the file's name from the plugin or from the metadata.

For exact positions, also install the [KOReader plugin](../koreader/README.md) and turn on its
**Sync automatically**: it sends each book's page layout (below).

## How it works

`/kosync` speaks the API of [koreader-sync-server](https://github.com/koreader/koreader-sync-server):

| Request | What it does |
| --- | --- |
| `GET /kosync/healthcheck` | `{ "state": "OK" }` |
| `POST /kosync/users/create` | 201 with the admin password, 402 otherwise |
| `GET /kosync/users/auth` | 200 when `x-auth-key` is the MD5 of `UPLOAD_TOKEN` (any `x-auth-user`) |
| `PUT /kosync/syncs/progress` | saves `{ document, progress, percentage, device, device_id }`, and `metadata.filename` and `metadata.title` when sent; answers `{ document, timestamp }` |
| `GET /kosync/syncs/progress/<document>` | the newest position: `{ document, progress, percentage, device, device_id }` (no `timestamp`, see above), or `{}` |

`document` is KOReader's id for the book: the partial MD5 of the file (**Binary**) or the MD5
of the file name (**Filename**). Positions are kept in `library/progress-sync/koreader.json`.
A wrong password is answered after a second.

KOReader pushes when you close a book or the device sleeps, whether or not you moved. A push
of the same place as that device's last one is ignored, so opening a book and closing it again
doesn't beat what you've since read elsewhere.

## Moon+ Reader into KOReader

Moon+ keeps one `<book file>.po` per book, e.g. `1502878256645*28@0#15529:12.3%` (when it was
saved, the chapter from 0, Moon+'s split, characters into the chapter, the percentage).

When a KOReader device asks for a book's position, the dashboard also looks for that book's
`.po` file, and answers with whichever position reached the server last. Moon+'s own stamp
isn't used: it can be months stale. A Moon+ position shows on KOReader as coming from the
device "Moon+ Reader".

The `.po` file is found by, in order:

1. KOSync's file-name id: the MD5 of the `.po` file's book file name;
2. the device's file name (from KOReader's metadata, or the plugin): the same name ignoring
   case, or one of the same format that differs only in accents or punctuation
   (`Dune.kepub.epub` is `Dune.epub`);
3. the file names of the dashboard book the file is linked to, when only one of them has a
   `.po`;
4. for reading only, the title the plugin or KOReader reported: the whole of the `.po` file's
   name, or one side of a " - " in it (`Dune - Frank Herbert.epub`).

Without the plugin's page layout (below), a Moon+ position takes KOReader to the start of its
chapter: Moon+ counts characters, KOReader points at elements, and only the book itself can
turn one into the other. Moon+'s chapter is taken to be the EPUB's spine item (DocFragment)
of the same number, counted from 0; Moon+ sometimes splits a chapter at table-of-contents
entries, in which case it runs ahead.

## KOReader into Moon+ Reader

Each position a KOReader device sends is also written into the book's `.po` file in the
WebDAV folder (found as above, never by title alone), so Moon+ opens the book there the next
time it syncs. The file gets a new ETag and a later modification time. When Moon+ hasn't
synced the book yet, a new `.po` file is started in Moon+'s `.Moon+/Cache` folder (or next to
most of its other `.po` files), named after the device's file. Nothing is written for PDFs and
other paged documents, before Moon+ has synced any book, or over a file that isn't a position.

Moon+'s own place is left alone when KOReader is on the same page (it has only gone where
Moon+ was) and, without a page layout, whenever KOReader is in the same chapter. Without a
layout, the position written is the start of KOReader's chapter with KOReader's percentage.

The places the dashboard writes are remembered in `library/progress-sync/moonplus-written.json`,
so they aren't taken for Moon+'s own, by a KOReader device or by the dashboard's rebuild. The
rebuild does take the progress of a book in the Moon+ backup from them, but doesn't add a
second book for one that isn't.

## Exact positions: the plugin's page layout

The KOReader plugin measures where each page of the open book starts (its xpointer, how many
characters into its spine item that is, and page / pages) and sends it to
`POST /api/koreader/layout` (see [koreader/API.md](../koreader/API.md)). Layouts are kept in
`library/progress-sync/layouts/`, under the book's partial MD5 and the MD5 of its file name.

With a layout:

- **Moon+ → KOReader**: the page of Moon+'s chapter holding its character. If that page is
  more than 5% away from Moon+'s own percentage, Moon+ has split the book's chapters
  differently from the spine, and the page at Moon+'s percentage is used instead.
- **KOReader → Moon+**: KOReader syncs the top of the page. A measured page start, or a place
  in the same paragraph's text as one, gives an exact character count. Anything else (another
  font size) falls back to the start of the page at KOReader's percentage.

KOReader jumps to the page holding Moon+'s place, not to a highlighted line. Character counts
are KOReader's text and Moon+ counts its own, so a position can land a little early or late.

## Caveats

- Only EPUBs and other reflowable books; PDFs and comics aren't synced with Moon+.
- Moon+ reads the `.po` file when it syncs, and a KOReader device asks when a book is opened,
  so close the book on one before opening it on the other.
- KOReader queues pushes made offline and sends them later without saying when they were
  made, so one sent late counts as new.
- Writing to Moon+ assumes its chapters are the spine items. For a book Moon+ splits
  differently, Moon+ can open in the wrong chapter.
- Moon+'s split within a chapter is written as 0, and ignored when read.
