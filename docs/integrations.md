# Integrations: what the dashboard talks to, and what it won't

Every outside service the dashboard uses is optional and fails soft: without it, the
dashboard works from your reading data alone (a Moon+ backup, your imports, or both). This
page records which services were considered, which were built, and why some were not.

| Service | Used for | How | Status |
| --- | --- | --- | --- |
| Open Library | covers, first-published year, pages, ISBNs | live lookup, one request a second, cached in `library/` | built (`COVER_LOOKUP`, `METADATA_LOOKUP`) |
| Wikidata | author country and gender | live lookup, cached | built |
| Open Library, Wikidata | authors' other books and the rest of your series | live lookup after the metadata lookup, one request a second per service, cached in `library/bibliography.json` | built (`BIBLIOGRAPHY_LOOKUP`, BOO-103) |
| Goodreads, StoryGraph | ratings, shelves, books read elsewhere | your export file, uploaded in Admin → Imports | built (BOO-53) |
| Goodreads | a link from each book page to the book there | the Book Id from your export, else ISBN or title (no request is made) | built (BOO-65) |
| Kobo, Kindle | reads, days and highlights from e-readers | your files, uploaded in Admin → Imports | built (BOO-57) |
| KOReader | reads, days, minutes and progress from its reading statistics | `statistics.sqlite3`, uploaded in Admin → Imports | built (BOO-101) |
| Your *arr book manager (Readarr API: Bookshelf…) | asking for the next book in a series or the rest of an author | your own instance, admin only | built (BOO-64) |
| Anna's Archive | filling gaps in book metadata | — | **not built** (below) |

## Bibliography lookup (BOO-103)

After the metadata lookup, the dashboard looks up the other books by the authors you read,
and the rest of the series you've started, so the page can show what you haven't read yet.
`BIBLIOGRAPHY_LOOKUP=off` turns it off; it is always off when `METADATA_LOOKUP` is.

- **Who is looked up:** each author with a finished book or two or more books, and each
  author of a series you've started (only that series is then shown), most hours read first,
  at most 40 a round. A co-written book counts for its first author ("King, Stephen &
  Straub, Peter" is Stephen King), as the rest of the dashboard matches authors. Each
  author is looked up again after 30 days; one Open Library can't find is retried after 30
  days.
- **What is sent:** to Open Library, the author's Open Library id (from the metadata
  lookup), or for an author without one, their name (`/search/authors.json?q=`, taking the
  first result whose name matches); then `/search.json?author_key=…` for their works, most
  editions first. To Wikidata's SPARQL endpoint (`query.wikidata.org`), the author's
  Wikidata item, asking for works with them as author (P50), their series (P179), number in
  the series (P1545) and publication date (P577). Nothing about your reading is sent.
- **What is kept:** works with two or more editions and a first-published year, without study
  guides, summaries, SparkNotes, box sets, omnibuses, collections or "complete works", and
  without titles only published in other languages, one per title. Wikidata adds the series
  and number; a work only Wikidata knows is kept when it's part of a series. The results go
  in `library/bibliography.json` (misses in `library/.bibliography-misses.json`); delete an
  author's entry to look them up again.
- **Rate limits:** one request a second (`COVER_PAUSE`) to each service, in the background.
  After three failures in a row it stops for the round and tries again after the next
  rebuild. Shutting down stops it at once.
- **Metadata only:** titles, years, edition counts, series and an ISBN. There are no links
  to book files and nothing is downloaded. It is logged in Sync & logs under Metadata.
- **Results:** a new `library/bibliography.json` rebuilds the data, which writes
  `data/bibliography.json` (see [api.md](api.md#bibliography-books-you-havent-got)).

## Your book manager: the *arr stack (BOO-64)

Admin → Book manager connects the dashboard to a book manager in your own *arr stack.
Readarr itself is retired; forks such as **Bookshelf** keep its v1 API, and that API is
what the dashboard speaks (`/api/v1/book`, `/api/v1/author`, `/api/v1/book/lookup`,
`/api/v1/queue`, `/api/v1/command`, with the `X-Api-Key` header).

- **Admin only.** The URL and API key are kept in `library/settings.json` and are never sent
  to the page, to visitors, readers or friends. Every call goes from the dashboard's server
  to your instance (`/api/admin/arr/*`, admin-only endpoints), and none of its buttons or
  badges are drawn for anyone else, nor while the admin previews as a visitor.
- **Requests only.** The dashboard asks *your* book manager to monitor and search for a book
  or an author; the book manager does whatever searching and downloading you've set it up to
  do. The dashboard never searches for, links to or downloads books itself.
- **What it does:** status badges (available, downloading, wanted, in your book manager) on
  book, series and author pages; **Get next in series** where the next number isn't in your
  library (from the `series_next` calc); **Get the rest of this author** on author pages,
  which adds the author with all their books wanted, or, for one already there, wants their
  missing books and searches. Books on the server that you haven't read are marked.
- **Matching:** ISBN first, then title and author (surname), then series and number.
- **Logged:** every request (and failure) is in Sync & logs under Requests, and kept in
  `library/arr-requests.json`. A book page notes when a requested book has arrived.
- Not done yet: requesting friends' favourites (needs the friends feature).

## Anna's Archive (BOO-54)

**Decision: no integration. There is no live lookup, no dump import, and the dashboard
never links to Anna's Archive.** To fill in a book's ISBN, year or page count by hand, set
the ISBN in Admin → Catalogue, or add `published_year` and `pages` to its `catalogue.json`
entry (see "Publication years, pages and authors" in the README); what you set always wins
over a lookup.

What was asked for: Anna's Archive's open *metadata* (ISBNs, editions, page counts,
publication years, publishers, covers) to fill gaps Open Library leaves. Metadata only. The
dashboard was never going to search for, link to or download book files.

Why not:

- **No stable public metadata API.** Anna's Archive offers no documented, versioned
  lookup API for metadata. Its search pages can change at any time and its domains move
  regularly. Scraping them would break without warning and would put load on a site that
  asks for it not to be scraped.
- **Bulk dumps are the only supported route, and they are far too big for this.** Its
  metadata comes as bulk dumps (torrents of the Anna's Archive Containers and the
  Elasticsearch/MariaDB exports that join Open Library, ISBNdb, Google Books, WorldCat,
  Library Genesis, Z-Library and others). They run to hundreds of gigabytes. Downloading,
  indexing and keeping them up to date would dwarf everything else this self-hosted
  dashboard does. A "point it at a local dump file" option was looked at too: the formats
  are large, nested and change between releases, so it isn't the small, cheap feature it
  might seem. A reader with a few hundred books gains little from it over Open Library.
- **Unclear licence.** The dumps mix records from sources with different terms. ISBNdb and
  WorldCat in particular are commercial databases whose records were collected without a
  licence to redistribute them. Anna's Archive doesn't publish a licence for the combined
  metadata. Building on it would leave anyone running the dashboard (and this project)
  unsure whether they may use or republish what it returns.
- **Reputational and legal risk.** Anna's Archive is first of all a shadow library: it
  exists to distribute copyrighted books, and courts have ordered its domains blocked in
  several countries. Even a metadata-only feature would tie the dashboard's name to it, and
  could make the project unwelcome on hosts and in app listings. One accidental link to a
  file page would cross from metadata into helping distribute copyrighted works.
- **Open Library already covers the need.** Most of the same bibliographic data, from
  most of the same upstream sources, is available openly from Open Library, under clear
  terms (its data is public domain / CC0). The metadata lookup (BOO-26) uses it, and books
  it can't find can be filled in by hand.

**What would change this:** Anna's Archive (or a reputable mirror of just its metadata)
publishing a documented metadata API, or a small metadata-only export, under a clear
open licence. Then a lookup could sit next to the Open Library one, used only for books
Open Library doesn't know, matched by ISBN first and cached like covers, and still never
linking to files.

### Rules for any future integration

- Metadata only: never search for, link to or download book files.
- Opt-in or fail soft, behind a setting, with results cached in `library/`.
- One request a second or slower; respect each service's terms and rate limits.
- Prefer sources with clear open licences (Open Library, Wikidata) over aggregators.
