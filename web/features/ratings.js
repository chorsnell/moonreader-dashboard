// Your ratings (BOO-53), from a Goodreads or StoryGraph import: rating against speed, by
// genre and by the shape of the read (do you rate devoured books higher?), and a card on
// book pages with the rating, shelves and any reads that happened outside Moon+.
// Every card hides itself when no book has a rating.
(() => {
  const { D, el, fmt, svgIn, showTip, hideTip, tipLines, axis, gColor, link, links, refLine, grow, chip, fDay, pDate, MARK } = rh;
  const ok = (id) => { const r = D(id); return r.status === 'ok' ? r.data : []; };
  const SOURCES = { goodreads: 'Goodreads', storygraph: 'StoryGraph', kobo: 'Kobo', kindle: 'Kindle', kindle_clippings: 'Kindle' };
  const SHAPES = {
    devoured: ['Devoured', 'var(--series-2)'], slow_burn: ['Slow burn', 'var(--series-3)'],
    stop_start: ['Stop-start', 'var(--series-5)'], rescued: ['Rescued', 'var(--series-1)'],
  };
  const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
  const one = (n) => (Math.round(n * 10) / 10).toFixed(1);

  dash.calc('ratings', {
    inputs: ['books', 'book_speed', 'fingerprints'], title: 'Your ratings',
    description: 'Every book you rated (imported from Goodreads or StoryGraph), with its speed (books with 2+ timed hours) and the shape of its latest finished read.',
    fn: (books, speed, prints) => {
      const wpm = new Map(speed.map((s) => [s.book_id, s.wpm]));
      const shape = new Map();
      prints.filter((f) => f.finished).forEach((f) => shape.set(f.book_id, f.shape)); // in start order, so the latest wins
      return books.filter((b) => b.rating > 0).map((b) => ({
        book_id: b.id, title: b.title, author: b.author, genre: b.genre, subgenre: b.subgenre, rating: b.rating,
        wpm: wpm.get(b.id) ?? null, shape: shape.get(b.id) ?? null, source: b.source || null,
      }));
    },
  });
  const rated = () => ok('ratings').length > 0;

  // Rows ("lanes") of dots along one axis, with each lane's average as a ring and a line.
  // lanes: [{ label, node(text) to link it, dots: [{ v, color, d }], color }]
  // discrete: values sit on whole numbers, so their dots go in a small block of columns
  // around the value instead of a tall stack
  function lanes(box, list, { domain, ticks, tickFormat, tip, mean = true, unit = '', discrete = false }) {
    const w0 = Math.max(280, box.clientWidth);
    const probe = d3.select(box).append('svg').attr('width', 0).attr('height', 0);
    const lab = Math.min(w0 * 0.34, rh.measure(probe, list.map((l) => l.label)) + 14); probe.remove();
    const m = { t: 10, r: 16, b: 26, l: lab };
    const x = d3.scaleLinear(domain, [m.l, w0 - m.r]);
    const r = w0 < 500 ? 4 : 5;
    let y0 = m.t;
    list.forEach((l) => {
      // beeswarm: each dot at the smallest offset that doesn't overlap one already placed
      const placed = [];
      if (discrete) {
        const step = 2 * r + 2, rows = 3;
        d3.groups(l.dots, (d) => Math.round(d.v)).forEach(([v, ds]) => {
          const cols = Math.ceil(ds.length / rows);
          ds.forEach((d, k) => {
            const col = Math.floor(k / rows), row = k % rows, inCol = Math.min(rows, ds.length - col * rows);
            placed.push({ ...d, x: x(v) + (col - (cols - 1) / 2) * step, y: (row - (inCol - 1) / 2) * step });
          });
        });
      } else l.dots.map((d) => ({ ...d, x: x(d.v) })).sort((a, b) => a.x - b.x).forEach((d) => {
        for (let k = 0; ; k++) {
          const y = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (r * 0.9);
          if (placed.every((p) => (p.x - d.x) ** 2 + (p.y - y) ** 2 >= (2 * r + 1) ** 2)) { d.y = y; break; }
        }
        placed.push(d);
      });
      const lo = d3.min(placed, (d) => d.y) ?? 0, hi = d3.max(placed, (d) => d.y) ?? 0;
      Object.assign(l, { placed, top: y0, h: Math.max(30, hi - lo + 2 * r + 12) });
      l.mid = y0 + l.h / 2 - (hi + lo) / 2;
      l.avg = d3.mean(l.dots, (d) => d.v);
      y0 += l.h;
    });
    const h = y0 + m.b;
    box.style.minHeight = h + 'px';
    const { svg, tip: tt } = svgIn(box, h);
    const ax = svg.append('g').attr('transform', `translate(0,${h - m.b})`);
    axis(ax, d3.axisBottom(x).tickValues(ticks).tickFormat((v) => tickFormat(v, false)).tickSize(-(h - m.b - m.t)));
    ax.select('.domain').remove();
    list.forEach((l) => {
      const t = svg.append('text').attr('class', 'axl').attr('x', m.l - 10).attr('y', l.top + l.h / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(l.label);
      if (l.link) link(t.node(), ...l.link);
      svg.append('g').selectAll('circle').data(l.placed).join('circle')
        .attr('cx', (d) => d.x).attr('cy', (d) => l.mid + d.y).call(grow, 'r', 0, r)
        .attr('class', 'ring').attr('fill', (d) => d.color).attr('fill-opacity', 0.8).call(links, 'book', (d) => d.d.book_id)
        .on('mousemove', (e, d) => showTip(tt, box, e, (tp) => tip(tp, d.d)))
        .on('mouseleave', () => hideTip(tt));
      if (mean && l.dots.length > 1) {
        refLine(svg, x(l.avg), l.top + 4, x(l.avg), l.top + l.h - 4);
        svg.append('text').attr('class', 'axl rt-avg').attr('x', x(l.avg) + 4).attr('y', l.top + 10).text(`${tickFormat(l.avg, true)}${unit}`);
      }
    });
  }

  const bookTip = (tp, d) => tipLines(tp, d.title, [[gColor(d.genre), d.genre, ''], [null, 'Rated', stars(d.rating) + (d.rating % 1 ? ` (${d.rating})` : '')],
    ...(d.wpm ? [[null, 'Speed', `${fmt(d.wpm)} wpm`]] : []), ...(d.shape && SHAPES[d.shape] ? [[SHAPES[d.shape][1], 'Read', SHAPES[d.shape][0].toLowerCase()]] : [])]);
  const empty = (box, text) => { box.style.minHeight = '60px'; box.replaceChildren(el('div', 'dy-empty', text)); };
  const take = (box, text) => box.prepend(el('p', 'rt-take', text));

  // ---------- Speed tab: rating against speed ----------
  rh.card({
    tab: 'speed', id: 'rating-speed', title: 'Speed and your rating', after: 'card-speed-books', calc: 'ratings', privacy: 'ratings',
    note: 'Each dot is a book you rated, placed by its reading speed; the line is the average speed for that rating. Books with 2+ timed hours.',
    hidden: () => !rated(),
    draw(box, rows) {
      box.replaceChildren();
      const timed = rows.filter((r) => r.wpm);
      if (timed.length < 3) { empty(box, 'Not enough rated books with timed reading yet.'); return; }
      const by = d3.groups(timed, (r) => Math.round(r.rating)).sort((a, b) => b[0] - a[0]);
      const ext = d3.extent(timed, (r) => r.wpm), pad = (ext[1] - ext[0]) * 0.06 || 20;
      const x = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice();
      const leg = el('div', 'legend');
      rh.legend(leg, rh.genres().filter((g) => timed.some((r) => r.genre === g)).map((g) => [gColor(g), g]), 'genre');
      box.append(leg);
      lanes(box, by.map(([s, v]) => ({ label: stars(s), dots: v.map((d) => ({ v: d.wpm, color: gColor(d.genre), d })) })),
        { domain: x.domain(), ticks: x.ticks(Math.max(3, Math.floor(box.clientWidth / 90))), tickFormat: (v, avg) => (avg ? fmt(Math.round(v)) : v + ' wpm'), unit: ' wpm', tip: bookTip });
      const hi = timed.filter((r) => r.rating >= 4.5), lo = timed.filter((r) => r.rating <= 3);
      if (hi.length && lo.length) {
        const a = d3.mean(hi, (r) => r.wpm), b = d3.mean(lo, (r) => r.wpm), diff = Math.round((a / b - 1) * 100);
        take(box, Math.abs(diff) < 3 ? `Speed doesn't follow your rating: 5★ books and 3★-or-lower books go at much the same pace (${fmt(Math.round(a))} vs ${fmt(Math.round(b))} wpm).`
          : `You read your 5★ books ${Math.abs(diff)}% ${diff > 0 ? 'faster' : 'slower'} than the ones you rated 3★ or lower (${fmt(Math.round(a))} vs ${fmt(Math.round(b))} wpm).`);
      }
    },
  });

  // ---------- Genres tab: rating by genre ----------
  rh.card({
    tab: 'genres', id: 'rating-genre', title: 'Ratings by genre', after: 'card-fingerprints', calc: 'ratings', privacy: 'ratings',
    note: 'Every book you rated, by genre; the line is the genre’s average rating.',
    hidden: () => !rated(),
    draw(box, rows) {
      box.replaceChildren();
      if (!rows.length) { empty(box, 'No ratings yet.'); return; }
      const order = rh.genres();
      const by = d3.groups(rows, (r) => r.genre).sort((a, b) => d3.mean(b[1], (r) => r.rating) - d3.mean(a[1], (r) => r.rating) || order.indexOf(a[0]) - order.indexOf(b[0]));
      // a little jitter so equal ratings spread out rather than stack in one column
      lanes(box, by.map(([g, v]) => ({ label: g, link: ['genre', g], dots: v.map((d) => ({ v: d.rating, color: gColor(g), d })) })),
        { domain: [0.6, 5.4], ticks: [1, 2, 3, 4, 5], tickFormat: (v, avg) => (avg ? one(v) + '★' : v + '★'), tip: bookTip, discrete: true });
      const top = by.filter(([, v]) => v.length >= 2)[0];
      if (top) take(box, `${top[0]} gets your best ratings: ${one(d3.mean(top[1], (r) => r.rating))}★ on average over ${fmt(top[1].length)} books.`);
    },
  });

  // ---------- Genres tab: do you rate devoured books higher? ----------
  rh.card({
    tab: 'genres', id: 'rating-shape', title: 'Do you rate devoured books higher?', after: 'card-rating-genre', calc: 'ratings', privacy: 'ratings',
    note: 'Your rating of each finished book against the shape of its read (see Book shapes); the line is the average.',
    hidden: () => !rated(),
    draw(box, rows) {
      box.replaceChildren();
      const shaped = rows.filter((r) => SHAPES[r.shape]);
      if (shaped.length < 3) { empty(box, 'Not enough rated books with a reading log yet.'); return; }
      const by = Object.keys(SHAPES).map((s) => [s, shaped.filter((r) => r.shape === s)]).filter(([, v]) => v.length);
      lanes(box, by.map(([s, v]) => ({ label: SHAPES[s][0], dots: v.map((d) => ({ v: d.rating, color: SHAPES[s][1], d })) })),
        { domain: [0.6, 5.4], ticks: [1, 2, 3, 4, 5], tickFormat: (v, avg) => (avg ? one(v) + '★' : v + '★'), tip: bookTip, discrete: true });
      const dev = shaped.filter((r) => r.shape === 'devoured'), rest = shaped.filter((r) => r.shape !== 'devoured');
      if (dev.length && rest.length) {
        const a = d3.mean(dev, (r) => r.rating), b = d3.mean(rest, (r) => r.rating), diff = a - b;
        take(box, Math.abs(diff) < 0.15 ? `Not really: devoured books average ${one(a)}★, the rest ${one(b)}★.`
          : diff > 0 ? `Yes: books you devoured average ${one(a)}★, ${one(diff)} more than the rest (${one(b)}★).`
            : `No: books you devoured average ${one(a)}★, ${one(-diff)} less than the rest (${one(b)}★).`);
      }
    },
  });

  // ---------- book pages: rating, shelves, reads elsewhere ----------
  rh.bookCard({
    id: 'bk-rating', title: 'Your rating', wide: false, privacy: 'ratings',
    draw(box, rows, parts, b) {
      const reads = ok('reads').filter((r) => r.book_id === b.id && r.source);
      if (!b.rating && !(b.shelves || []).length && !reads.length && !b.source) return false;
      box.replaceChildren();
      box.style.minHeight = '0';
      parts.h.textContent = b.rating || (b.shelves || []).length ? 'Your rating' : 'Read elsewhere';
      if (b.rating) {
        const s = el('div', 'rt-stars', stars(b.rating));
        s.setAttribute('aria-label', `Rated ${b.rating} out of 5`);
        box.append(s);
      }
      if ((b.shelves || []).length) {
        const sh = el('div', 'bk-chips');
        b.shelves.forEach((x) => sh.append(el('span', 'chip', x)));
        box.append(sh);
      }
      const src = SOURCES[b.source] || SOURCES[reads[0]?.source] || 'an import';
      const fin = reads.filter((r) => r.finished);
      if (b.source && b.hours == null) box.append(el('p', 'rt-note', `Only in your ${src} data, so there are dates but no minutes, words or speed for it. It counts towards books per year and genres, not towards time or speed.`));
      else if (b.source) box.append(el('p', 'rt-note', `Read on your ${src}, not in Moon+.`));
      else if (reads.length) box.append(el('p', 'rt-note', `Also read outside Moon+ (${[...new Set(reads.map((r) => SOURCES[r.source]))].join(', ')})` + (fin.length ? `: finished ${fin.map((r) => fDay(pDate(r.end))).join(', ')}.` : '.')));
      if (b.rating || (b.shelves || []).length) parts.note.hidden = true;
    },
  });
})();
