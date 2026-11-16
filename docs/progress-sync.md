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
