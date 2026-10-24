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

## Bibliography: books you haven't got

BOO-103. `/data/bibliography.json` lists the books by your authors, and in your series, that
aren't in your library. The build writes it from `library/bibliography.json`, which the
bibliography lookup fills in after the metadata lookup (see
[integrations.md](integrations.md#bibliography-lookup-boo-103)). One row per work:

```json
{ "work_id": "OL66518W", "title": "Mansfield Park", "author": "Jane Austen",
  "published_year": 1814, "editions": 900, "series": null, "series_no": null,
  "isbn13": "9780141439808", "why": ["author"], "on_pile": false }
```

- `author` is spelled as `books.json` spells it (for a co-written book, as the first author's
  own books spell them), so `rh.linkPage('author', row.author)` works.
- `why` is `["author"]` (an author with a finished book, or two or more books),
  `["series"]` (a series you've started a book of) or both. `series` is spelled as yours
  when it's one of your series; `series_no` comes from Wikidata and may be `null`.
- A book in `books.json` (read, being read or not started) is never a row. A book on the
  to-read pile (`to_read.json`) is, with `on_pile: true`. Matching is by work id, then
  ISBN, then title and author.
- `work_id`, `editions` and `isbn13` are `null` for a work only Wikidata knows.
- Sorted by author, then series (works in no series last), number and year.
- Visitors don't get rows by an author all of whose books are private, or in a series all
  of whose books are (private books, genres or subgenres). The admin gets every row.

BOO-104 works three calcs out from it, with `books` and `reads` (`/api/stats/<calc>`):

- `unread_by_author`: one row per author with rows in the file: `works` (most editions
  first, then oldest), and `books`, `finished`, `avg_rating` (when you rate books, else
  `null`) and `hours` for what you have of theirs.
- `series_gaps`: one row per series you've read or are reading a book of: `entries`, every
  known book in order (numbered first, then by year), each with a `state` of `read`,
  `reading`, `not_started`, `on_pile` or `unread`; and `next_up`, the first unread entry
  after the highest number you've read (or the first unread when the numbers don't say).
- `discover_picks`: the To read tab's "More from your authors and series": each part-read
  series' next book, then books by authors you've finished two or more of or rate 4+.

## Genre picks: popular in your genres

BOO-105. `/data/genre_picks.json` lists well-loved books in each of your genres that aren't
in your library. The build writes it from the `subjects` part of `library/bibliography.json`,
which the bibliography lookup fills in from Open Library's subjects (see
[integrations.md](integrations.md#genre-picks-lookup-boo-105)). One row per book per genre or
subgenre:

```json
{ "genre": "Fantasy", "subgenre": null, "work_id": "OL27482W", "title": "The Hobbit",
  "author": "J.R.R. Tolkien", "published_year": 1937, "editions": 600, "rank": 2,
  "on_pile": false }
```

- Every genre in `books.json` but Untagged gets rows, and so does every subgenre with three
  or more books (`subgenre` set, `genre` the genre most of its books are in). Non-fiction is
  skipped by default (too broad).
- `rank` is the book's place in Open Library's subject list (1 the most popular); rows come
  in that order, at most 25 a genre or subgenre. Books in `books.json` are left out (matched
  by work id, then title and author), as are study guides, box sets and collections. A book
  on the to-read pile is kept, with `on_pile: true`.
- `author` is the first author as Open Library writes them, which may not be how
  `books.json` spells them; the page links it only when it matches one of your authors.
- Visitors don't get rows for a private genre or subgenre, or for subgenres of a private
  genre. The admin gets every row.
- The calc `genre_picks_top` (the To read tab's "Popular in your genres") is the top 3 rows
  of each of your 3 most-read genres, by hours read in the last two years (else ever), each
  with `genre_hours`.

| Endpoint | Who | What |
|---|---|---|
| `GET /api/admin/discovery` | admin | `{genres: [{genre, subgenre, books, default_subject, subject, override, looked_up, works}]}`: each genre (and subgenre with 3+ books), the Open Library subject it maps to by default and the one in use (`null`: not looked up), the admin's `override` (`null`: none, `""`: skipped), and when its subject was looked up and how many works it has |
| `PUT /api/admin/discovery` | admin | `{subjects: {<genre or subgenre>: <slug> \| ""}}`: replaces the overrides (`""` skips a genre; a name left out or `null` uses its default). Slugs are lower-cased with anything else as `_`. Kept in `settings.json` under `discovery.subjects`. When they change, the data rebuilds and the lookup that follows fetches any new subject. `{ok, subjects, rebuilding}`; `400` for a body that isn't `{subjects: {…}}` |

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

## Notifications

Admin endpoints (`@AdminOnly`) behind **Admin → Notifications** (BOO-72). Channel URLs and tokens are never returned; a channel comes back as `{id, type, name, host, has_token}`.

| Method and path | Does |
| --- | --- |
| `GET /api/admin/notify` | `{channels, events: {<kind>: on}, kinds: [{kind, label, note}], streak_hour, streak_min}` |
| `PUT /api/admin/notify` | Any of `{events: {<kind>: bool}, streak_hour: 0–23, streak_min}` |
| `POST /api/admin/notify/channels` | `{type: "ntfy" \| "gotify" \| "discord" \| "webhook", url, token?, name?}` |
| `DELETE /api/admin/notify/channels/<id>` | Removes one |
| `POST /api/admin/notify/channels/<id>/test` | Sends a test message to that channel: `{ok}` or `{ok: false, error}` |
| `POST /api/admin/notify/check` | Looks for events now, as after a rebuild: `{sent: [{kind, title}]}` |

### Sending your own: `NotifierService`

Any server feature can tell the owner something (a morning highlight review, say) through the same channels. Import `NotifyModule` and inject `NotifierService` (`src/notify/notifier.service.ts`):

```ts
@Module({ imports: [NotifyModule], providers: [HighlightReviewService] })
export class HighlightReviewModule {}

@Injectable()
export class HighlightReviewService implements OnModuleInit {
  constructor(private readonly notifier: NotifierService) {}

  onModuleInit() {
    // a toggle for it in Admin → Notifications (on unless the admin turns it off)
    this.notifier.registerKind('highlight_review', 'Morning highlight review', 'A few of your highlights, every morning.');
  }

  async morning() {
    await this.notifier.send({
      kind: 'highlight_review',            // [a-z][a-z0-9_]*; switched off kinds aren't sent
      title: 'Three highlights from a year ago',
      message: '“It was a dark and stormy night.” Alpha, Ann Author\n…',
      url: 'https://reading.example.com/#highlights', // optional: what tapping it opens
      tags: ['books'],                     // optional: ntfy shows them as emoji
      priority: 'default',                 // optional: low, default or high
      data: { count: 3 },                  // optional: extra JSON for webhooks
    });
  }
}
```

- `send(event)` never throws. It resolves with `{enabled, sent, failed: [{channel, error}]}`, where `enabled` is false when the admin switched that kind off.
- Each send is recorded under **Sync & logs → Notifications**.
- `wants(kind)` says whether anything would be sent, to skip expensive work.
- `sendTo(channelId, event)` sends to one channel whatever the toggles say; it's what the **Send test** button uses.
- **Privacy**: messages go to the owner's own channels, but a Discord channel may be shared, so don't name private books (`PrivacyService.context(...)`'s `private` set). The built-in events never do.

### What each channel receives

- **ntfy**: `POST <server>/` with JSON `{topic, title, message, tags, priority (2/3/4), click}` and `Authorization: Bearer <token>` when set.
- **Gotify**: `POST <server>/message` with `X-Gotify-Key` and `{title, message, priority (2/5/8), extras.client::notification.click.url}`.
- **Discord**: `POST <webhook>` with `{username, embeds: [{title, description, url, timestamp}]}`.
- **Webhook**: `POST <url>` with `{event, title, message, url, tags, priority, data, time}` (time is local, `YYYY-MM-DDTHH:MM:SS`) and `Authorization: Bearer <token>` when set.

The built-in events and their `data` are:

- `book_finished`: `{book_id, read_id, title, author, end}`, or `{count}` for a digest.
- `new_record`: `{record, value, previous}`.
- `streak_at_risk`: `{streak, last_read}`.
- `year_goal`: `{year, goal, finished}`. The goal is the one under **Widgets & devices** (`PUT /api/admin/outbound/goal`).
- `friend_finished`: `{friend, book_id, title}`.

## Admin: highlight exports

Admin only (`X-Upload-Token` or the admin session); anyone else gets `403`. The admin's own
export, so private books are included.

| Method and path | Does |
| --- | --- |
| `GET /api/admin/highlights` | `{books, highlights, readwise: {token_set, pushed, last}}`; never the token |
| `GET /api/admin/highlights/export/markdown.zip` | A zip of `Highlights/<Title> - <Author>.md`, one per book: YAML front matter and the highlights in book order |
| `GET /api/admin/highlights/export/readwise.csv` | Readwise's CSV import columns: `Highlight,Title,Author,URL,Note,Location,Date` |
| `PUT /api/admin/highlights/readwise` | `{token}`: checked against Readwise's `/api/v2/auth/`, then kept in `settings.json`. `400` if Readwise turns it down |
| `DELETE /api/admin/highlights/readwise` | Forgets the token |
| `POST /api/admin/highlights/readwise/push` | `{all?: boolean}`: sends highlights not sent before (all of them with `all`) to Readwise's `/api/v2/highlights/` in batches of 100; returns `{sent, skipped, total}`. `429` when Readwise asks to slow down (what was sent is kept) |

## Daily highlight review

BOO-83. State in `library/highlight-review.json`; keys are 20 hex characters (a hash of the
book id and the highlight's text), so they survive rebuilds.

| Method and path | Who | Does |
| --- | --- | --- |
| `GET /api/review/today` | Anyone who may read | `{date, items: [{key, book_id, title, author, genre, text, note, date}], can_review}`. The admin also gets each item's `card` (`{interval, due, never?, reviews, last}`), `settings`, and counts (`highlights`, `reviewed`, `never`, `due`). Visitors get the day's pick filtered like `highlights.json`: empty when highlights are hidden from them, without private books |
| `POST /api/admin/review/<key>` | Admin | `{action: "keep" \| "less" \| "never" \| "reset"}`: `{card, next: {due, when} \| null}` |
| `GET /api/admin/review/settings` | Admin | `{per_day, notify, hour, notifier}` (`notifier`: a channel is set up and "Daily highlights" is on) |
| `PUT /api/admin/review/settings` | Admin | Any of `{per_day: 1–20, notify: bool, hour: 0–23}` |
| `GET /api/admin/review/anki.txt` | Admin | Tab-separated text for Anki's File → Import: passage, note and book, tags |

The morning send is a `NotifierService` event of kind `highlight_review`, sent once a day from
`hour` when `notify` is on; `data` has `{date, items}`.

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

## Weather (admin)

The home location for "Reading and the weather" (`library/weather.json`). Admin only. The
page reads the days as `/data/weather.json` (`[{date, t_max, t_min, precip_mm,
daylight_h}]`: °C, mm, hours), with no location in it. Visitors whose dates are rounded, or
who don't get the diary, get it empty.

| Method and path | Does |
| --- | --- |
| `GET /api/admin/weather` | `{enabled, location: {name, lat, lon} \| null, pulled, error, days, first, last}` |
| `PUT /api/admin/weather/location` | `{place}`: a town (Open-Meteo geocoding, first match) or `"lat, lon"`; `''` removes it. A new location clears the cached days and fetches its weather. `400` with `error` if the place isn't found. Returns `{added, error, …}` as GET |
| `POST /api/admin/weather/refresh` | Fetches the days not cached yet. A failure (offline) keeps the cache and is reported in `error` |

## Want-to-read list (admin)

The owner's own list of books to read (BOO-102), kept in `library/want_to_read.json` and
never written by an import: `{schema_version: 1, books: [{id, title, author, series,
series_no, isbn13, pages, published_year, work_id, genre, subgenre, note, added, from}],
hidden: [book_id…]}`. `id` is `mine:<slug of the title>` (`-2`, `-3`… when titles clash);
`from` is one of `search`, `goodreads`, `storygraph`, `moonplus`, `author`, `series`,
`genre`, `manual`. The build adds the books to `data/to_read.json` with the source `mine`,
merged with the same book from a shelf (ISBN, then title and author); such rows carry
`want_id`, `note`, `work_id` and `published_year`. `hidden` holds pile rows' `book_id`s
(`goodreads:123`, a Moon+ file's slug) to leave off the pile, unless the book is on the list
too. Visitors get the books with the usual privacy rules, but never `note`. Admin only;
anyone else gets `403`. Every change rebuilds.

| Method and path | Does |
| --- | --- |
| `GET /api/admin/want` | The file |
| `POST /api/admin/want` | Adds a book: `{title, author?, series?, series_no?, isbn13?, pages?, published_year?, work_id?, genre?, subgenre?, note?, added?, from?}`. The title is required (300 characters at most; a note 2000). `added` is today unless an earlier day is given (a book kept from a shelf keeps its day). `{ok, book}`; `400` for a bad field; `409` (with the existing `id`) when the list has the same book by ISBN or title and author |
| `PUT /api/admin/want/<id>` | Changes the fields sent (the same ones; not `id`, `added` or `from`). `404` if it isn't there; `409` if it would copy another entry |
| `DELETE /api/admin/want/<id>` | Removes it |
| `POST /api/admin/want/hide` | `{key}`: a pile row's `book_id` to leave off the pile (not a `mine:` one) |
| `DELETE /api/admin/want/hide/<key>` | Shows it again; `404` if it wasn't hidden |
| `GET /api/admin/want/search?q=` | Open Library search: `{results: [{title, author, published_year, work_id, isbn13, pages, cover_id}]}`, 10 at most. `400` for under 2 characters; `502` with `error` when Open Library can't be reached |

## Genre suggestions (admin)

Suggested genres for untagged books, and starter-catalogue genres their Open Library
subjects disagree with (BOO-99). Admin only. Suggestions use the genre and subgenre names
`catalogue.json` already has. A book's suggestion follows its series (when at least half
its tagged books agree), else its author (when two thirds of their tagged books share a
genre), else its subjects (kept in `library/.metadata-subjects.json` by the metadata
lookup). Rejected ones are kept in `library/genre-suggestions.json`, by book id, as
`{genre, subgenre}` pairs: the same pair isn't offered again.

| Method and path | Does |
| --- | --- |
| `GET /api/admin/catalogue/suggestions` | `{lookup, untagged, untagged_without, review}`. `untagged` and `review` are `[{id, title, author, series, genre, subgenre, suggestion, from_subjects, subjects}]`: `genre`/`subgenre` are the book's now; `suggestion` is `{genre, subgenre, basis: "series" \| "author" \| "subjects", confidence: "high" \| "medium" \| "low", subjects, like}` (`subjects`: the ones that led to it; `like`: up to three tagged books it follows); `from_subjects` is what the subjects alone say when that differs; `subjects` is every subject the book has (`null` before the lookup). `untagged_without` counts untagged books with no suggestion. `review` holds tagged books whose subjects point, with medium or high confidence, at another genre |
| `POST /api/admin/catalogue/suggestions/accept` | `{items: [{id, genre, subgenre}]}` (up to 1000; the genre and subgenre may be changed from the suggestion): saves them to the books' `catalogue.json` entries in one write and rebuilds. `{ok, saved}`; `400` if none of the books exist |
| `POST /api/admin/catalogue/suggestions/reject` | `{items: [{id, genre, subgenre}]}`: remembers them as turned down. For `review` rows this is "keep mine" |
