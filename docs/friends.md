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

## Federation: following a friend's dashboard

When a friend runs their own installation, you can follow it instead of passing share
files around. Their dashboard (the *host*) approves you and chooses what you get; yours (the
*follower*) pulls their share file with a token and keeps it in `library/friends/<slug>/`
like an uploaded one, so every friends view works the same.

1. **Ask.** Your server sends `POST {host}/api/federation/follow` with
   `{"name": "Sam", "url": "https://your-dashboard", "claim": "<random secret>"}`. The host
   keeps the request as *pending* with a hash of the claim and answers
   `202 {"id": "<request id>", "status": "pending"}`. It answers `404` when it has no admin
   (`UPLOAD_TOKEN` unset), `403` when its admin turned follow requests off, `429` when 50
   requests are already waiting.
2. **Approve.** The host's admin approves in **Admin → Friends → Dashboards that follow
   you**, choosing **everything** (what the friends policy allows), **stats only** (books
   and reads, no day-by-day reading) or **specific views** (what you read, your days,
   leaderboards, highlights), and any books to hide from this follower. Approving issues a
   bearer token; the host keeps only its sha256 hash, and the token itself just until it's
   collected.
3. **Collect.** Your server polls `POST {host}/api/federation/follow/{id}/status` with
   `{"claim": "…"}` and gets `{"status": "pending" | "approved" | "rejected" | "revoked",
   "name": "<their share name>"}`, plus `"token"` the first time after approval. A wrong
   claim gets `404`.
4. **Pull.** `GET {host}/api/federation/share` with `Authorization: Bearer <token>` returns
   the share file above, filtered by the host's friends policy, then by this follower's
   scope and hidden books (`privacy.hidden` says what's missing). `401` once access is
   revoked (or for any other token).
5. Your server refreshes every `FEDERATION_REFRESH_MINUTES` (default 60) and when you press
   **Refresh now**.

**Revoking** deletes the token's hash on the host, so the very next pull fails; your server
then marks the friend *revoked* and deletes their data. **Offline:** when the host doesn't
answer (or answers with an error), your server keeps what it had and marks the friend
*offline*; the Friends tab shows their reading "as of" the last refresh. **Unfollowing**
forgets the token and their data.

`library/federation.json` holds both sides (the tokens you use, hashes of the ones you
issued) and is written readable by the owner only; it's never served.

Decisions:
- **Bearer tokens, not signatures.** Each follower gets its own random token over HTTPS,
  stored hashed by the host and revocable on the spot. Requests needn't be signed: there's
  one caller per token and nothing is pushed.
- **Not ActivityPub.** ActivityPub is made for public, push-based social feeds: actors,
  inboxes, HTTP-signed deliveries to many servers. This is private, per-follower filtered
  data pulled between two installations. ActivityPub would bring actor discovery, key
  management and signing, and still not give per-follower privacy, so it's out of scope.
- **HTTPS assumed.** Plain `http://` addresses are accepted for home networks and tests;
  over the internet, put the dashboard behind HTTPS (see the README's reverse proxy section).
- The host's stats API (`docs/api.md`) is for the host's own visitors; friends get the share
  file, which carries the rows the friends views need. Server-side stats could later sit
  behind `/api/federation/share` without changing it.

## Book clubs

A club lives on the dashboard that started it (the *host*), in `library/clubs.json`: the
book, the members, a start date, an optional schedule (% of the book a week) and comments
pinned to a position (0–100%). Members are the host's owner and any of the host's friends
(their shared reading draws their progress lane); a friend whose dashboard also follows the
host's can read the club and comment from their own dashboard.

Comments are **spoiler-safe on the server**: in every response a comment pinned past the
reader's position keeps only its position and author (`"text": null, "hidden": true`).

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/clubs` | whoever may see friends | The clubs, at the owner's progress in each book |
| `POST /api/admin/clubs` | admin | `{book: {title, author, isbn13, work_id, book_id}, start, pct_per_week, members: [{friend, follower, name}]}` |
| `DELETE /api/admin/clubs/:id` | admin | Ends a club |
| `POST /api/admin/clubs/:id/comments` | admin | `{position, text}` |
| `GET /api/federation/clubs?progress={"<id>": pct}` | a member's dashboard (Bearer) | The clubs it's in, hidden past the progress it reports (its own spoiler protection, so its word is enough); members are marked `host` and `you` |
| `POST /api/federation/clubs/:id/comments` | a member's dashboard (Bearer) | `{position, text}` |
| `POST /api/admin/federation/following/:slug/clubs/:id/comments` | admin | Your comment in a club a friend hosts, sent on to their dashboard |

A member's dashboard fetches the clubs with every refresh of that friend (first to learn the
books, then with its owner's progress in each) and keeps them in `friends/<slug>/clubs.json`.
