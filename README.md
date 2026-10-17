# moonreader-dashboard

[![test](https://github.com/chorsnell/moonreader-dashboard/actions/workflows/test.yml/badge.svg)](https://github.com/chorsnell/moonreader-dashboard/actions/workflows/test.yml)
[![demo](https://github.com/chorsnell/moonreader-dashboard/actions/workflows/pages.yml/badge.svg)](https://chorsnell.github.io/moonreader-dashboard/)

A self-hosted dashboard for your [Moon+ Reader](https://www.moondownload.com/) reading history, with your TV, films and audiobooks alongside.

**[Try the live demo →](https://chorsnell.github.io/moonreader-dashboard/)** It runs on a made-up history of public-domain classics, rebuilt every week.

<a href="https://chorsnell.github.io/moonreader-dashboard/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.png"><img src="docs/screenshots/overview.png" alt="The Overview tab"></picture></a>

Moon+ keeps a record of every book, every day you read, the minutes, words and progress, and your highlights and notes inside its backups. The dashboard reads that, keeps the history even for books whose files are long gone, adds what Goodreads, StoryGraph, Kobo, Kindle, Netflix, Plex and Audiobookshelf know, and turns it into charts you can click through. It's one small container: a [NestJS](https://nestjs.com) app on Node.js 24, with no database to run.

## What's in it

**Reading tabs**

- **Overview:** this year against last, streaks, what's on the go, recently finished, a year-end forecast, lifetime words, a quote of the day, personal records, books per year, hours per month, and reading against watching.
- **Bookshelf:** every book you've read as a spine on a shelf per year (width is length, height is hours, colour is genre), and your years in colour.
- **Genres & authors:** genre and subgenre mix and how it shifts, book shapes, ratings by genre, most-read authors and series progress.
- **Origins:** how old your books are when you read them, where your authors come from (a map) and the gender balance over time.
- **Speed:** words per minute over time and for every book, page turners and slow reads, the finishing sprint, speed by genre, author, rating and year, and whether re-reads go faster.
- **Timeline & habits:** a day-by-day heatmap, tree rings, a "what you read when" timeline, juggling, weekday and seasonal rhythm, a 24-hour reading clock, biggest reads and books left unfinished.
- **Patterns:** what you read next, binge loops, palate cleansers, book hangovers, series pull, gateway books, the next book in each series, and a heatmap explorer.
- **Diary:** a day-by-day log for any period: which books, minutes, words and progress, with starts and finishes.
- **Library:** every book and every re-read, searchable and sortable, and where you give up.
- **TV & film:** hours watched, what's on screen now, dropped seasons, season completion, binge fingerprints, when you watch, genre drift, films, the cost per hour of each subscription, whether TV crowds out reading, and book-to-screen adaptations. It appears once there's something watched.
- **Money:** spending by month and year, a budget, how you got your books, value for money, the cost to finish a series, whether a subscription paid off, money left on the shelf, and what your reading time is worth at a rate you choose.
- **Friends:** friends' reading next to yours: a taste match, overlaid heatmaps, opt-in leaderboards, their favourites you haven't read, and book clubs. On a book's page, a buddy-read race against every friend who read it.
- **Data checks:** things in the log that look odd (stray days, long pauses, implausible speeds, progress jumps, untagged books or books without an ISBN).

**Pages.** Click any book, author, series, genre, subgenre or year, anywhere, for its own page with its own link (`#book/<id>`, `#author/<name>`, `#series/<name>`, `#genre/<name>`, `#subgenre/<name>`, `#year/<year>`):

- **Book:** every read, a day-by-day chart, the shape of each read, the rest of its series, your highlights and notes in book order (with where you highlighted and a word cloud), what it cost you, your rating, a race against friends who read it, and every day you opened it.
- **Author, series, genre and year:** stats, charts, books, money and time for each. A year page has a **Wrapped**: your year in review as swipeable stories.
- **Show and film** (`#show/<id>`, `#film/<id>`): seasons, binge fingerprint, episodes and sittings.

**Admin** (`#admin`, for the admin only): upload and rebuild, imports, sync logs, other media, who can see what, friends, the catalogue, prices, covers and the book manager. See [The admin page](#the-admin-page).

Every book shows its cover, from the backup or looked up on Open Library. It all works on a phone, in light and dark.

## Screenshots

<table>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#bookshelf"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/bookshelf-dark.png"><img src="docs/screenshots/bookshelf.png" alt="Bookshelf"></picture></a><br><b>Bookshelf</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#genres"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/genres-dark.png"><img src="docs/screenshots/genres.png" alt="Genres & authors"></picture></a><br><b>Genres &amp; authors</b></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#origins"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/origins-dark.png"><img src="docs/screenshots/origins.png" alt="Origins"></picture></a><br><b>Origins</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#speed"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/speed-dark.png"><img src="docs/screenshots/speed.png" alt="Speed"></picture></a><br><b>Speed</b></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#timeline"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/timeline-dark.png"><img src="docs/screenshots/timeline.png" alt="Timeline & habits"></picture></a><br><b>Timeline &amp; habits</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#patterns"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/patterns-dark.png"><img src="docs/screenshots/patterns.png" alt="Patterns"></picture></a><br><b>Patterns</b></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#diary"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/diary-dark.png"><img src="docs/screenshots/diary.png" alt="Diary"></picture></a><br><b>Diary</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#library"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/library-dark.png"><img src="docs/screenshots/library.png" alt="Library"></picture></a><br><b>Library</b></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#tv"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/tv-dark.png"><img src="docs/screenshots/tv.png" alt="TV & film"></picture></a><br><b>TV &amp; film</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#money"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/money-dark.png"><img src="docs/screenshots/money.png" alt="Money"></picture></a><br><b>Money</b></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#friends"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/friends-dark.png"><img src="docs/screenshots/friends.png" alt="Friends"></picture></a><br><b>Friends</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#checks"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/checks-dark.png"><img src="docs/screenshots/checks.png" alt="Data checks"></picture></a><br><b>Data checks</b></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#book/pride-and-prejudice"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/book-dark.png"><img src="docs/screenshots/book.png" alt="A book page"></picture></a><br><b>A book</b></td>
    <td width="50%" valign="top"><a href="https://chorsnell.github.io/moonreader-dashboard/#author/Jane%20Austen"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/author-dark.png"><img src="docs/screenshots/author.png" alt="An author page"></picture></a><br><b>An author</b></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/year-dark.png"><img src="docs/screenshots/year.png" alt="A year page"></picture><br><b>A year</b></td>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/wrapped-dark.png"><img src="docs/screenshots/wrapped.png" alt="Wrapped"></picture><br><b>Wrapped</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><a href="https://chorsnell.github.io/moonreader-dashboard/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark.png"><img src="docs/screenshots/mobile.png" alt="On a phone" width="240"></picture></a><br><b>On a phone</b></td>
    <td width="50%" align="center"><a href="https://chorsnell.github.io/moonreader-dashboard/#book/pride-and-prejudice"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-book-dark.png"><img src="docs/screenshots/mobile-book.png" alt="A book on a phone" width="240"></picture></a><br><b>A book on a phone</b></td>
  </tr>
</table>

All screenshots are from the [demo](https://chorsnell.github.io/moonreader-dashboard/), not anyone's real reading. `npm run screenshots` retakes them.

## Run it

```sh
git clone https://github.com/chorsnell/moonreader-dashboard.git
cd moonreader-dashboard
cp .env.example .env
# set UPLOAD_TOKEN in .env first (openssl rand -hex 16)
# GIT_COMMIT puts the commit you're running in the page's footer, next to the version
GIT_COMMIT=$(git rev-parse HEAD) docker compose up -d --build
```

Open `http://SERVER_IP:9080/` (the port is set in `docker-compose.yml`), click **Admin**, sign in with your `UPLOAD_TOKEN`, and upload a Moon+ backup in the **Data** section. To make one in Moon+, go to **Options → Backup & Restore → Backup**; it produces a `.mrpro` file. The dashboard builds itself in a few seconds.

To update later: `git pull && docker compose up -d --build`.

Everything the container keeps lives in `./library/`, which git ignores:

```
library/
  settings.json    who can see what (the read password is stored hashed)
  inbox/           backups (.mrpro); the newest is used, the 5 newest are kept
  data/            the generated data the page reads
  dav/             what Moon+ syncs over WebDAV
  covers/          book covers, one <book id>.jpg or .png each
  catalogue.json   titles, authors, series, genres and ISBNs for your books
  metadata.json    publication years, pages and authors looked up online
  prices.json      what you paid
  goodreads.json, storygraph.json, kobo.json, kindle*.json   imports
  media/           TV, film and audiobook history and its catalogue.json
  friends/         friends' reading, from share files or followed dashboards
  clubs.json       book clubs you host
  federation.json  follow tokens (owner-readable only, never served)
  feeds.json       hashes of the feeds' secret addresses (owner-readable only, never served)
  update.log       what happened on each rebuild, upload and sync
  activity.jsonl   the same as JSON lines, for Sync & logs
```

## Getting data in

Every way in triggers a rebuild.

### Moon+ Reader

1. **Upload a backup** in the admin page's **Data** section.
2. **Drop a backup into `library/inbox/`**, by hand, with `scp` or Syncthing.
3. **Sync over WebDAV.** When `UPLOAD_TOKEN` is set, the server is also a WebDAV server at `https://your-domain/dav/` (the **Data** section shows the exact address). Log in with any username and your `UPLOAD_TOKEN` as the password.
   - **Reading positions:** in a book, **Miscellaneous → Sync reading positions via Dropbox/WebDAV**, choose WebDAV and enter the address and login. Progress, "On the go" and finished status then stay current between backups. Minutes and words per day still only come from backups, because that's the only place Moon+ records them.
   - **Backups:** if your Moon+ offers WebDAV as a backup destination, use the same details; a `.mrpro` written there is treated like an upload.

> The WebDAV support is built from Moon+'s documented behaviour and tested with standard WebDAV clients, not yet against the app itself. Every file that arrives is listed in `library/update.log` and in **Sync & logs**.

What a backup holds is in [docs/moonplus-backup.md](docs/moonplus-backup.md).

### Goodreads and StoryGraph

Upload a Goodreads library export (My Books → Import and export → Export library) or a StoryGraph export in the **Imports** section.

- Books are matched to your Moon+ books by ISBN, then by title and author, and gain your **rating**, **shelves** and any read Moon+ doesn't know about (an earlier read on paper, say).
- Books only the export knows count as finished on the day it gives. With no minutes or words, they count towards books, genres, authors and series, but not time, speed, streaks or heatmaps. To-read shelves are left out.
- Ratings add views: speed against rating, ratings by genre, and whether you rate books you devoured higher.
- **Export to Goodreads** downloads your finished books as a CSV that Goodreads' import reads.
- Every book page links to the book on Goodreads: straight to it when a Goodreads export knows it, otherwise by ISBN or a title search. Private books get no link.

### Kobo and Kindle

The same **Imports** section takes e-reader data; files are recognised by their contents.

- **Kobo:** `.kobo/KoboReader.sqlite` from the device (over USB): progress, time spent, start, last-read and finish dates, highlights and notes.
- **Kindle highlights:** `documents/My Clippings.txt`: highlights, notes and bookmarks with their dates.
- **Kindle reading sessions:** `Kindle.Devices.ReadingSession.csv` from Amazon's "Request your data" export: minutes per day for each book. It names books only by ASIN, so upload any CSV with `ASIN` and `Title` columns (your digital orders) or name them in **Catalogue** (`kindle:<ASIN>`).

For a day Moon+ already has, Moon+'s figures stand; imports fill in the other days. With no Moon+ backup at all, the dashboard is built from the imports alone.

### Netflix

On Netflix, Account → Security & privacy → **Download your personal information**, then upload the zip (or just `CONTENT_INTERACTION/ViewingActivity.csv`) in the admin page's **Other media** section. Accounts are shared, so tick your profile(s) before anything is imported (an export with one profile is imported straight away). A profile's **Download all** CSV also works, but has no durations, so time watched is estimated. From a script: `curl -T netflix.zip -H "X-Upload-Token: $UPLOAD_TOKEN" "http://your-server/upload?source=netflix&name=netflix.zip"`.

### Plex, through Tautulli

[Tautulli](https://tautulli.com) keeps every Plex play with how long it was watched, and never needs your Plex token. Copy its API key (Settings → Web Interface), then in **Other media** enter its address (such as `http://tautulli:8181`) and the key, press **Test**, pick your Plex user and **Save**, or set `TAUTULLI_URL` and `TAUTULLI_API_KEY`. The whole history is pulled once, then new plays every `MEDIA_POLL_MINUTES`.

### Audiobookshelf

[Audiobookshelf](https://www.audiobookshelf.org) keeps a session for every sitting. Copy your API token (Settings → Users → your user), then enter its address (such as `http://audiobookshelf:13378`) and the token in **Other media**, or set `AUDIOBOOKSHELF_URL` and `AUDIOBOOKSHELF_TOKEN`. Sessions are pulled with the Plex plays. For now audiobooks count as **listening** in the cross-media views (the Overview and year pages); there's no audiobook tab yet.

With a [TMDB](https://www.themoviedb.org/settings/api) key (`TMDB_API_KEY`, or in **Other media**) TV and films also get genres, creators, episode counts and posters; without one everything still works from the titles. Fix a title in `library/media/catalogue.json`, keyed by the lower-case show or film title: `{"copper valley": {"genre": "Drama"}, "nosferatu": {"book": "Dracula"}, "some trailer": {"exclude": true}}` (`book` links a film to a book when the titles differ). How TV, film and audiobooks are modelled is in [docs/media-verticals.md](docs/media-verticals.md).

## Books, covers and details

**Titles, authors and genres.** Moon+ doesn't store genres, so they come from `library/catalogue.json`, keyed by the lower-case book file name. New books show as **Untagged** until you tag them in the admin page's **Catalogue** section, or by hand:

```json
"some new book - author.epub": {
  "title": "Some New Book", "author": "Author Name",
  "series": "Series Name", "series_no": 2,
  "genre": "Science Fiction", "subgenre": "Space Opera",
  "isbn": "978-0-14-143951-8", "published_year": 1965, "pages": 412
}
```

**Finished by hand.** When you finished a book Moon+ didn't see you finish (a broken file with blank pages at the end, or a book from before it recorded progress), add `"finished": true` to its entry, or use **Mark finished** in the Catalogue section (its **Not finished** list shows the candidates). Its latest read then counts as finished. `"finished": false` stops the guesses above for a book you really didn't finish.

Add a lower-case file name to `"exclude"` to hide something that isn't a book. Per author, `"authors": { "Author Name": { "country": "Ireland", "gender": "male" } }`. What you put in the catalogue always wins over lookups.

**ISBNs and editions.** ISBN-13 or ISBN-10, with or without hyphens (the other form is worked out; invalid ones are ignored). Copies count as one book when they share a title and author, an ISBN, or a `"work_id"` (any id you give every edition, such as an Open Library work id).

**Covers.** Covers from the backup are saved to `library/covers/`; the rest are looked up on [Open Library](https://openlibrary.org) in the background, about one a second, and misses are retried after 30 days. To fix one, save your own image as `library/covers/<book id>.jpg` (the id is the title in lower case with dashes, such as `project-hail-mary`) or use the **Covers** section. `COVER_LOOKUP=off` stops the lookups.

**Publication years, pages and authors.** Each book is looked up on Open Library (by ISBN, else title and author) for its first publication year, page count and an ISBN, and each author on [Wikidata](https://www.wikidata.org) for their country and gender. Results are stored in `library/metadata.json` (delete an entry to look it up again); misses are retried after 30 days. `METADATA_LOOKUP=off` stops the lookups. Which other sources were considered is in [docs/integrations.md](docs/integrations.md).

## What your books cost

Moon+ doesn't know what you paid, so prices live in `library/prices.json`, set in the admin page's **Prices** section: price, currency, date, how you got it (bought, free, library, subscription, gift), store, list price, bundle and private notes. Books you bought but never opened can be added too.

- **CSV import** of a store's order history or a spreadsheet (needs a `title` column; reads `author`, `isbn`, `price`, `currency`, `date`, `acquisition`, `store`, `subscription`, `list_price`, `bundle`, `notes`). You see what matched before anything is saved. **Download all as CSV** gives the same columns back.
- **Currencies** are converted to one home currency with exchange rates you set; nothing is looked up online.
- **Bundles** split their price by length; **subscriptions** (Kindle Unlimited, Kobo Plus…) take a monthly fee and dates.
- Prices aren't looked up automatically: no free, keyless source covers ebook stores, and only your order history knows what you actually paid.

TV subscriptions are entered in **Other media**, for the cost per hour watched.

## Your book manager (*arr)

If you run a Readarr-compatible book manager (Readarr's successors such as Bookshelf), connect it in the **Book manager** section with its URL and API key. You then see, as the admin only, where each book stands there (available, downloading, wanted), a **Get next in series** button and **Get the rest of this author** on author pages. The dashboard only sends requests to your own instance; it never searches for or downloads anything itself, and the API key never leaves the server. Requests are logged in **Sync & logs**. More in [docs/integrations.md](docs/integrations.md).

## The admin page

Click **Admin** in the corner and sign in with your `UPLOAD_TOKEN`. The page (`#admin`) has these sections:

| Section | What it's for |
|---|---|
| **Data** | Upload a backup, rebuild now, the backups kept, the WebDAV address |
| **Imports** | Goodreads, StoryGraph, Kobo and Kindle files; export to Goodreads |
| **Sync & logs** | Every sync, rebuild, upload, lookup and request, filterable and downloadable, with a warning when syncing seems to have stopped or a login failed |
| **Other media** | Netflix uploads, Tautulli, Audiobookshelf, TMDB and streaming subscriptions |
| **Access & privacy** | Who can see the dashboard and what each kind of visitor sees; private books and genres; preview as a visitor |
| **Friends** | Your share file and leaderboards, friends' share files, dashboards you follow and that follow you, book clubs, and who can see friends' reading |
| **Catalogue** | Titles, authors, series, genres and ISBNs; untagged books |
| **Prices** | Prices, CSV import, currencies, bundles, subscriptions, budget |
| **Covers** | Books without a cover: look them up again or upload your own |
| **Feeds** | Atom and iCal feeds at secret addresses: make, give a new address, revoke |
| **Book manager** | Your *arr book manager's URL and API key |

## Who can see it

`UPLOAD_TOKEN` is the admin password. Only the admin can upload, sync or change settings, and the admin always sees everything. In **Access & privacy → Who can see this dashboard**, choose:

- **Anyone with the link** (the default), or
- **Only people with the read password.** Visitors get a password box, and the data, covers and API refuse them until they enter it. Their browser remembers it for a year; setting a new password signs everyone out.

**What each kind of visitor sees.** There are three audiences, each with its own settings: the **public**, people with the **read password**, and **friends you share with** (what goes into your share file). Start from a preset (**Everything**, **Everything but exact dates** or **Taste only**) or set each item:

- **Dates:** exact days, or only the week or month.
- **Day-by-day reading:** the diary, heatmaps and timeline.
- **What you're reading now** and when you last read.
- **Streaks and quiet spells.**
- **Highlights and notes** (hidden from the public by default).
- **Prices and spending.**
- **Ratings and shelves** from Goodreads or StoryGraph.

You can also mark books or whole genres as private: visitors then see nothing of them, or "A private book" with no title, author or cover. This is enforced on the server: the data files, stats and API are filtered for each visitor, so hidden details never reach their browser. **Preview as a visitor** shows exactly what each one gets.

**Link previews.** A link to a public dashboard, pasted into Slack, Discord, WhatsApp, iMessage, Bluesky, X or anywhere else that shows previews, comes with a title and a line of headline numbers (books finished, this year so far, hours, words, authors, the latest finishes), and a collage of recent covers (`/share.jpg`). Both are built from what the public may see, so private books never appear. A dashboard behind the read password shows only its name. Previews need the dashboard's full address: it's worked out from the `Host` and `X-Forwarded-Proto` headers your proxy sends, or set it with `PUBLIC_URL`. Links to a page inside the dashboard (`#book/…`) show the same preview, because the part after `#` never reaches the server.

## Friends

Bring friends' reading into your dashboard to compare notes. There are two ways in:

- **Share files.** A friend downloads theirs (**Admin → Friends → Download your share file**) and you add it under **Add a friend's reading**.
- **Follow their dashboard.** If they run their own, enter its address under **Admin → Friends**. They approve and choose what you get (everything, stats only, or chosen views, minus any books they hide), and your server refreshes it every `FEDERATION_REFRESH_MINUTES`. They can stop sharing at any time, which deletes their data from yours.

Either way, what you share is set by the **friends** audience under Access & privacy (by default everything except prices and highlights), and private books are never shared. Friends' reading shows up as:

- **Taste match:** a compatibility score from genres, authors and books in common, shared authors, and the books you both read.
- **Overlaid heatmaps** of the last 12 months, and **leaderboards** that each person opts into, stat by stat.
- **Their favourites you haven't read:** books a friend devoured or re-read that aren't in your library.
- **Buddy-read race** on a book's page: your progress against every friend who read it.
- **Book clubs:** a book, friends, a start date and an optional schedule, with everyone's progress against it and comments pinned to a position in the book. A comment stays hidden from anyone who hasn't read that far, and this is enforced on the server. Friends who follow your dashboard can comment from theirs.

Their reading is theirs: by default only you, the admin, see it; you can let people with the read password, or everyone, see it too. The share file format, the follow protocol and the book club API are in [docs/friends.md](docs/friends.md).

## Feeds

Follow your reading from a feed reader or a calendar app. In **Admin → Feeds**, make:

- an **Atom feed** of finished books, the newest 50, each with its cover, your rating (when ratings are visible), author, hours and a link to its page, or
- an **iCal calendar** (subscribe to it in Google Calendar, Apple Calendar or Outlook) with all-day events for each reading day of the last 400 days (with the minutes and titles), each finish, and your book clubs: the start, each week's target on the schedule and the planned finish.

Each feed has its own secret address (`/feeds/<secret>.atom` or `.ics`), shown once when it's made. Feed readers and calendars can't sign in, so the address works even when the dashboard needs the read password; give it a new address if it gets out, or revoke it. Only a hash of each secret is kept, in `library/feeds.json`.

A feed is built from what one audience may see (the public, people with the read password, or friends; never everything), exactly as their own copy of the data is filtered. Private books never appear, and dates are rounded as theirs are (a finish then spans its week or month). Reading days are only in the calendar when that audience sees exact days, day-by-day reading and streaks. Book clubs are only in it when that audience may see friends' reading and what you're reading now.

## Behind a reverse proxy

Every link is relative, so the dashboard works at a sub-path such as `/reading`:

- **Prefix stripped** (Traefik `stripPrefix`, the usual setup): nothing to configure; the app reads `X-Forwarded-Prefix`. See [`examples/traefik.yml`](examples/traefik.yml).
- **Prefix not stripped:** set `BASE_PATH: /reading`.
- **Own (sub)domain:** nothing to configure.

Allow request bodies of at least 200 MB, because backups are often over 100 MB (Nginx: `client_max_body_size 200m;`). Use HTTPS when sharing it, because passwords travel with every sign-in, upload and sync.

## Settings

All optional environment variables, set in `docker-compose.yml`. `UPLOAD_TOKEN` is read from `.env` (copied from `.env.example`, ignored by git) so the secret stays out of the compose file. Tautulli, Audiobookshelf and TMDB can also be set on the admin page; the *arr book manager is set there only.

| Variable | Default | What it does |
|---|---|---|
| `UPLOAD_TOKEN` | *(empty)* | The admin password. Turns on admin sign-in, uploads and WebDAV |
| `BASE_PATH` | *(empty)* | Public sub-path, only when the proxy doesn't strip it |
| `PUBLIC_URL` | *(from the request)* | The dashboard's full address, e.g. `https://books.example.com/reading`, for link previews |
| `PORT` | `8080` | Port inside the container |
| `LIBRARY` | `/library` | Folder for everything the app keeps |
| `PUID` / `PGID` | `1000` | Who owns the files in `library/` on the host |
| `TZ` | UTC | Time zone for the log |
| `POLL_SECONDS` | `30` | How often to check the inbox (at least 5) |
| `KEEP_BACKUPS` | `5` | How many backups to keep |
| `FEDERATION_REFRESH_MINUTES` | `60` | How often to refresh friends' reading from the dashboards you follow (`0`: only when you press **Refresh**) |
| `COVER_LOOKUP` | `on` | `off` stops looking up missing covers on Open Library |
| `METADATA_LOOKUP` | `on` | `off` stops looking up publication years, pages and authors on Open Library and Wikidata |
| `COVER_PAUSE` | `1` | Seconds between Open Library and Wikidata requests |
| `OPENLIBRARY_URL` | `https://openlibrary.org` | Open Library's address (for a mirror or tests) |
| `OPENLIBRARY_COVERS_URL` | `https://covers.openlibrary.org` | Open Library's cover server |
| `WIKIDATA_URL` | `https://www.wikidata.org` | Wikidata's address |
| `TMDB_API_KEY` | *(empty)* | A TMDB key (v3 key or v4 read token) for TV and film genres and posters |
| `TMDB_URL` / `TMDB_IMAGE_URL` | TMDB's API and image server | TMDB's addresses |
| `TAUTULLI_URL` / `TAUTULLI_API_KEY` | *(empty)* | Tautulli's address and API key, for Plex watch history |
| `AUDIOBOOKSHELF_URL` / `AUDIOBOOKSHELF_TOKEN` | *(empty)* | Audiobookshelf's address and API token |
| `MEDIA_POLL_MINUTES` | `60` | How often to pull from Tautulli and Audiobookshelf |
| `MIXPANEL_TOKEN` | *(empty)* | A Mixpanel project token: sends anonymous page views and clicks (no titles, names or dates) to Mixpanel. Off when empty |
| `MIXPANEL_API_HOST` | `https://api-js.mixpanel.com` | Mixpanel's address, e.g. `https://api-eu.mixpanel.com` for EU data residency |

The demo build and the screenshot script read `DEMO_TODAY` (the demo's "today", `YYYY-MM-DD`) and `DEMO_SEED`, and the demo build `DEMO_URL` (its public address, for link previews); see [docs/contributing.md](docs/contributing.md).

## The API

- `/healthz`: Docker's health check.
- `/api/config`: who you're signed in as and the last rebuild.
- `/api/covers`: the saved covers.
- `/api/stats`, `/api/stats/<calc>`, `/api/stats/year/<year>`, `/api/author/<name>`: every number the page shows, worked out on the server for each viewer from only what they may see. See [docs/api.md](docs/api.md).
- `/feeds/<secret>.atom` and `/feeds/<secret>.ics`: the feeds made under **Admin → Feeds**; see [docs/api.md](docs/api.md#feeds).
- `/data/friends.json`, `/api/clubs` and the federation endpoints (`/api/federation/…`) that followed dashboards use: see [docs/friends.md](docs/friends.md).

## How the numbers are worked out

- **New reads:** returning to a book after 365 days or more starts a new read. A single day back in a book only counts as a read if the book has no longer one.
- **Finished:** a read is finished when it ends at 99% or more, or at 95% or more once it's over (not opened for 14 days, or read again since), the rest being afterwords and credits. Before about 2019 Moon+ often didn't record progress; those reads count as finished when the words read (or the minutes, at your usual speed) come to 80% of the book's page count × 250 words. **Data checks → Guessed finished** lists every read counted this way. The rules are at the top of `src/backup-import/finish-rules.ts`.
- **Minutes and words:** only logged per day from 2019 onwards. Per-book totals use the app's lifetime counters.
- **Speed:** words divided by minutes, over days where Moon+ logged both. Days above 800 wpm (flicking through) or below 40 wpm (book left open) are skipped, and a book needs 2+ hours of timed reading to get a speed.
- **Time of day:** the reading log only records days, not times. Highlights and notes carry a time, so time-of-day views use them as a stand-in.
- **Highlights:** the backup records a chapter and position, not the book's length, so how far in (%) is estimated from your progress on the day.
- **Data checks:** a first or last day 30+ days from the rest of a read is stray; a 60+ day gap mid-read is a pause; a read is thinly spread when it spans 60+ days but was opened on under 15% of them (`CHECK` in `web/calcs.js`).
- **Changing the rules:** the thresholds are at the top of `src/backup-import/reading-history.ts` (and `src/media/media-history.ts` for TV and film), and every chart's calculation is in `web/calcs.js` or the feature script that draws it.
- **Where they're worked out:** the server runs those same calculations after every rebuild, once per kind of viewer, so the page loads ready-made numbers instead of crunching the whole history on your phone.

## Development

Needs Node.js 24.

```sh
npm ci
npm run lint && npx tsc --noEmit && npm test && npm run test:e2e   # what CI runs
LIBRARY=./library UPLOAD_TOKEN=dev npm run start:dev               # run on :8080, restarting on changes
```

New charts, cards, tabs, pages and admin sections are **feature scripts**: one `web/features/<name>.js` (and optional `.css`) that the server and the demo add to the page, with no edit to `index.html` or `charts.js`. The API is in [web/features/README.md](web/features/README.md). Show books, authors, series, genres and years with the `rh` link helpers; the tests fail if one is shown as plain text.

**The demo.** `src/demo/` makes up four years of reading (65 public-domain books with series, re-reads, abandoned books, oddities for Data checks, highlights, prices, ISBNs and metadata), Goodreads and Kobo imports, Netflix and Audiobookshelf history and two friends, writes it as a fake Moon+ backup and runs it through the real import. The result is a static site:

```sh
COVER_LOOKUP=off npm run demo -- site   # COVER_LOOKUP=off skips Open Library
npx http-server site -p 8000
```

The [`demo` workflow](.github/workflows/pages.yml) builds it on every push to `main` and weekly, and publishes it to GitHub Pages. The admin page needs the server, so it isn't in the demo.

**Screenshots.** `npm run screenshots` builds the demo and retakes every screenshot above (every tab, found on the page, plus a book, author, year, Wrapped and two phone shots, light and dark). See [docs/contributing.md](docs/contributing.md) for that, the checks and the pull request checklist.

### Layout

```
src/main.ts, app.module.ts, app.setup.ts   start-up, wiring, HTTP setup shared with the e2e tests
src/config/          every setting, read and checked from environment variables
src/library/         the library folder, update.log, the activity log and the server's status
src/access/          sign-in, sessions, and whether the dashboard needs the read password
src/privacy/         what each kind of visitor may see, and the filter that enforces it
src/backup-import/   turns a .mrpro backup (plus synced positions) into data/*.json
src/imports/         Goodreads, StoryGraph, Kobo and Kindle: reading, matching, exporting
src/media/           TV, film and audiobooks: Netflix, Tautulli, Audiobookshelf, TMDB, the media build
src/covers/          covers from the backup and Open Library
src/metadata/        ISBNs, Open Library and Wikidata lookups
src/prices/          prices, currencies, bundles and subscriptions
src/friends/         share files and friends' data
src/federation/      following friends' dashboards, and approving the ones that follow yours
src/clubs/           book clubs and their spoiler-safe comments
src/feeds/           Atom and iCal feeds at secret addresses
src/arr/             requests to the admin's own *arr book manager
src/rebuild/         watches for new backups, edits and syncs, and rebuilds
src/upload/, src/admin/, src/dav/, src/status/   uploads, the admin API, WebDAV, /healthz and /api/config
src/stats/           runs the page's calcs on the server per viewer; /api/stats
src/web/             serves the page, its data, feature scripts and covers
src/share/           link previews: the Open Graph tags and the cover collage
src/demo/            builds the demo site from made-up data
web/                 the page: index.html, calcs.js, charts.js, runtime.js, pages/, features/
docs/                backup format, API, friends, integrations, media model, contributing
test/                end-to-end tests and checks on the page's code
```
