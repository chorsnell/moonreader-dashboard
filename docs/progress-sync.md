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
