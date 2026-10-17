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
changes whenever the numbers could (new data, new privacy settings, new page code).

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
