# moonreader-dashboard

A self-hosted dashboard for your [Moon+ Reader](https://www.moondownload.com/) reading history.

It reads the statistics Moon+ keeps inside its backups (every book, every day you read, minutes, words and progress). It keeps that history even for books whose files are long gone, and turns it into:

- **Overview:** this year against last year, streaks, minutes per day, what's on the go, recently finished, books per year and hours per month.
- **Genres & authors:** genre and subgenre mix, how it shifts over the years, top authors and series progress.
- **Speed:** your words-per-minute for every book, showing your page turners and your slow reads, plus speed by genre, subgenre and author against your average, and by year.
- **Timeline & habits:** a day-by-day heatmap and a "what you read when" timeline, each with its own date range (presets or custom dates), plus weekday rhythm, biggest reads and books left unfinished. Each timeline bar is faint from first to last day and solid on the days you actually opened the book.
- **Diary:** a day-by-day log for any period showing which books you read, minutes, words, and progress from one day to the next, with started and finished markers. Click any heatmap square to jump to that day.
- **Library:** every book and every re-read, searchable and sortable.
- **Data checks:** things in the log that look odd. These include a book opened once and then left for weeks (which stretches its dates), reads spread thinly over months, long pauses, days with three or more books, implausible speeds, very long sessions, progress jumps, and untagged books. Click a date to open that day in the diary.

It's one small container with no dependencies beyond the Python standard library.

## Run it

```sh
git clone https://github.com/chorsnell/moonreader-dashboard.git
cd moonreader-dashboard
# set UPLOAD_TOKEN in docker-compose.yml first (openssl rand -hex 16)
docker compose up -d --build
```

Open `http://SERVER_IP:8080/`, click **Update data** and upload a Moon+ backup. To make one in Moon+, go to **Options → Backup & Restore → Backup**; it produces a `.mrpro` file. The dashboard builds itself in a few seconds.

To update to a newer version later:

```sh
git pull && docker compose up -d --build
```

Everything the container keeps lives in `./library/`, which is ignored by git:

```
library/
  inbox/           backups (.mrpro); the newest is used, the 5 newest are kept
  data/            the generated data the page reads
  dav/             what Moon+ syncs over WebDAV
  catalogue.json   titles, authors, series and genres for your books
  update.log       what happened on each rebuild, upload and sync
```

## Getting new data in

There are four ways, and all of them trigger a rebuild automatically:

1. **The Update data button** on the dashboard. It's only shown when `UPLOAD_TOKEN` is set, and asks for that token, which your browser then remembers.
2. **WebDAV from Moon+** (below). This keeps progress current without making backups.
3. **Drop a backup into `library/inbox/`**, by hand, with `scp`, or with Syncthing.
4. **Edit `library/catalogue.json`.** Saving it rebuilds the data with your changes.

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

Use HTTPS when sharing it, because the upload token travels with every upload and sync.

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

## Settings

All of these are optional environment variables in `docker-compose.yml`:

| Variable | Default | What it does |
|---|---|---|
| `UPLOAD_TOKEN` | *(empty)* | Turns on the Update data button and WebDAV, and is the password for both |
| `BASE_PATH` | *(empty)* | Public sub-path, only when the proxy doesn't strip it |
| `PUID` / `PGID` | `1000` | Who owns the files in `library/` on the host |
| `POLL_SECONDS` | `30` | How often to check the inbox |
| `KEEP_BACKUPS` | `5` | How many backups to keep |
| `TZ` | UTC | Time zone for the log |

The server also has two JSON endpoints: `/healthz`, which Docker uses as its health check, and `/api/config`, which reports the last rebuild and any error.

## How the numbers are worked out

- **New reads:** returning to a book after 365 days or more starts a new read. A single day back in a book only counts as a read if the book has no longer one.
- **Finished:** a read is finished when it ends at 99% or more. Before about 2019, Moon+ often didn't record progress, so early years undercount.
- **Minutes and words:** these are only logged per day from 2019 onwards. Per-book totals use the app's lifetime counters.
- **Speed:** words divided by minutes, over days where Moon+ logged both. Days above 800 wpm (flicking through) or below 40 wpm (book left open) are skipped, and a book needs 2+ hours of timed reading to get a speed.
- **Time of day:** Moon+ records which days you read, not what time, so the diary is per day.
- **Data checks:** a first or last day 30+ days from the rest of a read counts as stray; a 60+ day gap mid-read is a pause; a read is thinly spread when it spans 60+ days but was opened on under 15% of them. The thresholds are in `CHECK` in `app/web/calcs.js`.
- **Changing the rules:** the thresholds are at the top of `app/update.py`, and every chart's calculation is in `app/web/calcs.js`.

## Development

```sh
python3 -m unittest discover -s tests -v     # builds a fake backup and tests the real server
LIBRARY=./library UPLOAD_TOKEN=dev python3 app/server.py   # run without Docker on :8080
```

```
app/server.py        web server, rebuild watcher, uploads, WebDAV
app/update.py        turns a .mrpro backup (plus synced positions) into data/*.json
app/web/             the page: index.html, calcs.js (all the numbers), charts.js (d3), runtime.js, upload.js
app/seed/            the starting catalogue.json
examples/traefik.yml reverse-proxy example
```
