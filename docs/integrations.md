# Integrations: what the dashboard talks to, and what it won't

Every outside service the dashboard uses is optional and fails soft: without it, the
dashboard works from your Moon+ data alone. This page records which services were
considered, which were built, and why some were not.

| Service | Used for | How | Status |
| --- | --- | --- | --- |
| Open Library | covers, first-published year, pages, ISBNs | live lookup, one request a second, cached in `library/` | built (`COVER_LOOKUP`, `METADATA_LOOKUP`) |
| Wikidata | author country and gender | live lookup, cached | built |
| Goodreads, StoryGraph | ratings, shelves, books read elsewhere | your export file, uploaded in Admin → Imports | built (BOO-53) |
| Goodreads | a link from each book page to the book there | the Book Id from your export, else ISBN or title (no request is made) | built (BOO-65) |
| Kobo, Kindle | reads, days and highlights from e-readers | your files, uploaded in Admin → Imports | built (BOO-57) |
| Your *arr book manager (Readarr API: Bookshelf…) | asking for the next book in a series or the rest of an author | your own instance, admin only | built (BOO-64) |
| Anna's Archive | filling gaps in book metadata | — | **not built** (below) |

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
