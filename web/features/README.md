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
    draw(box, rows, parts) { /* draw into box; parts = { card, head, h, note, box } */ },
  });

  // a card on every book page; return false from draw to hide it for that book
  rh.bookCard({ id: 'bk-mine', title: '…', draw(box, rows, parts, book) {} });

  // add to an entity page (author, series, genre, subgenre, year) after it draws
  rh.extend('year', (id, root) => {});

  // a new tab; returns its <section>, then add cards with tab: 'mytab'
  rh.tab('mytab', 'My tab', { after: 'timeline' });

  // a page with no tab, opened by its link (#mypage or #mypage/<anything>); draw(section)
  // runs on every redraw while it's shown, so only rebuild what changed
  rh.page('mypage', (section) => {});
})();
```

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
- `get(url)`, `post(url, body)`, `put(url, body, contentType?)`: JSON requests to the server that throw an `Error` with the server's `error` message on failure.
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
