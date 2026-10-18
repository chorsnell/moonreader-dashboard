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

## Life events (admin)

Holidays, trips and life events (`library/life_events.json`). Admin only (`UPLOAD_TOKEN` as
`X-Upload-Token`, or the admin cookie); JSON bodies; errors are `{error}` with `400`, `403`
or `404`. The page reads the events as `/data/life_events.json` (`[{id, title, kind, start,
end, source}]`, `kind` one of `holiday`, `trip`, `job`, `baby`, `move`, `other`; `end`
inclusive), which visitors get empty unless their policy has `life_events: true`.

| Method and path | Does |
| --- | --- |
| `GET /api/admin/life-events` | `{events, kinds, calendar: {set, host, pulled, error, events}}`. The calendar's full address is never returned, only its host |
| `POST /api/admin/life-events` | Adds an event: `{title, kind, start, end?}` (dates `YYYY-MM-DD`; `end` defaults to `start`) |
| `PUT /api/admin/life-events/<id>` | Changes one, same body |
| `DELETE /api/admin/life-events/<id>` | Removes one |
| `PUT /api/admin/life-events/calendar` | Sets the iCal address (`{url}`: `https://`, `http://` or `webcal://`; `''` removes it and its events) and reads it: `{read, error, …}` as GET |
| `POST /api/admin/life-events/calendar/refresh` | Reads the calendar again now. A failure keeps the last good events and is reported in `error` |
