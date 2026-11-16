# Reading position sync: KOReader and Moon+ Reader

The dashboard is a KOReader progress sync server, so the place you got to in a book follows
you between devices.

## Set up KOReader

On each KOReader device, with a book open:

1. **Tools → Progress sync → Custom sync server**: your dashboard's address followed by
   `/kosync`, e.g. `https://example.duckdns.org/books/kosync`.
2. **Register / Login**: any username, and your `UPLOAD_TOKEN` as the password. Choose
   **Login** ("Register" works too, but only with that password: there is one account).
3. Turn on **Auto sync** if you like. KOReader then sends your position when you turn pages,
   close the book or put the device to sleep, and asks for the newest one when you open a book.

## How it works

`/kosync` speaks the API of [koreader-sync-server](https://github.com/koreader/koreader-sync-server):

| Request | What it does |
| --- | --- |
| `GET /kosync/healthcheck` | `{ "state": "OK" }` |
| `POST /kosync/users/create` | 201 with the admin password, 402 otherwise |
| `GET /kosync/users/auth` | 200 when `x-auth-key` is the MD5 of `UPLOAD_TOKEN` (any `x-auth-user`) |
| `PUT /kosync/syncs/progress` | saves `{ document, progress, percentage, device, device_id }` |
| `GET /kosync/syncs/progress/<document>` | the newest position for that document, or `{}` |

`document` is KOReader's id for the book: the partial MD5 of the file (the default) or the
MD5 of the file name. Positions are kept in `library/progress-sync/koreader.json`.

For exact positions with Moon+, also install the [KOReader plugin](../koreader/README.md) and
turn on its **Sync automatically**: it sends each book's page layout (below).

## Moon+ Reader into KOReader

Moon+ already syncs its positions to the dashboard (**Settings → Sync → WebDAV**, pointed at
`<dashboard address>/dav/`): one `<book file>.po` per book, e.g. `1502878256645*28@0#15529:12.3%`
(when it was saved, the chapter from 0, Moon+'s split, characters into the chapter, the percentage).

When a KOReader device asks for a book's position, the dashboard also looks for that book's
`.po` file, and answers with whichever position reached the server last. A Moon+ position shows
on KOReader as coming from the device "Moon+ Reader".

The `.po` file is found by, in order:

1. KOSync's file-name id: the MD5 of the `.po` file's book file name (choose **Document
   matching method → Filename** in KOReader's progress sync to rely on this alone);
2. the file name the [KOReader plugin](../koreader/README.md) reported for that document,
   ignoring case, accents, punctuation and extensions (`Dune.kepub.epub` is `Dune.epub`);
3. the title the plugin reported, against the `.po` file's name (`Dune - Frank Herbert.epub`).

Without the plugin's page layout (below), a Moon+ position takes KOReader to the start of its
chapter: Moon+ counts characters, KOReader points at elements, and only the book itself can
turn one into the other. Moon+'s chapter is taken to be the EPUB's spine item (DocFragment)
of the same number, counted from 0; Moon+ sometimes splits a chapter at table-of-contents
entries, in which case it runs ahead. KOReader shows the percentage on its prompt, so a jump
that looks wrong can be refused.

## KOReader into Moon+ Reader

Each position a KOReader device sends is also written into the book's `.po` file in the
WebDAV folder, so Moon+ opens the book there the next time it syncs. When Moon+ hasn't synced
the book yet, a new `.po` file is started next to Moon+'s others, named after the file the
KOReader plugin reported (so Moon+ finds it only when its copy has the same file name).
Nothing is written for PDFs and other paged documents, or before Moon+ has synced any book.

Without the plugin's page layout, the position written is the start of KOReader's chapter
with KOReader's percentage. The positions the dashboard writes are remembered in
`library/progress-sync/moonplus-written.json`, so they aren't taken for Moon+'s own when a
KOReader device asks next.

## Exact positions: the plugin's page layout

Moon+ counts characters from the start of a chapter; KOReader points at elements. Only the
book can turn one into the other, and the book is on the device, so the KOReader plugin
measures it: when a book is opened it sends where each page starts (its xpointer, how many
characters into its spine item that is, and page / pages), to `POST /api/koreader/layout`
(see [koreader/API.md](../koreader/API.md)). Layouts are kept in
`library/progress-sync/layouts/`, under the book's partial MD5 and the MD5 of its file name.

With a layout:

- **Moon+ → KOReader**: the page of Moon+'s chapter holding its character. If that page is
  more than 5% away from Moon+'s own percentage, Moon+ has split the book's chapters
  differently from the spine, and the page at Moon+'s percentage is used instead.
- **KOReader → Moon+**: KOReader syncs the top of the page, which is in the layout, so the
  character count is exact. A position from another font size falls back to the page of that
  spine item at KOReader's percentage.

Character counts are KOReader's text, Moon+ counts its own, so a position can land up to a
page early or late.

## Caveats

- Only EPUBs and other reflowable books; PDFs and comics aren't synced with Moon+.
- Moon+ reads the `.po` file when it syncs (opening a book, or **Sync now**), and a KOReader
  device asks when a book is opened, so close the book on one before opening it on the other.
- The chapter-to-spine mapping is checked against the percentage only when there is a layout.
  Without one, a book Moon+ splits differently can open in the wrong chapter on KOReader;
  KOReader's prompt shows the percentage, so you can refuse it.
