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
