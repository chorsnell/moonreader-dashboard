# Friends: share files and the friends API

Friends appear in your dashboard as named profiles. Each friend's reading is kept in
`library/friends/<slug>/` as the same files the page reads for you (`books.json`,
`reads.json`, `daily.json`, optionally `highlights.json`), plus `profile.json`.

## Share files

A share file is one JSON document:

```json
{
  "format": "moonreader-dashboard/share",
  "version": 1,
  "profile": { "name": "Sam", "generated": "2026-10-10T21:00:00", "leaderboards": ["books", "hours"] },
  "privacy": { "hidden": ["money", "highlights"], "dates": "day" },
  "books": [{ "id": "emma", "title": "Emma", "author": "Jane Austen", "isbn13": "9780141439587", "...": "..." }],
  "reads": [{ "read_id": "emma#1", "book_id": "emma", "start": "2026-01-01", "end": "2026-01-09", "...": "..." }],
  "daily": [{ "date": "2026-01-01", "book_id": "emma", "minutes": 31, "words": 7400, "progress": 12.5 }]
}
```

- Rows have the same fields as `data/books.json`, `data/reads.json` and `data/daily.json`.
- Everything has been through the sender's **friends** privacy policy (`settings.json`
  `privacy.friends`): dates may be rounded to the week or month, `daily` may be empty, and
  private books are left out. `privacy.hidden` lists what the policy hides, so views can say
  why something is missing.
- `profile.leaderboards` lists the stats the sender opted into for friends' leaderboards
  (`books`, `hours`, `words`, `streak`, `speed`, `days`).
- On upload every row is checked again: only plain values (short strings, numbers,
  booleans, nulls) under snake_case keys are kept, rows missing their id fields are dropped,
  and each part has a row limit.

## Endpoints

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/admin/share` | admin | Your share file (download). |
| `GET /api/admin/friends` | admin | Your friends and the friends settings. |
| `PUT /api/admin/friends/settings` | admin | `{share_name, leaderboards, visible_to, accept_follows}`. |
| `PUT /api/admin/friends/upload?name=` | admin | A friend's share file as the body (`application/octet-stream`). The same name again replaces it. |
| `DELETE /api/admin/friends/:slug` | admin | Removes an uploaded friend. |
| `GET /data/friends.json` | see below | `{me: {name, leaderboards}, friends: [profile…]}`. |
| `GET /friends/:slug/:file.json` | see below | A friend's `books`, `reads`, `daily` or `highlights`. |

Who sees friends' data on your dashboard is `settings.json` `friends.visible_to`: `admin`
(the default), `reader` (also people with the read password) or `public` (everyone who can
read the dashboard). Anyone else gets an empty list from `data/friends.json` and a 404 for
the files.

The static demo ships the same URLs as plain files.
