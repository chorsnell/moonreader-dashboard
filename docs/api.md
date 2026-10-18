# Stats API

The server works out the page's numbers (every `dash.calc` in `web/calcs.js` and
`web/features/*.js`) and serves them as JSON. The page loads them in one request instead of
working them out in the browser, and friends' installations and other tools can query them.

## Who can ask, and what they get

The same rules as the page's data files (`/data/*.json`):

- **Public dashboard:** anyone can ask. **Read password set:** only people signed in (the
  `mrd_session` cookie from `POST /api/login`), otherwise `401`.
- Every viewer gets numbers worked out **only from the data they may see**: the admin from
  everything; the public and read-password visitors from their copy of the data files,
  filtered by the owner's privacy settings (dates rounded to weeks or months, the diary,
  current reading, streaks, highlights hidden, private books left out or anonymised). The
  admin previewing as a visitor gets what that visitor gets. Nothing in a response can say
  more than the data files that viewer could fetch.
- Responses are `Cache-Control: private, no-cache` and `Vary: Cookie, X-Upload-Token`.

## Endpoints

All `GET`. Paths are relative to wherever the dashboard is served (`BASE_PATH`).

| Path | Returns |
| --- | --- |
| `/api/stats` | The index: `version`, `generated`, `calcs` (`[{id, title, description, inputs, server}]`), `page`, `client_only`, `lossy`, `failed` |
| `/api/stats/all` | Every calc the server worked out: `{version, generated, calcs: {<id>: rows}}` |
| `/api/stats/page` | The same, less what the page is better off working out itself (see below) |
| `/api/stats/<calc>` | One calc's rows, e.g. `/api/stats/kpis`, `/api/stats/per_year`, `/api/stats/authors`. `404` if unknown or left to the browser |
| `/api/stats/year/<YYYY>` | A year: `{year, generated, totals, review, finished}`: its `per_year` row, its `wrapped` (year in review) row and the reads finished in it. `404` if the year has no reading |
| `/api/author/<name>` | An author (matched ignoring case, URL-encoded): `{author, generated, totals, books, reads}`; totals has `books`, `finished`, `reads`, `hours`, `words`, `first_read`, `last_read`, `genres`. `404` if none |

The rows of each calc are what the page's own charts use; each calc's `title`,
`description` and `inputs` in the index say what it holds. Field names are `snake_case`;
dates are `YYYY-MM-DD` (or the first day of the week or month when the viewer's dates are
rounded). The calc ids and row shapes follow the page's code, so a newer installation may
add calcs or fields; check the index rather than assuming.

`/api/stats/all` and `/api/stats/page` send an `ETag` and answer `If-None-Match` with `304`,
and are gzipped for clients that accept it. Every response carries `X-Stats-Version`, which
changes whenever the numbers could (new data, new privacy settings, new page code). The
numbers are worked out once per version for each kind of viewer, in a background thread
(`STATS_WORKER=off` keeps it on the main thread), and kept until the version changes.

### Now: for Home Assistant and other devices

`GET /api/now` is a small summary for things that poll (Home Assistant's REST sensor, a
display): `{today, as_of, generated, reading, today_minutes, week_minutes, streak, year,
quote}`. The README's [Widgets and devices](../README.md#widgets-and-devices) section
describes each field. It's worked out by `src/outbound/` from the same per-viewer data as
the stats, so whatever the asker's audience hides is `null` (`reading` without "what
you're reading now", the minutes without day-by-day reading, `streak` without streaks or
exact days). `GET /api/now/cover` is the current book's cover, or `404`.

Besides the usual sign-in, these two accept the **device token** made in **Admin → Widgets &
devices** (`Authorization: Bearer …`, `X-Device-Token: …` or `?token=…`). It gets the
audience the admin chose for it (by default the admin's own view) and opens nothing else.
Both are `Cache-Control: private, no-store`.

The admin's settings: `GET /api/admin/outbound` (`{goal, device_token, device_token_created,
device_audience}`; the token itself is never returned), `PUT /api/admin/outbound/goal`
(`{goal: 1–1000 | null}`), `PUT /api/admin/outbound/audience` (`{audience: 'admin' |
'public' | 'reader' | 'friends'}`), `POST /api/admin/outbound/token` (a new token, returned
this once) and `DELETE /api/admin/outbound/token`.

### E-ink

`GET /eink.png` is the 800 × 480 one-bit PNG of the now summary, `GET /eink/cover.png` the
current cover dithered to 240 × 360 (or `404`), and `GET /api/trmnl` flat JSON for a TRMNL
private plugin set to polling (`title`, `author`, `progress`, `cover_url`, `image_url`,
`stats`, `streak`, `streak_at_risk`, `week_minutes`, `today_minutes`, `year`, `quote`,
`quote_source`). Access is as for `/api/now` (the device token or the usual sign-in). The
PNGs send an `ETag`, answer `304`, and are `Cache-Control: private, max-age=60`. The image
URLs in `/api/trmnl` carry the device token on as `?token=` when it was sent, and a `v=` that
changes with the picture.

### Badges

`GET /badge/reading.svg`, `/badge/year.svg` (`?style=card`) and `/badge/heatmap.svg`
(`?weeks=4–53`) are SVG images of what the **public** may see, whoever asks, with
`?theme=light|dark` and `?title=`. They're `404` while the dashboard has a read password
(and the heatmap when the public don't get day-by-day reading). `Cache-Control: public,
max-age=1800`, an `ETag`, and `304` when unchanged. The README's Badges section has embed
examples.

### Calcs the server leaves out

- `client_only`: calcs that read something besides their inputs (the viewer's filters or
  the page itself), calcs the page works out from other data it passes in (a friend's,
  inputs named `friend_*`, through `dash.calcWith`, e.g. `taste_match`), and any worked out
  from them.
- `lossy`: calcs whose values JSON can't carry as they are (for example an average of no
  days is `NaN`). They're in `/api/stats/all` and `/api/stats/<calc>` as JSON has them (`NaN`
  as `null`), but not in `/api/stats/page`: the page works them out itself.
- `failed`: calcs that threw, or whose inputs are missing.
- `/api/stats/page` also leaves out big lists that are quick to build (the diary, the
  heatmap's days): those are quicker to work out on a phone than to download.

## Example

```sh
curl -s https://reading.example.com/api/stats/kpis
# [{"metric":"finished_ytd","value":7},{"metric":"finished_prev_ytd","value":15}, …]

curl -s -c jar -H 'Content-Type: application/json' -d '{"password":"…"}' https://reading.example.com/api/login
curl -s -b jar https://reading.example.com/api/stats/year/2025
```

## Reading challenges

The challenges on the Overview (`challenge_progress` above gives their progress) are set by
the admin, and kept in `settings.json` under `challenges`. When that is missing, a default
set is used. Everyone reads the list as `/data/challenges.json`. It names no books, so it is
the same for every viewer; progress is worked out from each viewer's own filtered data.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/admin/challenges` | admin | `{challenges, custom, defaults}`; `custom` is false while the defaults are in use |
| `PUT /api/admin/challenges` | admin | `{challenges: [{id?, kind, title, target, period, from?, to?}]}`. `kind` is `countries`, `decades` (with `from` and `to`, years), `series`, `women` (target in %), `streak` (days) or `genres`; `period` is `year` (the latest reading's year) or `all`. Up to 20. `400` with an `error` when something can't be used |
| `POST /api/admin/challenges/reset` | admin | Back to the defaults |

## How it works

`src/stats/page-sandbox.ts` loads the page's scripts in Node, in the order `index.html` loads
them, with a stand-in for `dash` and an inert DOM, so there is one copy of every
calculation. `src/stats/stats.service.ts` works them out for each audience (admin, public, friends,
read password) from the data files as that audience is served them, keeps the results in
memory, and works them out again when the data, the privacy settings or the page's scripts
change; it warms the cache after every rebuild. The page (`web/runtime.js`) fetches
`api/stats/page` alongside the data files, takes those calcs as they are and works out the
rest itself; when the bundle is missing (a static copy without it, an older server, an
error, or `?stats=client` in the URL) it works out everything, as before. The static demo
writes `api/stats/page`, `api/stats/all` and `api/stats/<calc>` as files at build time.

`test/web/server-stats.spec.ts` checks that the server and the page's own `runtime.js` give
identical rows for every calc on the demo history and the fake backup, for the admin and for
filtered visitors; `test/stats.e2e-spec.ts` checks the API's privacy.

## Feeds

Atom and iCal feeds (BOO-74), made by the admin under **Admin → Feeds**. They're not part of
the stats API, but they follow the same rule: nothing in them says more than the data files
their audience could fetch.

| Path | Returns |
| --- | --- |
| `/feeds/<secret>.atom` | `application/atom+xml`: the 50 most recent finished reads, newest first. Each entry has the title and author, a link to `#book/<id>`, and HTML content with the cover, rating, series, genre, hours and days |
| `/feeds/<secret>.ics` | `text/calendar`: all-day events. These are `day-<date>` (reading days, last 400), `finish-<read id>` (finishes) and `club-<id>-start`, `-week-<n>` (book club schedule) |
| `/feeds/<secret>/covers/<book id>.(jpg\|png)` | A cover the Atom feed links to, through the same secret |

- **The secret** is 32 random bytes (base64url). A wrong one gets a `404` after a short pause, the same as no feed. Only its sha256 is stored (`library/feeds.json`, mode 0600), compared in constant time, like federation tokens.
- **The audience** is `public`, `reader` or `friends`. The feed is filtered by that audience's privacy policy from Access & privacy, as `/data/*` is for them, whatever the dashboard's access setting.
  - Private books are left out (also when anonymised).
  - Dates are rounded to the week or month.
  - Reading days need exact days, the diary and streaks.
  - Book clubs need the audience to see friends' reading (`visible_to`) and current reading; friends never get them.
- Responses are `Cache-Control: private, max-age=300` with `X-Robots-Tag: noindex`. The calendar asks to be refreshed every 6 hours.

Admin endpoints (`@AdminOnly`):

| Method and path | Does |
| --- | --- |
| `GET /api/admin/feeds` | `{feeds: [{id, kind, audience, name, created, rotated, last_used}]}`, without secrets |
| `POST /api/admin/feeds` | `{kind: "atom" \| "ical", audience?, name?}` → `{feed, url}`. The only time the URL is given |
| `POST /api/admin/feeds/<id>/rotate` | A new secret → `{feed, url}`; the old URL stops working |
| `DELETE /api/admin/feeds/<id>` | Revokes it |

The URL is built from `PUBLIC_URL`, else the request's host (as for link previews).
