# Vendored files

| File | From | Licence |
| --- | --- | --- |
| `d3.min.js` | [d3](https://d3js.org) v7.9.0 | ISC, © 2010-2023 Mike Bostock |
| `topojson-client.min.js` | [topojson-client](https://github.com/topojson/topojson-client) v3.1.0 | ISC, © 2012-2019 Michael Bostock |
| `world-110m.json` | [world-atlas](https://github.com/topojson/world-atlas) v2.0.2 `countries-110m.json`, made from [Natural Earth](https://www.naturalearthdata.com) (public domain) | ISC, © 2013-2019 Michael Bostock |

`world-110m.json` is `countries-110m.json` with each country's ISO 3166 numeric id swapped
for its alpha-2 code (`"826"` becomes `"GB"`), so it matches `author_country` in books.json.
Kosovo is given `XK`. N. Cyprus and Somaliland have no code and are left without an id.
