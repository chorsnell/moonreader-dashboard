# Reading dashboard ⇄ KOReader plugin: API contract

All requests send the admin password as `X-Upload-Token: <UPLOAD_TOKEN>`. `{base}` is the
dashboard's address as the user types it (e.g. `https://example.duckdns.org/books`), with no
trailing slash. Every response is JSON; errors are `{ "error": "..." }` with a 4xx/5xx status.

## PUT {base}/api/koreader/stats

Body: the raw bytes of KOReader's `settings/statistics.sqlite3`. Optional query `device=<name>`.
`Content-Type: application/octet-stream`.

- 200 `{ "ok": true, "books": 12, "days": 340 }`
- 400 `{ "error": "That database isn't KOReader's statistics.sqlite3." }`

## POST {base}/api/koreader/books

What the device's book sidecars know. Upserted by `md5`, so a device can send only the books
that changed since its last sync.

```json
{
  "device": "Kobo Libra 2",
  "books": [
    {
      "md5": "partial md5 (DocSettings partial_md5_checksum / util.partialMD5)",
      "file": "Book Name.epub",
      "title": "Title from doc_props",
      "authors": "Author One\nAuthor Two",
      "series": "Series #3",
      "pages": 312,
      "percent": 0.42,
      "status": "reading",
      "modified": "2026-10-25 21:04:11",
      "annotations": [
        {
          "text": "highlighted text",
          "note": "my note or null",
          "datetime": "2026-10-20 22:01:00",
          "chapter": "Chapter 3",
          "pageno": 120,
          "drawer": "lighten",
          "color": "yellow"
        }
      ]
    }
  ]
}
```

- `percent` is 0..1 (KOReader's `percent_finished`) or null.
- `status` is KOReader's `summary.status`: `reading`, `complete`, `abandoned` or null.
- An annotation with `drawer: null` is a page bookmark.
- 200 `{ "ok": true, "books": 3 }`

## POST {base}/api/koreader/match

Asks what the dashboard knows about books on the device (Moon+, Kobo, Kindle, Goodreads…),
leaving out what came from KOReader itself, so nothing round-trips.

```json
{
  "files": [ { "md5": "…", "file": "Book Name.epub", "title": "…", "authors": "…" } ],
  "others": true
}
```

Response:

```json
{
  "books": [ { "md5": "…", "match": null } ],
  "others": [ ]
}
```

`match` (and each entry of `others`) is a Book:

```json
{
  "id": "dashboard-book-id",
  "title": "Title",
  "author": "Author One & Author Two",
  "status": "finished",
  "progress": 63.5,
  "genre": "Science Fiction",
  "subgenre": "Space Opera",
  "shelves": ["favourites"],
  "days": [ { "date": "2024-03-01", "minutes": 42.5, "progress": 18.2 } ],
  "highlights": [
    { "text": "…", "note": null, "chapter": 3, "time": "2024-03-01T21:10:00", "kind": "highlight" }
  ]
}
```

- `status`: `finished`, `in_progress`, `abandoned` or `unknown`. `progress` is 0..100 or null.
- `days` holds only days KOReader didn't record (Moon+ and other sources).
- `highlights` holds only highlights that didn't come from KOReader. `kind` is `highlight`,
  `note` or `bookmark`. There is no stable id: dedupe by normalised text.
- Matching order: md5 (a KOReader import of that file), then file name against the file names
  Moon+ knew, then title and author.
- `others` (only when `"others": true`) lists books with `days` that matched none of `files`:
  books read in Moon+ whose files aren't on this device.

## WebDAV

KOReader's own *Reading statistics → Synchronize* to a WebDAV folder on `{base}/dav/` also works:
a `statistics.sqlite3` written anywhere under `/dav/` is imported like PUT /api/koreader/stats.
GET returns an ETag and PUT honours `If-Match`, as KOReader's sync expects.

## Synthetic history rows (written by the plugin into KOReader's statistics)

- A book with no file on the device gets a `book` row with `md5 = "moonplus:<dashboard id>"`
  and the dashboard's title and author.
- Each Moon+ day becomes `page_stat_data` rows starting at local noon, each at most an hour,
  later ones an hour apart, with `total_pages = 100` and `page` from the day's progress.
- The dashboard needs no marker: imported days on dates the book already has are ignored.
