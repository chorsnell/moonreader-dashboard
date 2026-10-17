# Other media: sources, data model and plan

Status: decided (spike BOO-47, epic EP-8). This is the brief for BOO-48 (Plex), BOO-49 (Netflix),
BOO-50 (TV & film views), BOO-51 (cross-media) and BOO-52 (later verticals).

## The decisions in one screen

| Question                 | Decision                                                                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One app or several?      | **One app.** Each medium is a tab (later a media switcher) on the existing core: same server, sign-in, upload dialog, rebuild loop, cover store and feature scripts.                                                                                                    |
| Shape of the data        | **Five new files** that mirror `books.json` / `reads.json` / `daily.json`: `media_items.json`, `media_runs.json`, `media_daily.json`, plus `media_sessions.json` and `media_parts.json` for what books don't have (clock times, episodes). Book files stay as they are. |
| What is a "book" for TV? | **A season.** The show is the series and the season number is `series_no`, so series progress, abandoned books and binge views work unchanged. A film is one item; its franchise (TMDB collection) is the series.                                                       |
| First vertical           | **TV & film**, from **Netflix viewing activity CSV (upload)** and **Plex via Tautulli (URL + API key)**.                                                                                                                                                                |
| Next                     | Audiobooks (Audiobookshelf API, Audible via Amazon data request, Libby timeline), then music (Spotify extended history upload, Last.fm API), podcasts as a by-product of those, Steam games last.                                                                       |
| Trakt, Letterboxd        | Worth adding to TV & film after Netflix and Plex, as "watches without minutes" (runtime estimated from metadata). Not in the first cut.                                                                                                                                 |
| Import routes            | Files people can download themselves go through the **existing upload dialog**. Servers people run themselves (Tautulli, Plex, Audiobookshelf) or public APIs (Last.fm, Trakt, Steam) use an **admin-entered URL + API key**, never the owner's account password.       |
| Metadata                 | Optional **TMDB API key** (admin setting) for posters, genres, runtimes and show/film disambiguation. Everything must work without it (fail soft, like Open Library covers).                                                                                            |

## 1. What each source gives

"Grain" is the finest detail the source has: **sessions** (start time and length of each sitting),
**dated events** (a day or timestamp but no length), or **totals** (running counters only).
Only sessions give the dashboard what Moon+ gives for books (minutes per day). Marked _(unverified)_
where this survey relied on memory rather than a current document; check against a real export
before coding.

### Plex and Tautulli (TV, film, also music)

- **Tautulli** (the usual Plex stats add-on) is the best source. `GET {url}/api/v2?cmd=get_history`
  with header `X-Api-Key: <key>` (or `apikey=` query param on older versions). Paged with
  `start` / `length`; filter with `user_id`, `media_type`, `after=YYYY-MM-DD` (incremental pulls),
  `grouping=0` (one row per session rather than grouped plays).
- Row fields used: `row_id`, `started`, `stopped` (epoch seconds), `play_duration` (seconds; older
  versions call it `duration`), `paused_counter`, `percent_complete`, `watched_status`,
  `media_type` (`movie`, `episode`, `track`, `live`), `title`, `grandparent_title` (show),
  `parent_title` (season), `parent_media_index` (season no), `media_index` (episode no), `year`,
  `rating_key`, `parent_rating_key`, `grandparent_rating_key`, `guid`, `thumb`, `user`, `user_id`,
  `platform`, `player`.
- Genres and runtime: `cmd=get_metadata&rating_key=…` returns `genres[]`, `duration` (ms),
  `directors[]`, `writers[]`, `guids` (imdb/tmdb/tvdb on newer Plex agents), `thumb`,
  `grandparent_thumb`, `parent_thumb`. Cache per `rating_key`; one call per show/film, not per play.
- Posters: `cmd=pms_image_proxy&img=<thumb>&rating_key=…&width=300` returns the image through
  Tautulli, so the dashboard never needs a Plex token.
- Grain: **sessions**. History starts when Tautulli was installed.
- **Plex directly** (fallback for people without Tautulli): `GET {plex}/status/sessions/history/all`
  with `X-Plex-Token`. Gives `viewedAt`, `ratingKey`, `grandparentTitle`, `parentIndex`, `index`,
  `type`, `accountID` but **no time watched**: it's a "marked watched" log (dated events). Plex
  webhooks (`media.scrobble`, needs Plex Pass) are the same grain. Not for the first cut.

### Netflix viewing activity (TV, film)

- Route: Account > Security & privacy > **Download your personal information**. Arrives by email
  in a day or so as a zip; the file is `CONTENT_INTERACTION/ViewingActivity.csv`. The zip's
  `Cover sheet.pdf` documents the columns. No API exists; this is upload only.
- Columns (10): `Profile Name`, `Start Time` (UTC, `YYYY-MM-DD HH:MM:SS`), `Duration` (`HH:MM:SS`,
  time actually played), `Attributes` (e.g. `Autoplayed: user action: None;`), `Title`,
  `Supplemental Video Type` (empty for the programme itself; `TRAILER`, `HOOK`,
  `TEASER_TRAILER`, `RECAP` etc. for extras), `Device Type`, `Bookmark` (`HH:MM:SS` position
  reached), `Latest Bookmark` (`HH:MM:SS` or `Not latest view`), `Country` (e.g.
  `GB (United Kingdom)`). Column names _(unverified against a 2026 export; the count of 10
  matches published analyses)_.
- `Title` packs everything into one string: `Show: Season 2: Episode title`,
  `Show: Limited Series: Episode title`, `Show: Part 1: Chapter Three`, or just `Film title`
  (which may itself contain a colon).
- Grain: **sessions**, whole account history, every profile.
- Lighter alternative: the per-profile "Viewing activity" page's **Download all** gives
  `NetflixViewingHistory.csv` with only `Title,Date` (dated events, no minutes). Accept it, but say
  in the UI that the full export is better.

### Trakt (TV, film; aggregates many services via scrobblers)

- API needs only a free app `client_id` in the `trakt-api-key` header to read a **public**
  profile: `GET https://api.trakt.tv/users/{user}/history?start_at&end_at&page&limit`. Private
  profiles need OAuth (owner signs in on Trakt; avoid).
- Rows: `watched_at`, `action` (`scrobble`, `checkin`, `watch`), `type` (`movie`, `episode`),
  `movie{title,year,ids{trakt,slug,imdb,tmdb}}`, `show{…ids}`, `episode{season,number,title,ids}`;
  `extended=full` adds `runtime`, `genres`.
- Grain: **dated events** (no time watched; use runtime). Trakt reshaped its free tier in 2025;
  limits on history size or export for free accounts _(unverified)_.

### Letterboxd (film)

- Settings > Data > **Export your data** zip: `diary.csv` (`Date, Name, Year, Letterboxd URI,
Rating, Rewatch, Tags, Watched Date`), `watched.csv` (`Date, Name, Year, Letterboxd URI`),
  `ratings.csv`, `reviews.csv`, `watchlist.csv`.
- No-key live route: the public RSS feed `https://letterboxd.com/{user}/rss/` carries recent
  diary entries with `letterboxd:watchedDate`, `letterboxd:rewatch`, `letterboxd:memberRating`,
  `tmdb:movieId` _(unverified field names)_.
- Grain: **dated events** plus ratings. Best value is ratings (rating vs genre, like BOO-53).

### Audiobooks: Audiobookshelf, Audible, Libby

- **Audiobookshelf** (self-hosted, popular with this audience): API token from the user's settings.
  `GET {url}/api/me/listening-sessions?itemsPerPage&page` gives `startedAt`, `updatedAt`,
  `timeListening` (seconds), `startTime`/`currentTime` (position), `duration`,
  `displayTitle`, `displayAuthor`, `mediaMetadata{series, genres, narrators, isbn, asin}`,
  `libraryItemId`. Covers at `/api/items/{id}/cover`. Grain: **sessions**. Closest to Moon+ data.
  Also serves podcasts the same way.
- **Audible**: no API or listening export in the app. Amazon's **Request your data** (choose
  Audible) returns CSVs including a listening log with start/end times, duration and ASIN/title
  _(unverified file and column names; arrives after days)_. Unofficial libraries need the
  owner's Amazon login, so they're out.
- **Libby**: Shelf > Timeline > Actions > **Export timeline** (JSON/CSV): `timestamp`, `activity`
  (Borrowed, Returned, Placed hold…), `title`, `author`, `publisher`, `isbn`, `format`, `cover`,
  `library`. Grain: **dated events** (loan dates only; no minutes or progress).

### Music: Spotify, Last.fm

- **Spotify extended streaming history**: Account > Privacy > Download your data, tick
  "Extended streaming history" (up to 30 days). Files `Streaming_History_Audio_YYYY-YYYY_N.json`
  (and `…_Video_…`), each an array of `{ ts (UTC, when playback ended), platform, ms_played,
conn_country, master_metadata_track_name, master_metadata_album_artist_name,
master_metadata_album_album_name, spotify_track_uri, episode_name, episode_show_name,
spotify_episode_uri, reason_start, reason_end, shuffle, skipped, offline, incognito_mode }`.
  Newer exports add `audiobook_*` fields. Grain: **sessions** (one row per play), lifetime. No
  genres (Spotify puts genres on artists, behind its own API).
- **Last.fm**: free API key, public profile: `user.getrecenttracks&user=…&from=&limit=200&page=`
  gives `artist`, `album`, `name`, `date.uts`, `mbid`, `image`. Grain: **dated events** (a scrobble
  per track; length from `track.getInfo` or assume ~3.5 min). Tags via `artist.getTopTags` give
  genres. Good ongoing feed; Spotify JSON is better for backfill.

### Podcasts

- **OPML** (every app exports it) lists subscriptions only: no history. Useful only to label shows.
- History comes from: Spotify extended history (`episode_*` rows), Audiobookshelf sessions,
  AntennaPod's **database export** (SQLite with per-episode played duration and last played time
  _(unverified schema)_). Pocket Casts and Apple Podcasts have no history export.
- Conclusion: no podcast-specific importer; podcasts fall out of the Spotify and Audiobookshelf
  importers.

### Steam (games)

- Web API key (the owner creates one at steamcommunity.com/dev/apikey; it's a key, not their
  login) plus a SteamID64, profile "game details" public. `IPlayerService/GetOwnedGames` gives
  `appid`, `name`, `playtime_forever` (minutes, lifetime), `playtime_2weeks`, `rtime_last_played`,
  `img_icon_url`; `GetRecentlyPlayedGames` for the last two weeks.
- Grain: **totals only**. Daily time must come from taking a snapshot each day and diffing it, so
  history starts on the day it's set up. Achievement `unlocktime`s
  (`ISteamUserStats/GetPlayerAchievements`) give dated events for backfill. Weakest fit; last.

### Summary

| Source                | Media              | Route                      | Grain                   | Minutes?      | Genres     | Art  | First cut?       |
| --------------------- | ------------------ | -------------------------- | ----------------------- | ------------- | ---------- | ---- | ---------------- |
| Netflix CSV           | tv, film           | upload                     | sessions                | yes           | TMDB       | TMDB | **yes** (BOO-49) |
| Tautulli              | tv, film, music    | URL + key                  | sessions                | yes           | yes        | yes  | **yes** (BOO-48) |
| Plex direct           | tv, film           | URL + token                | dated                   | no            | yes        | yes  | later            |
| Trakt                 | tv, film           | client id (public profile) | dated                   | runtime       | yes        | TMDB | later            |
| Letterboxd            | film               | upload / RSS               | dated + rating          | runtime       | TMDB       | TMDB | later            |
| Audiobookshelf        | audiobook, podcast | URL + key                  | sessions                | yes           | yes        | yes  | next (BOO-52)    |
| Audible (Amazon data) | audiobook          | upload                     | sessions _(unverified)_ | yes           | no         | no   | next             |
| Libby timeline        | audiobook, book    | upload                     | dated                   | no            | no         | yes  | next             |
| Spotify extended      | music, podcast     | upload                     | sessions                | yes           | no         | no   | after            |
| Last.fm               | music              | key (public profile)       | dated                   | estimated     | tags       | yes  | after            |
| OPML                  | podcast            | upload                     | none                    | no            | no         | no   | no               |
| Steam                 | game               | key + SteamID              | totals                  | via snapshots | store tags | yes  | last             |

## 2. One app, media tabs on a shared core

Chosen: **one app**. Reasons:

- Everything a vertical needs already exists once: sessions and the read password, admin upload
  dialog, rebuild loop, activity log, cover store, `dash.file` / `dash.calc`, feature scripts, demo
  build, Docker image. Separate dashboards would duplicate all of it or force a library split first.
- BOO-51 (hours across media, TV weeks vs reading weeks, book-to-screen) needs both datasets on
  one page. With separate dashboards that's a third app.
- Self-hosters want one container and one URL.

How it looks:

1. **Now (BOO-50):** one new tab, **TV & film** (`rh.tab('tv', 'TV & film', { after: 'library' })`),
   added by `web/features/tv.js`, shown only when `media_items.json` has TV or film rows. New
   entity kinds `show` and `film` (pages `#show/<id>`, `#film/<id>`); a season opens as its item.
   Books stay the default view and the brand.
2. **When a second vertical lands:** a media switcher in the header (Books / TV & film / Listening …)
   that swaps the visible tab set; hash routes gain a prefix (`#tv/overview`). Build the switcher
   then, not now.
3. **Cross-media (BOO-51):** a "Everything" tab or Overview cards reading `daily` and `media_daily`.

Core changes this needs (do them in BOO-48/49, small and separate):

- `has_data` in `/api/config` (status controller) must be true when _either_ books or media data
  exist, so a Netflix-only install isn't shown "no data". Book files must load as optional then.
- Media build must not depend on a Moon+ backup and must not touch book files; it writes its own
  `media_meta.json` last (the book build writes `meta.json`).
- Links: add `show`, `film` (and later `artist`, `podcast`, `game`) to `LINKS` in `charts.js`;
  update `test/web/links.spec.ts`. Use `creator` as a link field (director/showrunner/narrator).

## 3. Data model

### 3.1 Concepts

| Concept           | Books today      | Media-neutral        | TV                             | Film                   | Audiobook                    | Music           | Podcast          | Game             |
| ----------------- | ---------------- | -------------------- | ------------------------------ | ---------------------- | ---------------------------- | --------------- | ---------------- | ---------------- |
| item (the "book") | book             | `media_items` row    | **season**                     | film                   | book                         | album           | show             | game             |
| part              | –                | `media_parts` row    | episode                        | –                      | chapter (optional)           | track           | episode          | –                |
| creator           | author           | `creator`            | showrunner / network fallback  | director               | author (narrator in `extra`) | album artist    | host / publisher | developer        |
| series            | series           | `series`             | show                           | collection (franchise) | series                       | –               | –                | franchise        |
| series_no         | series_no        | `series_no`          | season number                  | order in collection    | series no                    | –               | –                | –                |
| genre             | genre / subgenre | `genre` / `subgenre` | first TMDB/Plex genre / second | same                   | same                         | Last.fm top tag | category         | store tag        |
| read              | read             | `media_runs` row     | one watch-through of a season  | one viewing            | one listen-through           | –               | –                | one play-through |
| words             | words            | `units`              | episodes watched               | –                      | –                            | tracks played   | episodes         | achievements     |
| progress          | % of book        | `progress`           | % of season's episodes watched | % of runtime           | % position                   | –               | –                | null             |

Why season, not show: a season has a clear start, end and episode count, so "finished",
"dropped mid-season", "re-watch" and "binge speed" mean the same as for a book; a show is a
series of seasons, so the existing series-progress view becomes season completion for free. A
show's page aggregates its seasons the way a series page aggregates books.

Ids: lower-case slugs `[a-z0-9-]`, prefixed by medium so they never clash with book ids and are
safe as cover file names: `tv-severance-s1`, `film-the-matrix-1999`, `show-severance` (series id
used by the `show` link kind), `audiobook-…`, `music-…`, `game-…`. Prefer a stable external id in
the slug input when known (TMDB id) so renames don't move it: `tv-severance-s1` stays derived from
the show's display title, but merging uses `ext.tmdb_id` first.

Times and dates: sessions carry ISO UTC timestamps; all `date` fields are local calendar dates in
the server's `TZ` (Netflix and Tautulli are UTC/epoch; the book data is already local). A session
that crosses midnight is split into both days for `media_daily`.

### 3.2 Files

All written to `library/data/` by the media build; names match `^[a-z_]+\.json$`. Fields keep the
book files' names where the meaning is the same, so calcs can be reused (see 3.3). Snake_case.

**`media_items.json`** (the `books.json` of media)

```json
[
  {
    "id": "tv-severance-s1",
    "media": "tv",
    "title": "Severance: Season 1",
    "creator": "Dan Erickson",
    "series": "Severance",
    "series_id": "show-severance",
    "series_no": 1,
    "genre": "Drama",
    "subgenre": "Sci-Fi & Fantasy",
    "year": 2022,
    "status": "finished",
    "progress": 100,
    "hours": 7.6,
    "units": 9,
    "units_total": 9,
    "times": 1,
    "first": "2025-01-04",
    "last": "2025-01-12",
    "sources": ["netflix"],
    "ext": { "tmdb_id": 95396, "imdb_id": "tt11280740", "plex_rating_key": null }
  },
  {
    "id": "film-the-matrix-1999",
    "media": "film",
    "title": "The Matrix",
    "creator": "Lana Wachowski",
    "series": "The Matrix Collection",
    "series_id": "film-collection-the-matrix",
    "series_no": 1,
    "genre": "Action",
    "subgenre": "Science Fiction",
    "year": 1999,
    "status": "finished",
    "progress": 100,
    "hours": 2.3,
    "units": null,
    "units_total": null,
    "times": 2,
    "first": "2019-05-01",
    "last": "2025-03-02",
    "sources": ["plex"],
    "ext": { "tmdb_id": 603, "plex_rating_key": "1234" }
  }
]
```

`status` uses the book values so book calcs work unchanged: `finished` (progress ≥ 99),
`in_progress` (some progress), `not_started`, `unknown`. "Dropped mid-season" is derived in the
views the way stalled books are (in progress, no activity for a while), not stored. Unknown fields
are `null`, never missing.

**`media_runs.json`** (the `reads.json`)

```json
[
  {
    "run_id": "tv-severance-s1#1",
    "item_id": "tv-severance-s1",
    "media": "tv",
    "title": "Severance: Season 1",
    "creator": "Dan Erickson",
    "genre": "Drama",
    "subgenre": "Sci-Fi & Fantasy",
    "series": "Severance",
    "run_no": 1,
    "times": 1,
    "start": "2025-01-04",
    "end": "2025-01-12",
    "days": 5,
    "hours": 7.6,
    "units": 9,
    "progress": 100,
    "finished": true
  }
]
```

A new run starts after a gap of **180 days** (books use 365), or for TV when episode 1 is played
again after the season was finished.

**`media_daily.json`** (the `daily.json`)

```json
[
  {
    "date": "2025-01-04",
    "item_id": "tv-severance-s1",
    "media": "tv",
    "title": "Severance: Season 1",
    "creator": "Dan Erickson",
    "genre": "Drama",
    "minutes": 112,
    "units": 2,
    "progress": 22
  }
]
```

`units` = parts first completed that day (episodes); `progress` = item progress at the end of the
day. One row per item per day.

**`media_sessions.json`** (new: clock times, for hour-of-day heatmaps and binge detection)

```json
[
  {
    "start": "2025-01-04T20:05:00Z",
    "end": "2025-01-04T20:59:00Z",
    "date": "2025-01-04",
    "item_id": "tv-severance-s1",
    "part_id": "tv-severance-s1-e01",
    "media": "tv",
    "minutes": 54,
    "progress": 97,
    "estimated": false,
    "source": "netflix",
    "device": "Smart TV"
  }
]
```

`estimated: true` marks rows whose minutes come from runtime rather than measured play (Trakt,
Letterboxd, Plex direct, Last.fm); views may exclude those from speed-type numbers. `part_id` is
null for films. Sessions shorter than 2 minutes with progress under 10% are dropped as browsing
noise (Netflix autoplay previews).

**`media_parts.json`** (new: episodes and tracks)

```json
[
  {
    "id": "tv-severance-s1-e01",
    "item_id": "tv-severance-s1",
    "media": "tv",
    "no": 1,
    "title": "Good News About Hell",
    "runtime": 57,
    "plays": 1,
    "minutes": 54,
    "first": "2025-01-04",
    "last": "2025-01-04",
    "completed": true
  }
]
```

An episode is `completed` when its furthest position reached is ≥ 90% of runtime, or (no runtime
known) total minutes ≥ 75% of the median for that season's other episodes, or the source says so
(Tautulli `watched_status = 1`, any Trakt/Letterboxd/Plex-direct event). Season `units_total` is
the episode count from TMDB/Plex; without metadata it's the highest episode number seen, and
`progress` is then a lower bound (fine for first cut).

**`media_meta.json`** (written last)

```json
{
  "generated": "2025-03-04 07:00",
  "sources": {
    "netflix": { "file": "ViewingActivity.csv", "profiles": ["Chris"], "rows": 4210 },
    "tautulli": { "last_row_id": 88213, "pulled": "2025-03-04 06:59" }
  },
  "counts": { "items": 212, "sessions": 3980 }
}
```

### 3.3 Reusing the book views

The book calcs in `web/calcs.js` are pure functions over `books` / `reads` / `daily` that read
`title`, `author`, `series`, `genre`, `status`, `progress`, `hours`, `minutes`, `first_read` …. Plan:

1. Add to `runtime.js` a tiny `dash.reuse(newId, fromId, inputs)` that registers a new calc with
   another calc's `fn` and description but different inputs. No edits to existing calcs.
2. In `web/features/tv.js`, adapter calcs turn media rows into book-shaped rows:

   ```js
   const asBook = (m) => ({
     ...m,
     author: m.creator,
     first_read: m.first,
     last_read: m.last,
     times_read: m.times,
     words: m.units,
   });
   const asRead = (r) => ({
     ...r,
     read_id: r.run_id,
     book_id: r.item_id,
     author: r.creator,
     read_no: r.run_no,
     times_read: r.times,
     days_read: r.days,
     words: r.units,
   });
   const asDay = (d) => ({ ...d, book_id: d.item_id, author: d.creator, words: d.units });
   dash.calc('tv_books', {
     inputs: ['media_items'],
     fn: (rows) => rows.filter(isScreen).map(asBook),
   });
   // likewise tv_reads, tv_daily
   dash.reuse('tv_series', 'series', ['tv_books']); // season completion per show
   dash.reuse('tv_day_totals', 'day_totals', ['tv_daily']);
   ```

3. Draw with the same helpers; labels change ("seasons", "watched"), not the maths. Cover lookups
   use the item id, so `dash.cover('tv-severance-s1')` just works once the build stores posters.

Views that come almost free this way: KPIs, per year/month, genres and genre drift, series →
season completion, timeline, diary heatmap, weekday rhythm, current/recent/stalled (= dropped
mid-season), rereads (= rewatches), big reads (= longest seasons). New for TV (BOO-50): hour-of-day
heatmap and binge fingerprint per show (episodes per day, from `media_sessions` / `media_parts`),
cost per hour against subscriptions (setting `subscriptions: [{ service, monthly, currency, from,
to }]` in `settings.json`, shared with EP-7).

Cross-media (BOO-51): `dash.calc('all_daily', { inputs: ['daily', 'media_daily'] })` with books
tagged `media: 'book'`. Book-to-screen matching uses `ext.tmdb_id` ↔ book ISBN/title via a small
hand-editable map first, not automatic matching.

## 4. Server design for imports

```
src/media/
  media.module.ts
  media.types.ts           MediaEvent, MediaItem…, the file row types
  media-build.service.ts   events -> items/parts/runs/daily/sessions -> data/*.json (pure core in media-history.ts)
  media-history.ts         grouping, runs, completion, daily split (unit-tested, like reading-history.ts)
  sources/netflix.ts       parse ViewingActivity.csv / NetflixViewingHistory.csv -> MediaEvent[]
  sources/tautulli.ts      client (fetch, paging, after=) + row mapping
  metadata/tmdb.client.ts  search/tv, search/movie, tv/{id}/season/{n}, poster download; cached
library/media/
  inbox/netflix/*.csv      uploaded files, kept like backups (newest per profile wins)
  cache/tautulli.json      raw history rows pulled so far (rebuilds don't re-fetch)
  cache/tmdb.json          lookups and misses (like covers/.misses.json)
  catalogue.json           manual fixes: { "<source key>": { title, series, series_no, genre, exclude } }
```

Every source produces the same intermediate, so the builder never knows where a row came from:

```ts
interface MediaEvent {
  source:
    | 'netflix'
    | 'tautulli'
    | 'plex'
    | 'trakt'
    | 'letterboxd'
    | 'audiobookshelf'
    | 'spotify'
    | 'lastfm'
    | 'steam';
  source_key: string; // stable per item at the source, e.g. netflix title prefix, plex grandparent_rating_key
  media: 'tv' | 'film' | 'audiobook' | 'music' | 'podcast' | 'game';
  start: string; // ISO UTC
  seconds: number | null; // played time; null for dated events
  estimated: boolean;
  series_title?: string; // show / collection / album artist
  season?: number | null;
  episode?: number | null;
  title: string; // episode, film, album or game title
  year?: number | null;
  position_pct?: number | null;
  device?: string | null;
  ext?: { tmdb_id?: number; imdb_id?: string; tvdb_id?: number; plex_rating_key?: string };
}
```

Settings and routes:

- **Uploads** extend `PUT /upload`: accept `.csv` / `.json` / `.zip` with `?source=netflix` (later
  `spotify`, `letterboxd`, `libby`); sniff content (Netflix header starts `Profile Name,Start Time`
  or `Title,Date`), save under `library/media/inbox/<source>/`, then `library.changed()`. A Netflix
  zip may be uploaded as is: pull `ViewingActivity.csv` out of it.
- **API sources** are admin settings in `settings.json` (never returned to readers):
  `media: { tautulli: { url, api_key, user_id }, tmdb: { api_key }, netflix: { profiles: [] } }`,
  edited in a new "Other media" section of the Update data dialog with a **Test** button. Env vars
  (`TAUTULLI_URL`, `TAUTULLI_API_KEY`, `TMDB_API_KEY`) as defaults for Docker users.
- **Polling**: the rebuild loop runs the media build when an upload or catalogue edit lands, and
  pulls Tautulli every `MEDIA_POLL_MINUTES` (default 60) with `after=` the last pulled date,
  de-duplicating on `row_id`.
- **Profiles/users**: Netflix accounts are shared. On first import, list the `Profile Name`s found
  and import none until the admin ticks theirs (store in settings). Tautulli likewise filters to one
  `user_id`.
- **Covers**: posters go into the existing cover store keyed by item id (`tv-…`, `film-…`), from
  Tautulli `pms_image_proxy`, else TMDB `poster_path` via `image.tmdb.org/t/p/w342`. Same 1 s pause
  and miss cache as Open Library.
- **Demo**: extend `src/demo` with a seeded fake TV/film history (a few shows, partial seasons,
  films) written through the same build, so the public demo shows the TV tab.
- **Tests**: unit tests on `netflix.ts` parsing (title shapes below) and `media-history.ts`; e2e
  with a mocked Tautulli server and mocked TMDB, like the Open Library mocks.

## 5. Mapping tables

### Netflix `ViewingActivity.csv` → `MediaEvent`

| CSV column                                 | Event field                       | Notes                                                                                                    |
| ------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Profile Name`                             | (filter)                          | only the admin's chosen profiles                                                                         |
| `Start Time`                               | `start`                           | UTC; append `Z`                                                                                          |
| `Duration`                                 | `seconds`                         | `HH:MM:SS` → seconds; `estimated: false`                                                                 |
| `Supplemental Video Type`                  | (filter)                          | drop rows where non-empty (trailers, hooks, recaps)                                                      |
| `Title`                                    | `series_title`, `season`, `title` | see parsing below                                                                                        |
| `Bookmark`                                 | `position_pct`                    | `/ runtime` when runtime known, else null                                                                |
| `Device Type`                              | `device`                          |                                                                                                          |
| `Attributes`, `Latest Bookmark`, `Country` | –                                 | ignore in first cut                                                                                      |
| (derived)                                  | `media`                           | `tv` if a season token was found or the prefix has ≥ 3 distinct suffixes, else TMDB decides, else `film` |
| (derived)                                  | `source_key`                      | lower-cased show prefix for TV, full title for film                                                      |

Title parsing: split on `": "`. Find the first part matching `Season N`, `Series N`, `Part N`,
`Volume N`, `Chapter N`, `Book N`, `Collection N` or `Limited Series` (→ season 1). Everything before
it is the show, the rest (rejoined) is the episode title. Episode numbers aren't in the export:
number episodes by the TMDB season list when available (match on episode title), otherwise in order
of first watch. No season token: treat as TV if the same first part appears with three or more
different remainders (`Black Mirror: Bandersnatch` alone stays a film), else as a film whose title
is the whole string. `NetflixViewingHistory.csv` (`Title, Date`) maps the same way with
`seconds: null, estimated: true` and a start at local noon.

### Tautulli `get_history` → `MediaEvent`

| Tautulli field                                      | Event field                         | Notes                                                                                       |
| --------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `row_id`                                            | (dedupe)                            | keep max seen in `media_meta.json`                                                          |
| `media_type`                                        | `media`                             | `episode` → tv, `movie` → film, `track` → music (later), `live` → skip                      |
| `started`                                           | `start`                             | epoch seconds → ISO                                                                         |
| `play_duration` (or `duration`)                     | `seconds`                           | already excludes pauses; `estimated: false`                                                 |
| `grandparent_title` / `title`                       | `series_title` / `title`            | episode: show / episode title; movie: – / film title                                        |
| `parent_media_index`, `media_index`                 | `season`, `episode`                 |                                                                                             |
| `percent_complete`                                  | `position_pct`                      | `watched_status = 1` also marks the part completed                                          |
| `year`                                              | `year`                              |                                                                                             |
| `grandparent_rating_key` (tv) / `rating_key` (film) | `source_key`, `ext.plex_rating_key` | `get_metadata` on it for genres, directors, guids → `ext.tmdb_id`/`imdb_id`, episode counts |
| `player` / `platform`                               | `device`                            |                                                                                             |
| `user_id`                                           | (filter)                            | configured user only                                                                        |

### Plex direct `/status/sessions/history/all` (later)

| Field                                               | Event field                                  |
| --------------------------------------------------- | -------------------------------------------- |
| `viewedAt`                                          | `start`; `seconds: null`, `estimated: true`  |
| `type`                                              | `media` (`episode`/`movie`)                  |
| `grandparentTitle`, `parentIndex`, `index`, `title` | `series_title`, `season`, `episode`, `title` |
| `grandparentRatingKey` / `ratingKey`                | `source_key`                                 |
| `accountID`                                         | filter                                       |

### Trakt history (later)

| Field                                                             | Event field                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| `watched_at`                                                      | `start`; `seconds` = runtime × 60, `estimated: true` |
| `type`                                                            | `media`                                              |
| `show.title`, `episode.season`, `episode.number`, `episode.title` | `series_title`, `season`, `episode`, `title`         |
| `movie.title`, `movie.year`                                       | `title`, `year`                                      |
| `*.ids.tmdb`, `*.ids.imdb`                                        | `ext`                                                |

### Letterboxd `diary.csv` / `watched.csv` (later)

| Column                                     | Event field                                                |
| ------------------------------------------ | ---------------------------------------------------------- |
| `Watched Date` (diary) or `Date` (watched) | `start` (local noon); runtime from TMDB, `estimated: true` |
| `Name`, `Year`                             | `title`, `year`; `media: film`                             |
| `Letterboxd URI`                           | `source_key`                                               |
| `Rating`                                   | item `rating` (new optional field, also used by BOO-53)    |
| `Rewatch`                                  | starts a new run                                           |

### Audiobookshelf listening sessions (BOO-52)

| Field                                       | Event field                                                    |
| ------------------------------------------- | -------------------------------------------------------------- |
| `startedAt` (ms)                            | `start`                                                        |
| `timeListening`                             | `seconds`                                                      |
| `currentTime / duration`                    | `position_pct`                                                 |
| `mediaMetadata.series[0].name`, `.sequence` | `series_title`, `season` (→ `series_no`)                       |
| `displayTitle`, `displayAuthor`             | `title`, item `creator`                                        |
| `mediaMetadata.genres[0]`                   | genre                                                          |
| `mediaType` (`book` / `podcast`)            | `media` (`audiobook` / `podcast`)                              |
| `libraryItemId`                             | `source_key`; ISBN/ASIN into `ext` for matching to Moon+ books |

### Spotify extended history (BOO-52)

| Field                                                                                                 | Event field                                                          |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `ts` − `ms_played`                                                                                    | `start` (`ts` is when playback ended)                                |
| `ms_played`                                                                                           | `seconds`                                                            |
| `master_metadata_album_artist_name`, `master_metadata_album_album_name`, `master_metadata_track_name` | item creator, item title (album), part title (track); `media: music` |
| `episode_show_name`, `episode_name`                                                                   | item title, part title; `media: podcast`                             |
| `spotify_track_uri` / `spotify_episode_uri`                                                           | part `source_key`                                                    |
| `skipped`, `reason_end`                                                                               | part completed when `reason_end = trackdone`                         |
| `incognito_mode`                                                                                      | drop when true                                                       |

### Last.fm recent tracks (BOO-52)

| Field                                 | Event field                                                      |
| ------------------------------------- | ---------------------------------------------------------------- |
| `date.uts`                            | `start`; length from `track.getInfo` or 210 s, `estimated: true` |
| `artist.#text`, `album.#text`, `name` | creator, item, part                                              |
| `mbid`, `image`                       | `ext`, cover                                                     |

### Steam (BOO-52, last)

| Field                                | Event field                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| daily snapshot of `playtime_forever` | one event per game per day with `seconds` = increase × 60, `estimated: false` |
| `name`, `appid`                      | `title`, `source_key`; `media: game`                                          |
| `rtime_last_played`                  | sanity check for the snapshot day                                             |
| achievements `unlocktime`            | dated events (backfill), `seconds: null`                                      |

## 6. Build order

1. **BOO-49 Netflix import** first: no external service needed, test with a fixture CSV. Brings in
   `src/media` core, `media-history.ts`, the five data files, upload route, profile picker,
   `has_data` change, demo data. TMDB optional.
2. **BOO-48 Plex via Tautulli**: settings section with URL + key + Test, poller, `get_metadata`
   cache, posters through `pms_image_proxy`. Reuses everything from step 1.
3. **BOO-50 TV & film views**: `web/features/tv.js`, `dash.reuse`, adapter calcs, `show`/`film`
   link kinds, new heatmap and binge views.
4. **BOO-51 cross-media**: `all_daily`, hours by medium, TV vs reading weeks, combined year.
5. **BOO-52**: Audiobookshelf (API) and Audible/Libby (upload) → Spotify (upload) + Last.fm (API)
   → Steam. Trakt and Letterboxd slot in after step 3 if wanted. Each is one `sources/*.ts` plus a
   mapping test; the model doesn't change.

Not doing: scraping Netflix or Audible web pages, unofficial APIs that need the owner's
password, and OPML-only podcast "history".

## 7. Status and how to add a source

What shipped (EP-8), and where it differs from the plan above:

- **BOO-49 Netflix**: `src/media/` core, the five files plus `media_meta.json`, upload of the CSV
  or the export's zip, profile opt-in, optional TMDB. Differences: media settings live in
  `library/media/settings.json`, not `settings.json` (the access settings rewrite that file with
  only their own keys); a one-profile export imports without asking; the media catalogue also
  takes `episodes`, `runtime` and `book` as manual metadata.
- **BOO-48 Plex via Tautulli**: `get_history` (paged, then incremental with `after=`), cached
  `get_metadata` / `get_children_metadata`, posters through the image proxy. Plex-direct is not
  built: it has no time watched.
- **BOO-50 TV & film views**: `web/features/tv.js` (tab, `#show/` and `#film/` pages),
  `dash.reuse` in `runtime.js` (and in the server's page sandbox), `show` / `film` link kinds.
  Streaming subscriptions are a media setting served as `media_money.json`, which the privacy
  settings treat as money. No `creator` link kind yet.
- **BOO-51 Cross-media**: `web/features/watching-and-reading.js`: hours by medium, TV weeks vs
  reading weeks, book to screen (title match, or `book` in the media catalogue), a year-page
  card. The combined year in review is a year-page card rather than Wrapped slides.
- **BOO-52 Audiobooks**: Audiobookshelf listening sessions (books only), counted as listening in
  the cross-media views. Podcast sessions are skipped for now, and there is no audiobook tab yet.

Adding the next source (Spotify extended history, Last.fm, Trakt, Letterboxd, Libby, Steam)
takes the same four steps Audiobookshelf did:

1. **`src/media/sources/<source>.ts`**: turn the source's rows into `MediaEvent`s (mapping
   tables in section 5) and, if it knows more than titles, into `ItemMeta` keyed by
   `metaKey(event)` (`<media>:<source_key>`). Unit-test it with a few real-shaped rows.
2. **Getting the rows**: an upload goes through `PUT /upload?source=<source>` into
   `library/media/inbox/<source>/` (see `media-inbox.service.ts`); an API source gets a client
   that caches what it pulled in `library/media/cache/<source>.json`, written only when something
   changed (see `sources/tautulli.client.ts`, `sources/audiobookshelf.ts`). Pulls run from
   `MediaService` on the `MEDIA_POLL_MINUTES` timer.
3. **`MediaBuildService.build`**: read the inbox or cache, push the events, merge the metadata,
   and add the file to `inputsChanged()` so a change triggers a rebuild. Settings go in
   `MediaSettings` (env defaults in `app.config.ts`) and the admin's "Other media" section.
4. **Views**: new media land in `media_*.json` with their `media` value; `x_all_daily` takes them
   into the cross-media views (map the medium in `kindOf`). A dedicated tab is one more feature
   script, built like `tv.js` with adapter calcs and `dash.reuse`.

For music the model needs nothing new: an album is the item, a track the part, the album artist
the creator. Podcasts: the show is the item and an episode the part, exactly like a TV season
(generalise the `tv` grouping path in `media-history.ts` to any medium with parts). Games
(Steam) need a daily snapshot job before they produce events.
