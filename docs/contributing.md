# Contributing

## Adding a view

New charts, cards, tabs and pages are feature scripts: one `web/features/<name>.js` (plus an
optional `<name>.css`) that the server and the demo add to the page on their own, with no edit
to `index.html` or `charts.js`. [web/features/README.md](../web/features/README.md) has the API
(`dash.calc`, `rh.card`, `rh.tab`, `rh.page`, `rh.extend`, admin sections). Keep the numbers in
pure `dash.calc` functions, use the `rh` helpers so books, authors and so on link to their
pages, and use the CSS custom properties so dark mode works. Check it at phone width too.

If a feature needs data the demo doesn't have, extend the made-up history in `src/demo/`, so
the public demo shows it.

## Checks

Use Node 24 (the tests need it), then run what CI runs:

```sh
npm ci
npm run lint && npx tsc --noEmit && npm test && npm run test:e2e
npx prettier --write <the .ts files you touched>
```

To look at your change, build the demo and open it:

```sh
COVER_LOOKUP=off npm run demo -- site
npx http-server site -p 8000
```

## Screenshots

The README's screenshots in `docs/screenshots/` are taken from the demo by a script:

```sh
npm run screenshots                  # builds the demo into ./site, then takes every shot
npm run screenshots -- --no-build    # reuses the demo already in ./site
```

It shoots every tab (tabs added by feature scripts are found on the page), a book, author and
year page and Wrapped, in light and dark at 1280px (a tab that needs a shorter or taller crop goes in `HEIGHTS` in the script), and the overview and a book page at phone
width. Motion is turned off and the browser clock is fixed to the demo's day, so the pictures
only change when the page does. Any console error fails the run.

- `DEMO_TODAY=YYYY-MM-DD` builds the demo as if on that day (default: today).
- `DEMO_SEED=<number>` makes up a different history (default: 7); `npm run demo` reads both too.
- `COVER_LOOKUP=off` skips the Open Library cover lookup when you're offline; the shots then
  show letter placeholders instead of covers.
- `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome` uses that Chromium instead of Playwright's own
  (otherwise run `npx playwright install chromium` once).

To save Actions minutes the screenshots aren't taken on every push. The
[`screenshots` workflow](../.github/workflows/screenshots.yml) is run by hand (Actions >
screenshots > Run workflow); it takes them with covers and uploads them as an artifact for you
to check and commit.

## Pull requests

The pull request template has the definition of done: checks pass, the change has been looked
at in the demo (light, dark, phone), new views are feature scripts, and the README,
screenshots and demo are updated (or not needed).
