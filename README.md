# moonreader-dashboard

[![test](https://github.com/chorsnell/moonreader-dashboard/actions/workflows/test.yml/badge.svg)](https://github.com/chorsnell/moonreader-dashboard/actions/workflows/test.yml)
[![demo](https://github.com/chorsnell/moonreader-dashboard/actions/workflows/pages.yml/badge.svg)](https://chorsnell.github.io/moonreader-dashboard/)

A self-hosted dashboard for your [Moon+ Reader](https://www.moondownload.com/) reading history.

**[Try the live demo →](https://chorsnell.github.io/moonreader-dashboard/)** It runs on a made-up reading history of public-domain classics, rebuilt every week.

<a href="https://chorsnell.github.io/moonreader-dashboard/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.png"><img src="docs/screenshots/overview.png" alt="The Overview tab"></picture></a>

It reads the statistics Moon+ keeps inside its backups (every book, every day you read, minutes, words and progress, plus your highlights, notes and bookmarks). It keeps that history even for books whose files are long gone, and turns it into:

- **Overview:** this year against last year, streaks, minutes per day, what's on the go (shown large, with time left at your current pace, when it's a single book), recently finished, a quote of the day from your highlights, books per year and hours per month.
- **Genres & authors:** genre and subgenre mix, how it shifts over the years, top authors and series progress.
- **Speed:** your words-per-minute over time, with the books you were reading laid over it (any date range), plus your words-per-minute for every book, showing your page turners and your slow reads, plus speed by genre, subgenre and author against your average, and by year.
- **Timeline & habits:** a day-by-day heatmap and a "what you read when" timeline, each with its own date range (presets or custom dates), plus weekday rhythm, biggest reads and books left unfinished. Each timeline bar is faint from first to last day and solid on the days you actually opened the book.
- **Diary:** a day-by-day log for any period showing which books you read, minutes, words, and progress from one day to the next, with started and finished markers, under a day-by-day strip of minutes read, stacked by book and coloured by genre (click a day to jump to it). Click any heatmap square to jump to that day.
- **Library:** every book and every re-read, searchable and sortable.
- **Data checks:** things in the log that look odd. These include a book opened once and then left for weeks (which stretches its dates), reads spread thinly over months, long pauses, days with three or more books, implausible speeds, very long sessions, progress jumps, and untagged books. Click a date to open that day in the diary.
- **Book pages:** click any book, anywhere (lists, tables, the diary, chart bars and dots), for everything about it: times read, when each read started and finished, how long it took, time spent, words, speed against your average, its longest day, a day-by-day chart of minutes and progress for each read, the rest of its series (or more by the author), your highlights and notes in the order they come in the book, and every day you opened it. Each book has its own link (`#book/<id>`).
- **Author, series, genre and year pages:** click an author, series, genre, subgenre or year wherever it's shown (bylines, tables, chart bars and legends, the diary, a book page) for its own page of stats, charts and books, with links between them. Each has its own link too (`#author/<name>`, `#series/<name>`, `#genre/<name>`, `#subgenre/<name>`, `#year/<year>`).

Every book shows its cover, taken from the backup or looked up on Open Library (see [Book covers](#book-covers)).

It's one small container: a [NestJS](https://nestjs.com) app on Node.js 24, reading the backup's SQLite database with Node's built-in `node:sqlite`.

## Screenshots

<table>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#genres"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/genres-dark.png"><img src="docs/screenshots/genres.png" alt="Genres & authors"></picture></a><br><b>Genres &amp; authors</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#speed"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/speed-dark.png"><img src="docs/screenshots/speed.png" alt="Speed"></picture></a><br><b>Speed</b></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#timeline"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/timeline-dark.png"><img src="docs/screenshots/timeline.png" alt="Timeline & habits"></picture></a><br><b>Timeline &amp; habits</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#diary"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/diary-dark.png"><img src="docs/screenshots/diary.png" alt="Diary"></picture></a><br><b>Diary</b></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#library"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/library-dark.png"><img src="docs/screenshots/library.png" alt="Library"></picture></a><br><b>Library</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#checks"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/checks-dark.png"><img src="docs/screenshots/checks.png" alt="Data checks"></picture></a><br><b>Data checks</b></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><a href="https://chorsnell.github.io/moonreader-dashboard/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark.png"><img src="docs/screenshots/mobile.png" alt="On a phone" width="240"></picture></a><br><b>On a phone</b></td>
  </tr>
</table>

All screenshots are from the [demo](https://chorsnell.github.io/moonreader-dashboard/), not anyone's real reading.

## Run it

```sh
git clone https://github.com/chorsnell/moonreader-dashboard.git
cd moonreader-dashboard
cp .env.example .env
# set UPLOAD_TOKEN in .env first (openssl rand -hex 16)
docker compose up -d --build
```

Open `http://SERVER_IP:8080/`, click **Admin**, sign in with your `UPLOAD_TOKEN`, then click **Update data** and upload a Moon+ backup. To make one in Moon+, go to **Options → Backup & Restore → Backup**; it produces a `.mrpro` file. The dashboard builds itself in a few seconds.

To update to a newer version later:

```sh
git pull && docker compose up -d --build
```

Everything the container keeps lives in `./library/`, which is ignored by git:

```
library/
  settings.json    who can see the dashboard (the read password is stored hashed)
  inbox/           backups (.mrpro); the newest is used, the 5 newest are kept
  data/            the generated data the page reads
  dav/             what Moon+ syncs over WebDAV
  covers/          book covers, one <book id>.jpg or .png each
  catalogue.json   titles, authors, series and genres for your books
  update.log       what happened on each rebuild, upload and sync
```

## Getting new data in

There are four ways, and all of them trigger a rebuild automatically:

1. **The Update data button** on the dashboard. It's only shown to the admin: click **Admin** in the corner and sign in with your `UPLOAD_TOKEN`.
2. **WebDAV from Moon+** (below). This keeps progress current without making backups.
3. **Drop a backup into `library/inbox/`**, by hand, with `scp`, or with Syncthing.
4. **Edit `library/catalogue.json`.** Saving it rebuilds the data with your changes.

## Who can see it

`UPLOAD_TOKEN` is the admin password. Only the admin can upload, sync, or change settings. Visitors see a small **Admin** link and nothing else they can use.

To choose who can *read* the dashboard, sign in as the admin, open **Update data**, and use **Who can see this dashboard**:

- **Anyone with the link** (the default).
- **Only people with the read password.** Visitors get a password box instead of your stats, and the data, covers and API all refuse them until they enter it. Give the password to your friends; their browser remembers it for a year.

Setting a new read password signs out everyone who used the old one. Changing `UPLOAD_TOKEN` signs out the admin.

## Sync straight from Moon+ (WebDAV)

When `UPLOAD_TOKEN` is set, the server is also a WebDAV server at `https://your-domain/reading/dav/`. The **Update data** dialog shows the exact address. Log in with any username, and use your `UPLOAD_TOKEN` as the password.

**Reading positions.** Moon+ can sync reading positions over WebDAV. Open a book, then go to **Miscellaneous → Sync reading positions via Dropbox/WebDAV**, choose WebDAV and enter the address and login above. Moon+ then uploads your position whenever you pause reading. The dashboard picks up those position files, so progress, "On the go" and finished status stay current between backups. Minutes and words per day still only come from backups, because that's the only place Moon+ records them.

**Backups.** If your version of Moon+ offers WebDAV as a backup destination, use the same details. Any `.mrpro` file written to the WebDAV folder is treated exactly like an upload.

> This WebDAV support is built from Moon+'s documented behaviour and tested with standard WebDAV clients, but not yet against the app itself. Every file Moon+ writes is listed in `library/update.log`. If something isn't picked up, that log shows what arrived. Position files the server can't read are listed there too.

## Behind a reverse proxy (Traefik, Nginx Proxy Manager, Caddy…)

Every link in the page is relative and resolves against the public path, so the dashboard works at a sub-path such as `/reading`:

- **Prefix stripped** (Traefik `stripPrefix`, the usual setup): nothing to configure. Traefik sends `X-Forwarded-Prefix`, and the app uses it. See [`examples/traefik.yml`](examples/traefik.yml) for a ready-to-use file-provider config.
- **Prefix not stripped:** set `BASE_PATH: /reading` in `docker-compose.yml`.
- **Own (sub)domain:** nothing to configure.

Allow request bodies of at least 200 MB, because backups are often over 100 MB. Traefik has no limit by default. In Nginx, use `client_max_body_size 200m;`.

Use HTTPS when sharing it, because passwords travel with every sign-in, upload and sync.

## New books and genres

Moon+ doesn't store genres, so they come from `catalogue.json`, keyed by the lower-case book file name. New books show as **Untagged**, and `update.log` lists them. To tag one, add an entry under `"books"`:

```json
"some new book - author.epub": {
  "title": "Some New Book", "author": "Author Name",
  "series": "Series Name", "series_no": 2,
  "genre": "Science Fiction", "subgenre": "Space Opera"
}
```

You can also paste the untagged list into Claude and ask for the entries. To hide something that isn't a book, add its lower-case file name to `"exclude"`.

## Book covers

Moon+ only keeps covers for the books that are still on your device, so a backup usually has covers for a fraction of your history. On each rebuild the dashboard:

1. saves the covers it finds in the backup to `library/covers/`, then
2. looks up the rest on [Open Library](https://openlibrary.org) by title and author, in the background, about one book a second. The first run takes a few minutes, and `update.log` says how many were found. Books it can't find are tried again after 30 days.

Books without a cover show a tile with their first letter. Covers appear when you reload the page.

Each cover is saved as `library/covers/<book id>.jpg` (or `.png`), and an existing file is never replaced. To fix a wrong cover or add a missing one, save your own image under that name. The book id is the title in lower case with dashes, such as `project-hail-mary`. Set `COVER_LOOKUP: "off"` to never contact Open Library.

## Settings

All of these are optional environment variables in `docker-compose.yml`. `UPLOAD_TOKEN` is read from `.env` (copied from `.env.example`, and ignored by git) so the secret never lands in the compose file:

| Variable | Default | What it does |
|---|---|---|
| `UPLOAD_TOKEN` | *(empty)* | The admin password. Turns on admin sign-in, uploads and WebDAV |
| `BASE_PATH` | *(empty)* | Public sub-path, only when the proxy doesn't strip it |
| `PUID` / `PGID` | `1000` | Who owns the files in `library/` on the host |
| `POLL_SECONDS` | `30` | How often to check the inbox |
| `KEEP_BACKUPS` | `5` | How many backups to keep |
| `COVER_LOOKUP` | `on` | Set to `off` to stop looking up missing covers on Open Library |
| `TZ` | UTC | Time zone for the log |

The server also has three JSON endpoints: `/healthz`, which Docker uses as its health check, `/api/config`, which reports who you're signed in as and the last rebuild, and `/api/covers`, which lists the saved covers.

## How the numbers are worked out

- **New reads:** returning to a book after 365 days or more starts a new read. A single day back in a book only counts as a read if the book has no longer one.
- **Finished:** a read is finished when it ends at 99% or more. Before about 2019, Moon+ often didn't record progress, so early years undercount.
- **Minutes and words:** these are only logged per day from 2019 onwards. Per-book totals use the app's lifetime counters.
- **Speed:** words divided by minutes, over days where Moon+ logged both. Days above 800 wpm (flicking through) or below 40 wpm (book left open) are skipped, and a book needs 2+ hours of timed reading to get a speed.
- **Time of day:** the reading log only records which days you read, not what time, so the diary is per day. Highlights and notes do carry a time, so time-of-day views use them as a stand-in for when you read.
- **Highlights:** the backup records a chapter and position for each highlight but not the book's length, so how far in (%) is estimated from your progress on the day you made it. See [docs/moonplus-backup.md](docs/moonplus-backup.md) for what a backup holds.
- **Data checks:** a first or last day 30+ days from the rest of a read counts as stray; a 60+ day gap mid-read is a pause; a read is thinly spread when it spans 60+ days but was opened on under 15% of them. The thresholds are in `CHECK` in `web/calcs.js`.
- **Changing the rules:** the thresholds are at the top of `src/backup-import/reading-history.ts`, and every chart's calculation is in `web/calcs.js`.

## Development

Needs Node.js 24 (or 22.13+).

```sh
npm install
npm test                 # unit tests: the reading rules and the PNG shrinker
npm run test:e2e         # builds a fake backup and tests the real app: uploads, rebuilds, covers, WebDAV
npm run lint             # oxlint
LIBRARY=./library UPLOAD_TOKEN=dev npm run start:dev   # run without Docker on :8080, restarting on changes
```

Everything you can click through to (books, authors, series, genres, subgenres, years) is listed once, in `LINKS` at the top of `web/charts.js`. Show those fields with its helpers (`ref()`, `byline()`, `chip()`, or `table()`, `list()`, `hbars()` and `genreLegend()`, which use them) and they link on their own; each kind other than a book opens the page `pages/<kind>.js` registers with `rh.register`. The tests fail if one is shown as plain text or a link is made by hand.

### The demo

`src/demo/` makes up three years of reading (65 public-domain books, with series, a re-read, abandoned books, one on the go, and a few of the oddities the Data checks tab looks for), writes it as a fake Moon+ backup, and runs it through the real backup import. The result is a static copy of the page that works on any static host:

```sh
npm run demo -- site                            # COVER_LOOKUP=off to skip Open Library
npx http-server site -p 8000
```

The [`demo` workflow](.github/workflows/pages.yml) does the same on every push to `main`, and weekly, and publishes it to GitHub Pages.

### Layout

The server is a NestJS app with one module per job:

```
src/main.ts                 starts the app (drops root privileges first, in Docker)
src/app.module.ts           wires the modules together
src/app.setup.ts            HTTP setup shared with the e2e tests (BASE_PATH, headers)
src/config/                 every setting, read and checked from environment variables
src/library/                the library folder, update.log and the server's status
src/access/                 sign-in, sessions, and whether the dashboard is public or needs the read password
src/backup-import/          turns a .mrpro backup (plus synced positions) into data/*.json
  reading-history.ts        the rules: what counts as a read, finished, and so on
src/covers/                 saves covers from the backup and looks up missing ones on Open Library
src/rebuild/                watches for new backups, catalogue edits and syncs, and rebuilds
src/upload/                 the Update data button's upload
src/dav/                    the WebDAV server Moon+ syncs to
src/status/                 /healthz, /api/config and /api/covers
src/web/                    serves the page, its data and the covers
src/demo/                   builds the demo site from made-up data
web/                        the page: index.html, calcs.js (all the numbers), charts.js (d3), runtime.js, upload.js, pages/
seed/                       the starting catalogue.json
test/                       end-to-end tests, and checks on the page's code
examples/traefik.yml        reverse-proxy example
```
