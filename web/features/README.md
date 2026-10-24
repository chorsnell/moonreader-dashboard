# Feature scripts

Each view that isn't part of the core page lives here as one script (plus an optional
stylesheet of the same name). The server adds every `features/*.js` and `features/*.css`
to the page in name order, after `charts.js` and `pages/*.js`, so adding a view needs no
edit to `index.html` or `charts.js`. The demo build does the same.

A feature script is an IIFE that uses `dash` (data and calcs) and `rh` (drawing helpers):

```js
(() => {
  const { el, fmt, hbars } = rh;

  // optional: another data file; optional files load as [] when missing (older libraries)
  dash.file('highlights', 'data/highlights.json', { optional: true });

  // a calculation: a pure function of its inputs, run once per data load
  dash.calc('my_rows', { inputs: ['books', 'reads'], title: '…', description: '…', fn: (books, reads) => [] });

  // a card on a tab (overview, genres, speed, timeline, diary, library, checks or a new one)
  rh.card({
    tab: 'timeline', id: 'my-card', title: 'My chart', note: 'What it shows.',
    calc: 'my_rows',          // draw waits for these rows (shows a skeleton until then)
    after: 'card-heat',       // or before: 'card-…'; default is the end of the tab
    wide: true,               // default; false for a half-width card
    privacy: 'streaks',       // optional: hide it from visitors when the owner hides this (see Privacy)
    draw(box, rows, parts) { /* draw into box; parts = { card, head, h, note, box } */ },
  });

  // a card on every book page; return false from draw to hide it for that book
  rh.bookCard({ id: 'bk-mine', title: '…', draw(box, rows, parts, book) {} });

  // add to an entity page (author, series, genre, subgenre, year) after it draws
  rh.extend('year', (id, root) => {});

  // facts about a book on the go: on the Overview's "On the go" card ('one' when it's the only
  // book, 'list' for each of several) and in an unfinished book's page header ('book');
  // row has the book's id; return [] to add nothing
  rh.goFact((row, where) => [{ k: 'Likely finish', v: '9 Nov', title: 'a tooltip', cls: 'mine' }]);

  // a new tab; returns its <section>, then add cards with tab: 'mytab'
  rh.tab('mytab', 'My tab', { after: 'timeline' });

  // shade date ranges on the heatmap, the reading timeline and the diary (life-events.js)
  rh.markDays(() => [{ start: '2025-08-01', end: '2025-08-14', title: 'Holiday', color: rh.C[1] }]);

  // a page with no tab, opened by its link (#mypage or #mypage/<anything>); draw(section)
  // runs on every redraw while it's shown, so only rebuild what changed
  rh.page('mypage', (section) => {});

  // a slide in Wrapped (see below)
  rh.wrappedSlide({ id: 'mine', after: 'genres', show: (R) => true, build(slide, R, ui) {} });
})();
```

## Wrapped slides

Wrapped (`wrapped.js`, opened from a year page) is a run of slides built from that year's
`wrapped` row. A feature adds its own with `rh.wrappedSlide`, from any script, before or
after `wrapped.js`:

```js
rh.wrappedSlide({
  id: 'screen',            // the slide's class is wr-screen
  after: 'genres',         // a built-in slide: intro, books, time, words, months, binge, reads,
                           // authors, genres or records; left out (or not shown that year):
                           // just before the closing share slide, which always comes last
  show: (R) => true,       // false skips it for that year (R is the year's wrapped row)
  build(slide, R, ui) {    // fill the slide's inner box
    slide.append(ui.kicker('Your year on screen'), ui.big(120, 'hours watched'),
      ui.line('wr-line', 'Some words.'), ui.line('wr-sub', 'Smaller words.'));
  },
});
```

`ui` holds the building blocks the built-in slides use, so an added one looks the same:
`kicker(text)`, `big(n, unit, format?)` (a big number that counts up when the slide
appears), `line(className, ...parts)` (`wr-line` or `wr-sub`), `bookLink(row)`, `plural`,
`fmt`, `short` (12k, 1.2M), `hrs(minutes)` and `MONTHS`. Give anything that should rise in
with the slide the class `wr-r`, and put links inside a `wr-links` element so a tap on them
doesn't turn the page. Slides sit on a coloured background with white text, so use
`rgba(255,255,255,…)` rather than the page's colours. A slide whose `show` or `build` throws
is left out (and logged), and Wrapped carries on. Anything the slide needs should come from
a calc (read with `dash.data(id)`), so it's worked out once and respects privacy.

## Where the data came from

The dashboard is built from any mix of a Moon+ backup and imports (Kobo, Kindle, KOReader,
Goodreads, StoryGraph), so don't assume Moon+ in a note. `dash.meta()` is the last build's
`meta.json` (`backup_file` is set when there's a Moon+ backup; `imports` lists the rest) and
`dash.hasMoonplus()` says whether there's a Moon+ backup. Use it for wording that is only
true of Moon+ ("Moon+ logs minutes from 2019"). In `index.html`, give such a sentence the
`data-moonplus` attribute and `hidden`; it shows when there's a Moon+ backup.

## Calcs run on the server too

The server loads these same scripts in Node (`src/stats/`) and works out every calc for each
viewer, so the page can skip them (see `docs/api.md`). Nothing extra is needed as long as a
calc's `fn` is a pure function of its inputs: rh helpers such as `rh.okDay` and d3 are fine,
but a calc that reads `dash.params()`, `dash.data()` or the DOM is left to the browser, and
so is one whose rows hold a `Date`, a `Map` or `NaN` (JSON can't carry them). Calcs run in
the order the scripts register them, in Node as in the page. `test/web/server-stats.spec.ts`
checks that both give identical rows.

## Friends' data

`rh.friends` (from `friend-profiles.js`) has each friend's books, reads and daily rows, the
friend picked under "Compare with" (`selected()`), a colour per person (`color(slug)`, `'me'`
for you) and `calc(slug, id)`: any calc worked out again from that friend's data. A calc that
compares you with a friend takes their files as inputs named `friend_books`, `friend_reads`…
and is run with `dash.calcWith(id, { books, …, friend_books, … })`; the server leaves those
to the page. `dash.sameBook.matcher(books)` finds the same book in another library (ISBN,
work id, then title and author).

## Privacy

The owner chooses what visitors (public, or with the read password) may see; the admin
always sees everything. It is enforced on the server (`src/privacy/privacy.ts`): every file
under `data/` is filtered for visitors before it's sent. A new data file is covered without
extra work as long as its rows follow the usual shape:
- rows naming a book with `book_id` (or `id` in `books.json`) are left out or anonymised for
  private books and genres;
- dates in fields named `date`, `start`, `end`, `first_read`, `last_read`, `generated`,
  `synced`, `finish`, `finished_on` or `added` are rounded to the week or month, and `time` fields
  are emptied;
- `highlights*.json` is served empty when highlights are hidden, `prices*.json` (or
  `money*`, `spending*`, `purchases*`) when money is.
- `bibliography.json` (books by your authors and in your series that you haven't got; see
  `docs/api.md`) names no book of yours, so it has its own rule: rows by an author, or in a
  series, whose every book is private are left out.
- `genre_picks.json` (popular books in your genres that you haven't read; `genre-picks.js`)
  names no book of yours either: rows for a private genre or subgenre are left out.

Name date fields that way, or extend the lists in `privacy.ts`. On the page,
`web/features/privacy.js` hides cards whose calc needs a file the visitor gets empty (found
through `dash.needs(calc)`), cards it lists by id, and any card given `privacy: '<category>'`
(categories: `exact_dates`, `diary`, `current`, `streaks`, `money`, `highlights`, `ratings`,
`life_events`). A card whose calc only gains from such a file (the to-read pile adds bought
books from `prices`) says so with `copesWithout: 'prices'` and stays. Draw
functions should cope with empty rows. `dash.dates` is `'week'` or `'month'` when dates
are rounded, and `rh.fDay` then shows the week or month.

## Want to read

`to-read.js` keeps the owner's own want-to-read list (`library/want_to_read.json`, see
`docs/api.md`) and shares it with other views as `rh.wantToRead`:

```js
const w = rh.wantToRead;
w.enabled();           // true only for the admin's own view (not visitors, not previews, not the demo)
w.has(row);            // the book is on the pile or the list already (by isbn13, then title and author)
await w.add({ title, author, series, series_no, isbn13, from: 'author' }); // resolves with the new entry
box.append(w.button({ ...row, from: 'series' }) || ''); // "Want to read", "On your list" (disabled), or null
```

`add` rejects with an `Error` (its `status` is `409` when the book is on the list already).
After a change the server rebuilds, and the page reloads its data when that's done. Load
`rh.wantToRead` when drawing, not when the script loads, as `to-read.js` may come later.

## Analytics

`analytics.js` sends page views and clicks to Mixpanel when `MIXPANEL_TOKEN` is set. It
names what was used (tab ids, card ids, link kinds, control ids or form labels) and never
what's shown, so give controls an `id` or a fixed `aria-label` rather than relying on their
text. Each tab or page that comes on screen is announced with an `rh:view` event.

## Admin sections

The admin page (`#admin`, drawn by `admin.js`) is only shown to the admin. Each of its
sections (Data, Sync & logs, Access & privacy, Catalogue, Covers…) is registered the same
way, so a feature adds its own settings without touching `admin.js`:

```js
rh.adminSection({
  id: 'prices',          // its link is #admin/prices
  title: 'Prices',       // the label in the section menu
  order: 60,             // menu position; the built-in ones use 10–50, default 50
  draw(box, api) {       // runs each time the section is opened; box is an empty card
    const { h, block, msg } = api;
    const out = msg();
    box.append(block('Book prices', 'What each book cost.', h('button', {
      class: 'up-primary ad-auto', type: 'button',
      onclick: async () => { out.textContent = (await api.get('api/admin/prices')).summary; },
    }, 'Load'), out));
  },
});
```

`api` gives the section:
- `h(tag, attrs, ...children)`: builds an element (`class`, `on<event>` handlers, `value`, and `true`/`false` attributes).
- `block(title, note, ...children)`: a titled block, the building piece of every section; `msg()`: a status line.
- `get(url)`, `post(url, body)`, `put(url, body, contentType?)`, `del(url)`: JSON requests to the server that throw an `Error` with the server's `error` message on failure.
- `config()`: what `/api/config` said; `status()`: `/api/admin/status` (current data, backups, last error).
- `waitForBuild(statusBefore, say)`: after a change that rebuilds, waits for the new data, reports progress through `say(text)` and reloads the dashboard.
- `when(date)`, `ago(date)`, `size(bytes)`: formatting; `refresh()`: draws the open section again.

Sections may register in any script, before or after `admin.js`. Their server endpoints
belong under `/api/admin/` and must use `@AdminOnly` (see `src/admin/admin.controller.ts`).
On the static demo there is no admin, so sections are never drawn. Use the `ad-*` and `up-*`
classes in `admin.css` and `index.html` for forms and lists so they match.

Conventions: show books, authors, series, genres and years with `rh.ref`, `rh.byline`,
`rh.chip`, `rh.linkBook` or `rh.linkPage` so they link (test/web/links.spec.ts checks
this file too); colour genres with `rh.gColor`; series colours with `rh.C`; keep CSS
in the feature's own `.css`, using the page's CSS custom properties so it works in light
and dark.

## Chart style

Every chart shares one visual system, so new charts should use it rather than pick their own:

- **Colour.** Categories take `rh.gColor(genre)` or `rh.C[i]` (the `--series-1..8` slots, in
  fixed order, checked for colour-blind separation in light and dark). One series: `rh.C[0]`.
  De-emphasised marks: `var(--cds-chart-muted)`. Text never wears a series colour; put a
  swatch (`.sw`) or a dot beside it instead. A chip given `style.color` shows the colour as a dot.
- **Marks.** Sizes are in `rh.MARK` (`bar` 24px max thickness, `radius` 4, `gap` 2, `line` 2,
  `dot` 4). Draw bars with `rh.barPath(x, y, w, h, dir = 'up' | 'right', r?)`: a rounded data end
  and a square baseline. Leave `rh.MARK.gap` of surface between stacked segments. Give dots and
  end markers `class="ring"` (a surface-coloured ring so they stay legible where they overlap).
- **Reference lines** (an average, a target): `rh.refLine(svg, x1, y1, x2, y2)`, or `class="ref"`.
- **Axes and grid.** `rh.axis(g, d3axis)` styles ticks; use `tickSize(-width)` for hairline
  gridlines and remove the y-axis `.domain`.
- **Hover.** Tooltips go through `rh.showTip` / `rh.tipLines`. Give a row's or column's
  transparent hit rect `class="hit"` and it gets a faint wash on hover.
- **Motion.** Charts made with `rh.svgIn` fade in when they first appear on a view, or when
  their data or a setting in their card changes. They don't animate on a resize or a table
  sort, and never with `prefers-reduced-motion`. To grow marks as well, use
  `sel.call(rh.grow, attr, from, to)`, e.g. `circles.call(rh.grow, 'r', 0, (d) => d.r)` or bars
  from a zero-height `rh.barPath`. Draw lines in with `path.call(rh.drawIn)`. Both just set the
  final value when the chart shouldn't animate. `rh.motion(node)` tells you whether it will.
