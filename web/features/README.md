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
})();
```

Conventions: show books, authors, series, genres and years with `rh.ref`, `rh.byline`,
`rh.chip`, `rh.linkBook` or `rh.linkPage` so they link (test/web/links.spec.ts checks
this file too); colour genres with `rh.gColor`; series colours with `rh.C`; keep CSS
in the feature's own `.css`, using the page's CSS custom properties so it works in light
and dark.
