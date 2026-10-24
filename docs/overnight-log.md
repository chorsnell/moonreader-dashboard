# Overnight log

## Run 3: EP-18 and EP-19 (24 Oct 2026)

You asked for three things: a reading dashboard rather than a Moon+ one, a want-to-read list of your own (partly from Goodreads), and the books you haven't read by your authors, series and genres. They became two epics on the [BOO board](https://tasks.kiss.cat/BOO): **EP-18** (A reading dashboard, not a Moon+ one) and **EP-19** (Want to read & what to discover). Parallel agents built one PR per ticket; each was reviewed, checked on top of main and **merged once CI was green**, in this order: #112, #113, #114, #115, #116, #117, then this log (#118).

### Things for you

- **Give the lookups a real run.** Nothing here could reach Open Library or Wikidata from the build machine, so the bibliography (BOO-103), genre subjects (BOO-105) and the want-to-read search (BOO-102) were only tested against fake servers. After deploying, rebuild once and look at Sync & logs for "Bibliography…" entries, then an author page.
- **Tune the title filter** in `src/bibliography/works.ts` (`isNotAWork`) once you see real authors: Open Library lists study guides, omnibuses and foreign editions, and the rules are a first guess.
- **Check the genre → subject mapping** in Admin → Discovery against your own genres (the defaults are in BOO-105's decisions below).
- **Try a real KOReader `statistics.sqlite3`** if you move to KOReader (or Kobo with KOReader): it was built to the schema, not tested on a device's file.
- **Renaming the repo** (for example to `reading-dashboard`) is your call. The package, Docker image, container and repo names were left alone because your deploy workflow and compose file use them. GitHub redirects a renamed repo, but `chorsnell/workflows` and the Traefik route would still need the new name.
- **Screenshots** were retaken for the To read tab and an author page (see BOO-106).

### Decisions by ticket

- **BOO-100 Reading dashboard (#113)**: package, Docker image/container and repo names unchanged (deploys use them); the internal `moonplus` source id and `moonreader-dashboard:*` localStorage keys kept, so existing data and settings still work. Notes only true of Moon+ ("Moon+ logs minutes from 2019", WebDAV sync) are marked `data-moonplus` or use `dash.hasMoonplus()`, and only show when the data has a Moon+ backup (`meta.backup_file`). The first-run screen and Admin → Data list every source and where it goes.
- **BOO-101 KOReader (#112)**: book id is the file's md5, so it stays the same across devices; progress is the highest page that day ÷ total pages (the book's page count in older databases); reads split at the shared one-year gap and count as finished at the shared 99%; no words (as Kindle); a single page entry over four hours is dropped as the device left on; "N/A" author or series means none; "Name #3" gives a series and number.
- **BOO-102 Want-to-read list (#115)**: kept in `library/want_to_read.json`, which no import writes. It joins the pile as the source "On your list", merged with the same shelf book by ISBN, then title and author. **Keep** copies a Goodreads/StoryGraph shelf row (or an unopened Moon+ file) into the list so it survives the shelf changing; **Hide** drops a row from the pile unless it's also on your list. No Keep/Hide on books Moon+ opened, bought books or rows already on the list. Notes are stripped for visitors and previews, and the demo has none because it serves `data/` unfiltered. The list shows the date added, not "N days ago": the page's "today" is your last reading day, which made new books 0 or negative days old (pile ages now clamp at 0). `rh.wantToRead` is the shared helper the other views use.
- **BOO-103 Bibliography lookup (#114)**: a co-written book counts for its first author only (as everywhere else); authors with a finished book or two books are looked up, plus the author of any series you've started, 40 a round, again after 30 days. Lookups run cover → metadata → bibliography. Open Library gives the works (2+ editions, a first-published year, junk titles and other-language-only works dropped); Wikidata adds series and their order, and series members Open Library lacks. If Wikidata fails, Open Library's works are kept and the author is retried next round. The Wikidata id falls back to the Open Library author record. New setting `WIKIDATA_SPARQL_URL`, mainly for tests. Visitors don't get rows for authors or series that only private books belong to.
- **BOO-104 Unread by author and series (#116)**: "next up" is the first unread book after the highest number you've read (else the first unread); unnumbered books go after numbered ones, by year. A series counts as started once you've read or are reading one of its books. A third calc, `discover_picks`, works out the To read card on the server, taking one book per author in turn so one author can't fill it. Cards hide on author and series pages with nothing to show; the To read card says the lookup fills it in after a rebuild. The series strip writes each state as text with its own outline, not colour alone. A book already on your pile shows "On your pile" instead of a button.

### Coordinator

- Merged each PR only after its CI was green and, where main had moved, after running lint, tsc and the unit tests on the merge locally.
- Checked by hand: every want-to-read endpoint is admin-only at the controller; the Moon+ scoping reads `meta` that both `/api/config` and the static demo provide; the Wikidata query skips editions and articles and drops works with no English label.

---

## Run 2: EP-12 to 15 and EP-17 (18 Oct 2026)

Eight parallel agents built the 24 tickets in EP-12 (Outbound), EP-13 (To-read pile & predictions), EP-14 (Highlights, everywhere), EP-15 (Reading in context) and EP-17 (Loose ends). EP-16 (Media, round two) was left out on purpose. Each ticket has its own PR (#82 to #105) with lint, tsc, unit and e2e tests green. **None was merged by the agents**: self-merging was refused ("Merge Without Review"), so every ticket is in **REVIEW**. **PR #106** combines all 24 with the conflicts resolved (343 unit and 135 e2e tests green, demo checked in light, dark and 390px with no console errors). Merge #106, then close the others; GitHub marks them merged.

If you merge the individual PRs instead: #95 and #100 need #92 first, #91 needs #84, #96 and #99 need #92, #101 and #102 need #83. Once #83 is in, #86 and #95 need their `bookKeys` import moved to `src/common/book-match` (done in #106), and #88 with #102 clash in `src/demo/demo-friends.ts` (also fixed in #106).

### Things for you

- **Give these a real run**: they were only tested against fake servers: ntfy, Gotify and Discord (BOO-72), Readwise (BOO-82), Open-Meteo (BOO-85), a Google or iCloud calendar (BOO-86) and a TRMNL device (BOO-73, which needs the dashboard reachable from the internet).
- **Check Moon+ `addTime`** in a real backup (BOO-76 assumes it's a timestamp; if not, books just have no added date).
- **Tune the give-up thresholds** (BOO-78, the `R` constant in `web/features/giveup-risk.js`) and the read-next weights (BOO-79, top of `web/features/what-next.js`) against your real data.
- **Decide on BOO-87**: the sleep spike says don't build it yet; a nightly "last read" record is the suggested first step.
- **Set your reading goal** (Admin → Widgets & devices): there was no goal before BOO-71.
- **Screenshots**: not retaken. New views to add: To read, What to read next, Highlights, Challenges, On this day, Today's highlights, the Day by day chart and the Wrapped screen slide. Locally, `npm run screenshots` needs `PLAYWRIGHT_CHROMIUM_PATH` here (Playwright expected a browser build that isn't installed).
- **The stats worker** (BOO-95) is on by default; set `STATS_WORKER=off` if it misbehaves in Docker (the image itself wasn't run).

### Decisions by ticket

- **BOO-71 Home Assistant (#92)**: a JSON endpoint `/api/now` for HA's REST sensor, not MQTT (that would need a new dependency and a broker). A revocable device token chooses whose view a device gets. Streak at risk means you read yesterday but not yet today, and only updates when a sync arrives. README has the sensor YAML and a 9pm nudge automation.
- **BOO-75 Badges (#96)**: always the public view, even for the admin, so they cache safely; 404 while a read password is set. Covers are embedded so GitHub's image proxy shows them.
- **BOO-73 E-ink (#99)**: an 800×480 1-bit PNG drawn by hand (dithered cover, built-in pixel font), plus `/api/trmnl` JSON and a Liquid template for TRMNL's polling plugin. No new dependencies.
- **BOO-74 Feeds (#86)**: Atom and iCal at secret URLs, each tied to one visitor level, never the admin view. Clubs have no meeting dates, so the calendar shows the start, a weekly check-in and the planned finish.
- **BOO-72 Notifications (#95)**: ntfy, Gotify, Discord and a generic webhook, a toggle per event. Each check is diffed against a saved state written before sending, so nothing is resent; the first run is a silent baseline. Private books are never named. Streak at risk is checked every 10 minutes from 21:00.
- **BOO-81 Highlights tab (#89)**: search runs in the browser (the file is small). "Most-highlighted passages" means the same passage highlighted more than once.
- **BOO-82 Export (#97)**: a Markdown zip with stable file names (re-export overwrites, so edits in those files are lost), a Readwise CSV, and a Readwise API push that only sends what's new. Private books are included, since it's your own export.
- **BOO-83 Daily review (#100)**: 5 a day from highlights over 30 days old. Keep returns in 7 days and doubles; Less often starts at 30 days. Morning send goes through the notifier; no email channel. Anki export is tab-separated text.
- **BOO-94 Matching (#83)**: one module replaces four copies (not two). The three existing matching strengths are kept apart, since merging them would change behaviour.
- **BOO-76 To read (#101)**: Goodreads to-read shelves stay out of books.json and only appear on the pile. Friends' favourites are suggestions and not counted.
- **BOO-79 What next (#102)**: series pull 30, genre fit 20, friends' ratings 20, palate cleanser 15, season 10, waiting time 5. The server ranks without friends; the page reranks with them.
- **BOO-77 Finish date (#84)**: the book's own pace, scaled by how much faster you usually finish from the same point; a range from the 20th to 80th percentile. New hook `rh.goFact`.
- **BOO-78 Give-up risk (#91)**: four explained signals plus the 7 most similar past reads. No flag at all without two given-up reads to learn from. The demo gains Vanity Fair as a stalling current book.
- **BOO-80 Challenges (#98)**: set in Admin → Challenges, defaults are the ticket's examples, plus a genres kind. Visitors' progress counts only what they may see.
- **BOO-84 On this day (#87)**: every earlier year, not just 1, 2 and 5. Falls back to books on the go that day.
- **BOO-86 Life events (#103)**: a new privacy flag `life_events`, off in every preset. The iCal parser keeps all-day and 20h+ events and doesn't expand repeats. New hook `rh.markDays`.
- **BOO-85 Weather (#104)**: hidden from visitors without exact days or the diary, since daily weather hints at where you live. The card says it's correlation, not cause.
- **BOO-87 Sleep (#105)**: docs only, `docs/spikes/sleep.md`.
- **BOO-97 Catalogue (#82)**: first published year (BC allowed) and author country; a blank field goes back to the looked-up value.
- **BOO-96 Day by day (#85)**: two panels on one date axis instead of two y-axes; also fixed repeated x-axis labels on long reads.
- **BOO-93 Taste match (#88)**: with 3+ co-rated books, ratings take 20% (genres 40, authors 24, books 16); otherwise the old weights.
- **BOO-98 Streaming vs books (#90)**: a card on Money; subscriptions in another currency are left out, since there are no exchange rates.
- **BOO-92 Wrapped (#93)**: new `rh.wrappedSlide` extension point and a "Your year on screen" slide; the share image stays about reading.
- **BOO-95 Stats worker (#94)**: on an 80-year synthetic library, requests during a stats run waited up to 7 s before and at most 81 ms after. A crashed worker's jobs rerun in-process; after 3 crashes it stays in-process.

### Coordinator, combined PR #106

Twelve merges conflicted, all parallel additions (README, docs/api.md, app module, config, privacy lists, demo data); both sides were kept. Fixes in their own commit: the two `bookKeys` imports, the demo friends' ratings clash, admin menu order (Challenges 52, Feeds 56, Widgets & devices 55) and the README tab order.

---

## Run 1: the BOO backlog (17 Oct 2026)

Everything on the [BOO board](https://tasks.kiss.cat/BOO) was worked through by parallel agents, with one PR per ticket (or per small group). About 60 PRs (#13 to #74) were merged once CI was green, and each was checked on top of main first. This file records the decisions made along the way, so you can review them and reverse any you disagree with.

### Status

63 of the 64 tickets are **DONE**. **BOO-54** (Anna's Archive) is in REVIEW: I decided not to build it, for the reasons below, and it needs your confirmation.

| Epic                             | State                                                |
| -------------------------------- | ---------------------------------------------------- |
| EP-1 Showpiece visualisations    | Done (BOO-1 to 6)                                    |
| EP-2 Reading analytics           | Done (BOO-7 to 19, 39)                               |
| EP-3 Highlights & notes          | Done (BOO-20 to 25)                                  |
| EP-4 Book metadata enrichment    | Done (BOO-26 to 29, 55)                              |
| EP-5 Friends & comparison        | Done (BOO-30 to 34, 58, 59)                          |
| EP-6 Visual polish               | Done (BOO-35 to 38)                                  |
| EP-7 Money & value               | Done (BOO-40 to 46)                                  |
| EP-8 Other media verticals       | Done (BOO-47 to 52)                                  |
| EP-9 Integrations & data sources | Done (BOO-53, 57, 64); BOO-54 deliberately not built |
| EP-10 Platform & architecture    | Done (BOO-56, 63)                                    |
| EP-11 Admin & privacy            | Done (BOO-60 to 62)                                  |

### Things for you

- **BOO-54 Anna's Archive**: confirm the decision not to build it (`docs/integrations.md`), then move the ticket to DONE.
- **Moon+ notes table**: the layout comes from open-source exports, not a real `mrbooks.db`. Check `docs/moonplus-backup.md` against one of your backups.
- **External services**: the sandbox couldn't reach Open Library, Wikidata, TMDB, Tautulli, Audiobookshelf, an Arr instance or a second real installation for federation. All of them were built against their documented APIs and tested with mocks, so give each a real run.
- **Screenshots**: the committed ones have letter tiles instead of covers. Run **Actions → screenshots → Run workflow**, check the artifact and commit it to get versions with real covers.
- **Docker**: the image build now runs only when started by hand (Actions → docker). To build it on main again, add `push: branches: [main]` to `.github/workflows/docker.yml`.

### Suggested follow-ups

- A "watching" slide in Wrapped (Wrapped has no extension point yet).
- Score rating agreement in taste match.
- Unify the title/author matching duplicated in `src/arr/match.ts` and `src/imports/merge.ts`.
- Move server stats to a worker thread for very large libraries.
- Redesign the book page "Day by day" chart, which has two y-axes.
- Add inputs for published year and author country to the admin catalogue editor.
- Compare streaming cost per hour with Money's book benchmarks.

### Coordinator decisions

- **CI minutes**: the Docker build moved to its own manual-only workflow (`.github/workflows/docker.yml`, run from the Actions tab). To re-enable it on main, add `push: branches: [main]`. The test workflow also stopped running twice per PR: push now triggers only on main, and PRs cover branches. (PR #13)
- **Foundation first** (PR #14): a feature-script registry (`web/features/*.js` is auto-injected, plus `rh.card`, `rh.bookCard`, `rh.extend`, `rh.tab` and `dash.file`). This lets about 40 new views be built in parallel without every PR conflicting in `charts.js` and `index.html`.
- **Branches**: there is one branch per ticket or ticket group, beyond the session's designated branch, because you asked for many parallel PRs. I merge with merge commits (no squash) once CI is green.
- **Network**: the sandbox blocks openlibrary.org, wikidata.org, TMDB and annas-archive.org. Lookups are built against the documented APIs and tested with mocks. They are not verified against the live services, so give them a real run.
- **Node**: the container has Node 22 and the tests need 24 (CI uses 24), so I installed 24 with nvm. No repo change was needed.

### BOO-47 Media survey (PR #17, docs/media-verticals.md)

- **One app with media tabs**, not separate dashboards. TV & film gets a new tab, with new link kinds `show` and `film`.
- **Data files** `media_items.json`, `media_runs.json` and `media_daily.json` mirror books, reads and daily. `media_sessions.json`, `media_parts.json` and `media_meta.json` are added alongside them. Ids are prefixed (`tv-…`, `film-…`, `show-…`).
- **A TV "book" is a season** and the show is its series. A film is one item, with its franchise as the series.
- **A new watch-through starts after a 180-day gap.** An episode counts as watched at 90% or more of its runtime. Sessions under 2 minutes are dropped.
- **Build order**: Netflix CSV, then Plex via Tautulli (admin-set URL and key), then the TV views, then cross-media. Audiobookshelf, Spotify, Last.fm and Steam come later. Podcasts come out of the Spotify and Audiobookshelf imports.
- **Rejected**: scraping, unofficial APIs that need your password, and treating OPML lists as podcast history. TMDB posters are optional and fail soft.
- **Unverified**: the Netflix CSV column names, Audible via Amazon's data request, and Trakt's free-tier limits.

### BOO-38 Chart style (PR #21) and BOO-36 Transitions (PR #31)

- **Palette**: replaced it with a colour-blind-validated palette, stepped separately for light and dark. The old teal and pink were nearly indistinguishable for deuteranopia. Every chart now looks a little more saturated.
- **Bars**: capped at 24px wide, rounded at the data end, with 2px gaps in stacks. Dots are ringed, and hovering washes the row or column. Average lines stay dashed. Genre chips show their colour as a dot and keep the text in ink.
- **Left as is**: the book page "Day by day" chart, which has dual axes (an anti-pattern). Fixing it needs a redesign, so it's a follow-up.
- **Transitions**: tabs slide, pages fade up, bars grow, dots pop and lines draw in, all in 220ms or less. They run only on a new view, new data or that card's own setting change, never on resize. Reduced-motion turns them all off. A range change redraws the chart and animates it in rather than morphing the old shapes.

### Book shapes: BOO-7, 8, 9, 14, 15 (PRs #19, #25, #30, #34, #35)

- **BOO-7 shapes**: devoured, slow burn, stop-start and rescued, plus abandoned (no opening for 60+ days) and reading, so every read gets one. The rules, in order:
  - **rescued**: a break of 28+ days between 5% and 95%.
  - **devoured**: finished within 3 days; or within 14 days, opened on 60%+ of them, with 40+ min a day or finished within 8 days.
  - **stop-start**: opened on under 45% of days, or 3+ breaks of 4+ days.
  - **slow burn**: everything else.

  The thresholds live in the `SHAPE` constant in calcs.js. The summary card is on the Genres tab and the sparkline is on the book page.

- **BOO-7 demo**: books now have reading styles that vary by genre. There are 4 re-reads, about 15% faster the second time, so every demo number changed.
- **BOO-8**: "pace" means progress per reading day relative to that read's own average, not wpm, so long and short books weigh the same.
- **BOO-9**: first reads only. Books opened in the last 60 days are excluded, so no Kaplan–Meier is needed.
- **BOO-14**: words come from each read's own log. An outlier means 2× away from your own log-log fit.
- **BOO-15**: each re-read is compared with the first read, and a read needs 30+ timed minutes to count.

### BOO-11 Series pull (PR #36), BOO-6 Ridgelines (PR #33), BOO-22 Highlight density (PR #32)

- **BOO-11**: only real n → n+1 hops count. The gap runs from the first finish of book n to the first start of n+1. Waiting next books show as open dots with the gap so far. A gateway book is the first book started by any author with 2+ books read.
- **BOO-11 for Arr (BOO-64)**: the `series_next` calc gives the next book per series, with status `not_in_library` meaning "request this one". Moon+ only lists books you have opened, so the next book usually isn't in the library.
- **BOO-6**: ridgelines for minutes per day by year (Timeline tab) and wpm by genre (Speed tab). Speed is weighted by minutes, markers are medians, and the minutes axis is capped at the 98th-percentile day.
- **BOO-22**: fixed 5% bins rather than smoothing, because most books have only a handful of highlights. The % positions are estimated from progress on the day each highlight was made.

### Showpieces: BOO-1 Bookshelf (#16), BOO-2 Tree rings (#22), BOO-5 Streamgraph (#26)

- **BOO-1**: Overview stays the home page and the Bookshelf is a new tab right after it. There is one spine per read, not per book, on the shelf of the year it ended. Width is words^0.6, so a 450k-word book doesn't swamp a shelf. Height is hours. Book length is estimated from words read and progress. The book you're reading now gets a ribbon.
- **BOO-2**: colour is by genre, not by book, because 65 books on 8 colours would repeat. Spoke length uses a square-root scale capped at the 99th-percentile day.
- **BOO-5**: replaced the "Genre mix by year" chart in place. It shows hours per genre per month rather than finished books per year. The streams are lightly smoothed, and the tooltip shows the real hours. The unused `genre_year` calc was removed.

### Patterns & time: BOO-10, 12, 13, 16, 39 (PRs #29, #38, #24, #18)

- **New "Patterns" tab** holding the chord diagram, series pull, gateway books, hangover and the heatmap explorer.
- **BOO-16**: averages are per calendar day over the whole logged span. There are no season labels, because they depend on the hemisphere.
- **BOO-39**: one configurable explorer with 7 presets, 11 dimensions and 7 measures.
  - It shows the top 15 rows (10 on a phone) with the rest grouped as "Other (n)", and the top 12 columns.
  - Rows sort by total, first read or A–Z; there is no clustering.
  - On a phone the labels stay sticky while the grid scrolls sideways.
  - wpm cells with under 15 timed minutes are left blank.
  - It remembers your choices between visits.
- **BOO-13**: a book is "on the go" from the first to the last day of a read. Pace is days per 100k words, and the style thresholds are 1.2 and 1.6 books on average.
- **BOO-10**: "next" is the next read started, so overlapping reads still count. Author mode shows the top 9 authors plus Other.
- **BOO-12**: there are no ratings, so speed stands in for "loved" (the fastest quarter counts as devoured). The gap runs to the next day a different book was opened. This can switch to Goodreads ratings once they're imported.

### Highlights: BOO-20 to BOO-25 (PRs #23, #32, #37, #39, #40)

- **Unconfirmed against a real backup.** The `notes` table layout comes from open-source Moon+ note exports, not a real mrbooks.db. The parser reads only the columns a backup actually has and never fails on missing ones. Please check `docs/moonplus-backup.md` against one of your backups.
- **"% through the book" is an estimate.** Moon+ stores a chapter and character offset but not the book's length, so each highlight is placed within the progress made on the day it was written.
- **Time zone**: highlight times use the server's TZ. Colours are `#rrggbb`. `kind` is note, highlight or bookmark.
- **Demo**: real public-domain quotes for 33 books, from a separate random seed so the rest of the demo didn't change.
- **BOO-23**: the quote of the day is picked by a hash of the viewer's date, with an "Another" button.
- **BOO-24**: I wrote the word-cloud layout myself (spiral, horizontal only, English stop words) rather than adding a dependency.
- **BOO-25**: highlight, note and bookmark times stand in for reading times, and the card says so. Parts of the day are 05–12, 12–17, 17–21 and 21–05.

### Records & story: BOO-19 Odometer (#15), BOO-18 Records (#20), BOO-17 Forecast (#28), BOO-3 + BOO-37 Wrapped (#41)

- **BOO-19**: units are the King James Bible (783k words), Lord of the Rings (481k), War and Peace (587k) and 1 m of shelf (≈4M words). Milestones are round numbers. Words come only from the daily log, so the card says "since <first day>".
- **BOO-18**: 9 records. "New record" means broken within 30 days of the backup date.
- **BOO-17**: the projection uses your last-365-day pace with no seasonality, and the band is a rough 80% range. Last year is lined up by month and day. Books with unknown progress are excluded from "time left".
- **BOO-3/37 Wrapped**: opened by a Play banner on the year page (no new tab). On phones it's swipeable stories and on desktop a scroll story, with a toggle between them. Stories don't auto-advance. It ends with a 1080×1350 canvas card offering a PNG download and the browser's share sheet.
  - "Longest binge" means the biggest single day.
  - Other pages were not turned into scrollytelling, because they're dashboards rather than stories.
- **Tests**: added `test/support/feature-calcs.ts`, which runs feature calcs in Node for unit tests.

### Metadata: BOO-55 ISBN (#42), BOO-26 Enrichment (#44), BOO-27/28/29 Origins tab (#46), BOO-4/35 Cover colours (#49)

- **BOO-55**: Moon+ has no known ISBN column. The import reads one only if a column named `isbn*` or `identifier` exists. Catalogue entries take `isbn`/`isbn13`/`isbn10` and `work_id`, checksum-validated and converted between 10 and 13 digits. Copies count as one book when they share title and author, a `work_id` or an ISBN-13. There is a new "No ISBN" data check.
- **BOO-26 cache and settings**: results go in `library/metadata.json`, with misses retried after 30 days. It runs after the cover lookup with the same pause between requests. It's on by default; `METADATA_LOOKUP=off` turns it off, and `WIKIDATA_URL` is configurable.
- **BOO-26 lookups**: books are found by ISBN first, otherwise title plus surname. The author's country is citizenship, else the birthplace's country today, else what a historical state became. Gender comes from P21.
- **BOO-26 overrides**: hand-entered values always win, per book or via a new `catalogue.authors` map. No automatic merging by looked-up work id, since a fuzzy search could join different books; those are flagged in a "Same work?" data check instead.
- **Not verified live**: the network is blocked here, so this is built against the documented APIs and mocks. Please give it a real run.
- **BOO-27/28/29**: a new "Origins" tab. The map uses vendored world-atlas 110m data with topojson-client (ISC; Natural Earth is public domain), lazily loaded, 115 KB. Gender balance counts distinct books per year.
- **BOO-4/35**: cover colours are worked out in the browser with a canvas and cached in localStorage. This avoids a JPEG decoder dependency on the server and works on the static demo. Books with no cover use their genre colour, striped. Book page tints are contrast-checked (3:1 accent, 7:1 body text). BOO-4 is colour strips per year; a separate wall-of-covers view was not built.
- **Follow-up**: ISBN fields in the admin catalogue editor, once the admin view (#27) is on main.
- **BOO-54 Anna's Archive**: not built, because it has no stable public metadata API (see the integrations section).

### Admin & privacy: BOO-60 Admin page (#27), BOO-61 Logs (#43), BOO-62 Privacy tier (#50)

- **BOO-60**: the admin page lives at `#admin` and `#admin/<section>`. It's a hidden page, not a tab, so sections can be bookmarked and the back button works. The sections are Data, Sync & logs, Access & privacy, Catalogue and Covers.
  - The catalogue is edited per book, which updates all of that book's files.
  - I added a manual cover upload, since a failed lookup had no fix otherwise.
  - `/upload` and `#upload` now redirect to `#admin`.
  - Other features add sections through `rh.adminSection`.
- **BOO-61**: everything is written to `library/activity.jsonl` (types sync, rebuild, upload, cover, prune and settings), rolling over at 2 MB. `update.log` is kept.
  - The "sync stopped" warning fires after more than max(48 h, 3× the usual gap), once there are syncs on 3+ days.
  - Wrong WebDAV password attempts are logged at most once per 10 minutes.
- **BOO-62 policies**: separate policies for public and read-password visitors. Presets are Everything, Everything but exact dates and Taste only. Defaults keep everything visible except highlights for the public, so existing installs don't change.
- **BOO-62 enforcement**: filtering happens on the server for `/data/*`, `/api/covers`, `/covers` and `/api/config`. It works generically (on `book_id` rows and date-named fields), so new data files are covered too. `reading_history.json` and `last_build` are admin-only.
- **BOO-62 details**:
  - Hiding streaks coarsens daily data to weeks, because hiding them only in the page would leak.
  - "Reading now" means read in the last 90 days.
  - Private books apply to every role.
  - "Preview as visitor" uses a cookie that works only with an admin session.
  - Cards hide rather than break; small core fallbacks were added for missing daily data.
- **BOO-62 not done**: roles for friends and federated installations, which don't exist yet. The friends track will add them.

### Coordinator: main broke briefly (fixed in PR #51)

- #42 (ISBN) and #27 (admin) were each green but failed `tsc` together on main. The fix adds an ISBN field to the admin editor and keeps ISBNs and work ids on save. Lesson applied: after merging two server PRs back to back, I now run the full suite on main before merging more.
- **Metadata follow-up (#44)**: the admin catalogue save also keeps `published_year`, `pages`, `author_country` and `author_gender`. Metadata lookups are recorded in the activity log as a new `metadata` type. Inputs for those fields in the editor are an optional follow-up.
- **Privacy follow-up (#50)**: an anonymised private book keeps only reading fields; every other field (ISBN, metadata, and anything added later) is nulled.

### BOO-63 tooling (PR #54)

- **`npm run screenshots`**: Playwright 1.63.0 shoots every tab (found at runtime) plus book, author, year and Wrapped pages, in light and dark plus phone width. It uses reduced motion and fails on any console error. `DEMO_TODAY=YYYY-MM-DD` makes the demo repeatable.
- **CI**: screenshots are not taken on push, to save minutes. `.github/workflows/screenshots.yml` is manual-only and uploads an artifact (kept 7 days) rather than committing, so a person checks the pictures first.
- **Docs**: added a PR template with a "README, screenshots and demo updated" checkbox, and `docs/contributing.md`.
- **Covers**: the committed screenshots have letter placeholders instead of covers, because the sandbox can't reach Open Library. See "Things for you" for how to get versions with covers.

### Money: BOO-40 (#45), BOO-41/42/43 (#48), BOO-44/45 (#52), BOO-46 (#55)

- **BOO-40 storage**: prices live in their own `library/prices.json`, keyed by book id, keeping title and author so books bought but never opened can be listed. The page gets a home-currency copy without notes.
- **BOO-40 currencies**: one home currency plus a fixed exchange-rate table you edit. There are no live rates. A price in a currency with no rate is left out, with a warning in admin.
- **BOO-40 bundles**: a bundle's price is split across its books by word count, or evenly when lengths are unknown.
- **BOO-40 price lookup**: not built. There's no free source for ebook store prices, and what you actually paid is only in your order history.
- **BOO-40 CSV import**: matches on ISBN, then title and author (forgiving), then a unique title. It understands `£4.99` and British date order, and shows a preview before anything is saved.
- **Benchmarks** (editable, labelled rough): streaming £0.40/h, games £1.50/h, hardback £2.50/h, cinema £6/h, theatre £20/h.
- **BOO-41**: subscription fees count on the 1st of each month they run. Free, library and gift books count as £0.
- **BOO-42**: cost per hour uses lifetime hours across all reads. Rankings include paid books with 30+ minutes only.
- **BOO-43**: the "cost to finish a series" is a floor: gaps up to the highest number you own × your average price in that series.
- **BOO-44**: subscription books use a `list_price` field for "what buying would have cost", and only reading during subscription months counts.
- **BOO-45**: "given up" uses the same rule as "Left unfinished". "Never opened" means priced but not in the Moon+ data.
- **BOO-46**: the hourly rate is a per-browser setting that is never sent to the server. It defaults to £12.71/h (about the UK minimum wage), labelled as a stand-in. The Money tab always shows, because the time-value cards need no prices; the price cards hide when money is held back.
- **Core fix**: `.rh-card{display:flex}` overrode the `hidden` attribute, so hidden cards showed as empty boxes.
- **Privacy fix (#56)**: private books bought but never opened were leaking their title and author in `prices.json` when money was visible. Now every id in `private_books` is private wherever it appears. Anonymised price rows keep their amounts, so totals still add up.

### BOO-56 Backend stats & API (PR #61)

- **One implementation**: the page's own calc scripts run on the server in a Node vm sandbox, so nothing was ported to TypeScript. All 67 calcs give identical results to the browser, checked by tests and in real Chromium.
- **Per viewer**: results are computed separately for admin, public and reader from the same filtered data each one is served, so stats can never leak hidden data. Preview-as-visitor gets the visitor's numbers.
- **API** (`docs/api.md`): `/api/stats`, `/api/stats/all`, `/api/stats/page`, `/api/stats/<calc>`, `/api/stats/year/<YYYY>` and `/api/author/<name>`. Responses are gzipped, answer 304 when unchanged, and carry `X-Stats-Version`.
- **Page**: it uses the server bundle and falls back to computing in the browser; `?stats=client` forces that. Calcs that read params or the DOM stay client-side automatically (none do today). The page bundle leaves out big lists that are quick to build (~53 KB versus 140 KB gzipped).
- **Storage**: results are cached in memory per viewer type, with no SQLite. They're warmed after each rebuild.
- **Speed**: first render on the demo went from 370 ms to 222 ms on desktop, and from 961 to 777 ms with 4x CPU throttling.
- **Static demo**: the API responses are pre-rendered as files.
- **Follow-up**: calcs run on the main thread, so a worker thread would help very large libraries.
- **Coordinator, merge order**: I merged server stats (#61) before the media, Goodreads and friends stacks. Each of those then merged main itself and made its calcs pass the server/browser parity test, rather than me resolving conflicts inside their code.

### TV & film: BOO-49 Netflix (#47), BOO-48 Tautulli (#53), BOO-50 TV views (#57), BOO-51 Cross-media (#63)

- **BOO-49 Netflix**: upload the CSV or the zip Netflix sends. With several profiles, nothing is imported until you choose which in admin.
  - An episode or film counts as watched at 90% or more, with fallbacks when the position is missing. Autoplay previews are dropped.
  - Media settings live in `library/media/settings.json`, because `settings.json` gets rewritten by the access service.
  - TMDB is optional and fails soft.
- **BOO-48 Plex**: via Tautulli only. Plex's own history API has no time watched, so there's no direct-Plex importer.
  - It polls every `MEDIA_POLL_MINUTES` (default 60) for one chosen Plex user. Switching server or user clears the cache.
  - Posters come through Tautulli's image proxy. The API key is never returned to the page.
- **BOO-50**: a TV & film tab, plus show and film pages with new `show` and `film` link kinds. A season opens its show page.
  - Book calcs are reused on media rows through `dash.reuse`.
  - "Dropped" means in progress with no episode for 60 days.
  - Streaming cost per hour uses its own subscriptions setting in `media_money.json`, hidden when money is. Netflix and Plex are matched to subscriptions by name.
- **BOO-51**: a "Reading and watching" card on the Overview, "Do TV weeks crowd out reading?", "Book to screen" (matched by title or a catalogue `book` field), and a year-page card.
  - The combined year in review is a card on the year page, not new Wrapped slides, because Wrapped has no extension point. A "watching" slide in Wrapped is a follow-up.
- **Demo**: a made-up Netflix history of classic silent and mid-century films plus invented shows.
- **BOO-52 (#67)**: Audiobookshelf was chosen as the next source over Spotify. It uses the same URL-plus-token route as Tautulli and gives time and position per session. Audiobooks count as "listening" in the cross-media views. Podcasts and a separate audiobook tab are deliberately left out. `docs/media-verticals.md` §7 lists the steps for adding further sources.

### Integrations: BOO-53 Goodreads (#58), BOO-57 Kobo/Kindle (#66), BOO-54 Anna's Archive (#68), BOO-64 Arr (#71)

- **BOO-53 upload and storage**: a new Admin → Imports section takes the Goodreads or StoryGraph CSV; the Moon+ upload stays `.mrpro`-only. Imports are stored normalised; the CSV isn't kept.
- **BOO-53 matching**: by ISBN, then by title (series suffix, subtitle and leading article removed) plus surname.
- **BOO-53 Goodreads-only books**: they get one finished read on the Date Read with no daily rows.
  - They count in books, genres, authors and series, but not in minutes, speed, streaks or heatmaps.
  - On their book pages the day cards are hidden.
  - To-read books are skipped.
- **BOO-53 views and settings**:
  - New views: rating vs speed, ratings by genre, "do you rate devoured books higher", and a rating card on book pages.
  - A new privacy flag `ratings` is on in every preset, since ratings are taste.
  - The first import's rating wins.
  - An admin download exports finished books as a Goodreads-import CSV.
- **BOO-57 file detection**: SQLite means Kobo; `==========` blocks mean My Clippings; a CSV with ASIN and milliseconds means Kindle reading sessions; a CSV with ASIN and title is a title list.
- **BOO-57 Kobo**: daily data comes only from `AnalyticsEvents`, which the device clears on sync. Without it, a book gets one read with its total time.
- **BOO-57 Kindle**: reading sessions become minutes per day, but are never marked finished, because Amazon records no progress.
- **BOO-57 merging and import-only builds**: Moon+ wins for any day it has. Imported highlights go into `highlights.json`. The dashboard can now be built from imports alone, with no Moon+ backup. Data comes in by upload only.
- **BOO-54 Anna's Archive**: not built. There's no stable metadata API, the dumps run to hundreds of GB, the licence is unclear, it carries legal and reputational risk, and Open Library (CC0) already covers the need. `docs/integrations.md` says what would change that. The ticket stays in REVIEW for you to confirm.
- **BOO-64 Arr**:
  - It targets the Readarr v1 API, which Bookshelf and the other forks keep; LazyLibrarian isn't supported.
  - Books go to the first root folder with its default profiles.
  - The URL and key live in `settings.json` under `arr`, and the key is never returned to the page.
  - Buttons show only for the admin, and never in visitor preview.
  - "Get next in series" uses `series_next`. "Get the rest of this author" sets all of their books as wanted.
  - Requests are logged and recorded, and a book page notes when a requested book arrives.
  - The friends' favourites button isn't wired yet.
- **Fix in #71**: `AccessSettingsService.save` used to rewrite all of `settings.json`, wiping other features' sections. It now keeps them.
- **Follow-up**: title/author matching is duplicated in `src/arr/match.ts` and `src/imports/merge.ts` and could be unified.

### Friends: BOO-30 (#59), 31 (#60), 32 (#62), 33 (#64), 34 (#65), 59 (#69), 58 (#72)

- **BOO-30 profiles and sharing**: a friend is a profile in `library/friends/<slug>/` with the same row shapes as your own data. You share by exporting one JSON file (`moonreader-dashboard/share` v1, described in `docs/friends.md`) filtered by a new "friends" privacy role.
  - By default friends get everything except money and highlights.
  - Friends' data is visible only to the admin by default; you can open it to readers or the public.
  - Uploaded rows are cleaned again on the way in.
  - Any calc can run on a friend's data through `dash.calcWith`.
  - Books are matched across libraries by ISBN, then work id, then normalised title and author.
- **BOO-31**: the taste-match score is 50% genre cosine, 30% author overlap and 20% books in common. Goodreads ratings are shown but not scored. Scoring rating agreement is a possible follow-up.
- **BOO-32**: one progress lane per reader on the book page, by date or from each reader's day 1. Progress never goes down.
- **BOO-33**: a "favourite" is a book a friend devoured or re-read. They're ranked by your genre share plus a bonus if you know the author. There's an admin-only Arr "Get it" button.
- **BOO-34**: a 12-month calendar with a band per person. Leaderboards cover each person's own last 12 months, need two people, and are opt-in per stat.
- **BOO-59 auth**: federation uses a per-follower random bearer token, stored hashed, revocable at once, and collected once with a claim secret. HTTPS is assumed; `http://` is allowed for home networks.
- **BOO-59 not ActivityPub**: it's built for public push feeds with key management and gives no per-follower privacy.
- **BOO-59 sharing**: friends pull the share file rather than `/api/stats`, because the friend views need raw rows. You can offer a follower everything, stats only or chosen views, and hide books per follower.
- **BOO-59 refresh**: every `FEDERATION_REFRESH_MINUTES` (default 60). A revoked friend's data is deleted; an offline friend is shown "as of" the last pull.
- **BOO-58 book clubs**: clubs and comments live on the host's server. Comments stay hidden until you reach their position, filtered server-side.
  - Federated members self-report their progress.
  - Commenting from your own dashboard needs a mutual follow.
  - The schedule is in % per week, since there's no chapter data. "On track" means within ±5 points.
- **Stats**: the friends role was added to the per-role stats. Calcs that take friends' data stay client-side.
- **Coordinator mistake, fixed in #74**: I merged the stacked friends PRs (#60 to #72) without retargeting them to main first, so they merged into each other's branches and only #59 reached main. PR #74 brings the top of the stack (`boo-58-book-club`, already tested on main) into main.

### BOO-63 README & demo sweep (PR #73)

- **README**: rewritten to cover every tab, page, import, admin section, privacy audience, setting (including the new env vars), the API, and development. Config files were synced too. The README wrongly said port 8080; docker-compose publishes 9080.
- **Screenshots**: all retaken, with new ones for TV, Money and Friends. They still have letter tiles instead of covers (see "Things for you").
- **Demo sweep fixes**:
  - "1 days" now reads "1 day".
  - The forecast's "0 books a day" now reads "a book every N days".
  - `#tab` links no longer open scrolled under the sticky bar.
