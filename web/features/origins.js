// Origins: how old your books are, where your authors come from and who they are.
// Publication years, countries and genders come from catalogue.json or the metadata lookup.
(() => {
  const { el, fmt, C, svgIn, showTip, hideTip, tipLines, axis, legend, gColor, links, pDate, fDay, plural, refLine, grow } = rh;
  const yearOf = (s) => +s.slice(0, 4);
  const yearLabel = (y) => (y < 0 ? `${-y} BC` : String(y));

  rh.tab('origins', 'Origins', { after: 'genres' });

  // a short line of figures above a chart, made once per card
  function summary(parts, cls, items) {
    let kp = parts.card.querySelector('.' + cls);
    if (!kp) { kp = el('div', 'dy-sum ' + cls); parts.note.after(kp); }
    kp.replaceChildren(...items.map(([v, l]) => { const d = el('div'); d.append(el('b', null, v), el('span', null, l)); return d; }));
  }
  function empty(box, text) {
    box.style.minHeight = '80px';
    box.replaceChildren(el('div', 'dy-empty', text));
  }
  const MISSING = 'Add it to catalogue.json, or let the metadata lookup find it.';

  // ---------- how old are your books? ----------
  dash.calc('book_age', {
    inputs: ['books', 'reads'], title: 'Publication year of each read',
    description: 'Every read of a book with a known publication year: when the read ended (or was last opened), the year the book was first published, and how old it was then.',
    fn: (books, reads) => {
      const by = new Map(books.map((b) => [b.id, b]));
      return reads.map((r) => {
        const b = by.get(r.book_id), y = b && b.published_year;
        if (y == null) return null;
        return { read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre, read_no: r.read_no,
          start: r.start, end: r.end, finished: r.finished, published_year: y, age: yearOf(r.end) - y };
      }).filter(Boolean);
    },
  });

  rh.card({
    tab: 'origins', id: 'book-age', title: 'How old are your books?', calc: 'book_age',
    note: 'Each read, by when you read it and the year the book was first published.',
    draw(box, rows, parts) {
      const all = (dash.data('reads').data || []).length;
      if (!rows.length) { summary(parts, 'or-age-sum', []); empty(box, `No publication years yet. ${MISSING}`); return; }
      const ages = rows.map((r) => r.age).sort(d3.ascending), med = d3.median(ages);
      const oldest = rows.reduce((a, r) => (r.published_year < a.published_year ? r : a)), newest = rows.reduce((a, r) => (r.published_year > a.published_year ? r : a));
      const recent = rows.filter((r) => r.age <= 2).length;
      summary(parts, 'or-age-sum', [
        [`${fmt(med)} years`, 'old, the median book when you read it'],
        [yearLabel(oldest.published_year), `oldest: ${oldest.title}`],
        [yearLabel(newest.published_year), `newest: ${newest.title}`],
        [`${Math.round((recent / rows.length) * 100)}%`, 'of reads within two years of publication'],
      ]);
      // keep the axis on the bulk of the books; much older ones sit on the floor, marked ▼
      const years = rows.map((r) => r.published_year).sort(d3.ascending);
      const p5 = d3.quantile(years, 0.05), span = Math.max(30, years[years.length - 1] - p5);
      const floor = years[0] < p5 - span * 0.5 ? Math.floor((p5 - span * 0.1) / 10) * 10 : Math.floor(years[0] / 10) * 10;
      const h = 320, { svg, w, tip } = svgIn(box, h), m = { t: 24, r: 14, b: 28, l: 44 };
      box.style.minHeight = h + 'px';
      const t0 = d3.min(rows, (r) => pDate(r.end)), t1 = d3.max(rows, (r) => pDate(r.end));
      const x = d3.scaleUtc([d3.utcMonth.offset(t0, -1), d3.utcMonth.offset(t1, 1)], [m.l, w - m.r]);
      const yTop = years[years.length - 1] + Math.max(5, (years[years.length - 1] - floor) * 0.05);
      const y = d3.scaleLinear([floor, yTop], [h - m.b, m.t]).nice();
      const [d0, d1] = x.domain(), yr0 = d0.getUTCFullYear(), yr1 = d1.getUTCFullYear() + 1, top = y.domain()[1];
      // a book read the year it came out, where that's within the chart
      const fresh = yr0 <= top;
      const low = (r) => r.published_year < y.domain()[0];
      parts.note.textContent = 'Each read, by when you read it and the year the book was first published.' +
        (fresh ? ' The dashed line is a book read the year it came out.' : '') +
        (rows.some(low) ? ` ▼ marks books published before ${yearLabel(y.domain()[0])}.` : '') +
        (all > rows.length ? ` ${plural(all - rows.length, 'read')} without a publication year ${all - rows.length === 1 ? 'isn’t' : 'aren’t'} shown.` : '');
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(6).tickFormat((v) => yearLabel(v)).tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(Math.max(2, Math.floor((w - m.l) / 80))).tickSizeOuter(0));
      svg.append('text').attr('class', 'axl').attr('x', 4).attr('y', 8).attr('dy', '0.35em').text('first published');
      if (fresh) {
        const end = Math.min(yr1, top), tEnd = end === yr1 ? d1 : new Date(Date.UTC(end, 0, 1));
        refLine(svg, x(d0), y(yr0), x(tEnd), y(end));
      }
      const dots = svg.append('g').selectAll('path').data(rows.slice().sort((a, b) => b.age - a.age)).join('path')
        .attr('class', 'ring').attr('fill', (r) => gColor(r.genre)).attr('fill-opacity', (r) => (r.finished ? 1 : 0.45))
        .attr('d', (r) => (low(r) ? d3.symbol(d3.symbolTriangle, 50)() : d3.symbol(d3.symbolCircle, 64)()))
        .attr('transform', (r) => `translate(${x(pDate(r.end))},${low(r) ? h - m.b - 5 : y(r.published_year)})${low(r) ? ' rotate(180)' : ''}`)
        .call(links, 'book', (r) => r.book_id)
        .on('mousemove', (e, r) => showTip(tip, box, e, (t) => tipLines(t, r.title, [[gColor(r.genre), r.genre, ''],
          [null, 'First published', yearLabel(r.published_year)], [null, r.finished ? 'Finished' : 'Last opened', fDay(pDate(r.end))],
          [null, 'Age when read', r.age === 0 ? 'new that year' : plural(r.age, 'year')]].concat(r.read_no > 1 ? [[null, 'Read', `#${r.read_no}`]] : []))))
        .on('mouseleave', () => hideTip(tip));
      dots.call(grow, 'fill-opacity', 0, (r) => (r.finished ? 1 : 0.45));
    },
  });

  // ---------- where your authors come from ----------
  dash.calc('author_countries', {
    inputs: ['books'], title: 'Authors by country',
    description: 'For each author country (ISO 3166 alpha-2): how many of your books, how many authors and how many hours. Books without a country are counted under an empty code.',
    fn: (books) => d3.rollups(books, (v) => ({
      code: v[0].author_country || '', name: v[0].author_country_name || v[0].author_country || 'Unknown',
      books: v.length, authors: new Set(v.map((b) => b.author)).size, hours: Math.round(d3.sum(v, (b) => b.hours || 0) * 10) / 10,
    }), (b) => b.author_country || '').map(([, o]) => o).sort((a, b) => b.books - a.books || b.hours - a.hours),
  });

  // world geometry, loaded the first time the map is drawn
  let world = null, loading = false;
  function loadWorld() {
    if (world || loading) return;
    loading = true;
    const s = document.createElement('script');
    s.src = 'vendor/topojson-client.min.js';
    s.onload = () => fetch('vendor/world-110m.json').then((r) => r.json()).then((t) => {
      world = topojson.feature(t, t.objects.countries);
      rh.redraw();
    }).catch((e) => { loading = false; console.error('world map', e); });
    s.onerror = () => { loading = false; };
    document.head.append(s);
  }
  let mapBy = 'books';
  const SHADES = [20, 38, 56, 76, 100];
  const shade = (i) => `color-mix(in srgb, ${C[0]} ${SHADES[i]}%, var(--color-panel))`;

  rh.card({
    tab: 'origins', id: 'author-map', title: 'Where your authors come from', calc: 'author_countries',
    note: 'Your books by their author’s country: citizenship, or today’s country for places that no longer exist.',
    draw(box, rows, parts) {
      const known = rows.filter((r) => r.code), unknown = rows.find((r) => !r.code);
      let ctl = parts.head.querySelector('.or-seg');
      if (!ctl) {
        ctl = el('div', 'or-seg');
        ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'Measure');
        [['books', 'Books'], ['hours', 'Hours']].forEach(([k, n]) => {
          const b = el('button', null, n); b.dataset.k = k;
          b.addEventListener('click', () => { mapBy = k; rh.redraw(); });
          ctl.append(b);
        });
        parts.head.append(ctl);
      }
      ctl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === mapBy)));
      if (!known.length) { summary(parts, 'or-map-sum', []); empty(box, `No author countries yet. ${MISSING}`); return; }
      const total = d3.sum(rows, (r) => r.books), top = known[0];
      summary(parts, 'or-map-sum', [
        [fmt(known.length), known.length === 1 ? 'country' : 'countries'],
        [`${Math.round((top.books / total) * 100)}%`, `of your books are from ${top.name}`],
        [fmt(d3.sum(known, (r) => r.authors)), 'authors with a known country'],
      ]);
      parts.note.textContent = 'Your books by their author’s country: citizenship, or today’s country for places that no longer exist.' +
        (unknown ? ` ${plural(unknown.books, 'book')} by authors without a known country ${unknown.books === 1 ? 'isn’t' : 'aren’t'} shown.` : '');
      const val = (r) => (mapBy === 'books' ? r.books : r.hours), by = new Map(known.map((r) => [r.code, r]));
      const max = d3.max(known, val) || 1;
      // five steps on a square-root scale, so one big country doesn't wash out the rest
      const step = (v) => Math.min(SHADES.length - 1, Math.floor(Math.sqrt(v / max) * SHADES.length - 1e-9));
      const unit = mapBy === 'books' ? (v) => plural(v, 'book') : (v) => `${fmt(v)} h`;

      box.replaceChildren();
      const wrap = el('div', 'or-map'), mapBox = el('div', 'or-geo'), side = el('div', 'or-side');
      wrap.append(mapBox, side); box.append(wrap);
      const lg = el('div', 'legend or-scale');
      // the range each shade covers (step() floors sqrt(v / max) * 5)
      const edge = (i) => Math.pow(i / SHADES.length, 2) * max;
      const bins = SHADES.map((_, i) => {
        if (mapBy === 'hours') return [shade(i), `${fmt(Math.round(edge(i)))}–${fmt(Math.round(edge(i + 1)))} h`];
        const lo = Math.max(1, Math.ceil(edge(i))), hi = i === SHADES.length - 1 ? max : Math.ceil(edge(i + 1)) - 1;
        return lo > hi ? null : [shade(i), lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`];
      }).filter(Boolean);
      legend(lg, bins);
      side.append(lg);
      const list = el('ol', 'or-list');
      known.slice(0, 12).forEach((r) => {
        const li = el('li'), bar = el('i');
        bar.style.width = (val(r) / max) * 100 + '%';
        li.append(el('span', 'or-name', r.name), el('span', 'or-val', unit(val(r))), el('span', 'or-bar'));
        li.lastChild.append(bar);
        li.title = `${r.name}: ${plural(r.books, 'book')} by ${plural(r.authors, 'author')}, ${fmt(r.hours)} h`;
        list.append(li);
      });
      if (known.length > 12) list.append(el('li', 'or-more', `and ${fmt(known.length - 12)} more`));
      side.append(list);

      if (!world) { mapBox.append(el('div', 'dy-empty', 'Loading the map…')); loadWorld(); return; }
      const h = Math.round(Math.max(160, mapBox.clientWidth * 0.46));
      const { svg, w, tip } = svgIn(mapBox, h);
      const land = world.features.filter((f) => f.id !== 'AQ');
      const proj = d3.geoNaturalEarth1().fitExtent([[2, 2], [w - 2, h - 2]], { type: 'FeatureCollection', features: land }), path = d3.geoPath(proj);
      svg.append('g').selectAll('path').data(land).join('path')
        .attr('class', (f) => 'or-land' + (by.has(f.id) ? ' has' : ''))
        .attr('d', path)
        .style('fill', (f) => (by.has(f.id) ? shade(step(val(by.get(f.id)))) : null))
        .on('mousemove', (e, f) => {
          const r = by.get(f.id);
          showTip(tip, mapBox, e, (t) => tipLines(t, r ? r.name : f.properties.name, r
            ? [[null, 'Books', fmt(r.books)], [null, 'Authors', fmt(r.authors)], [null, 'Hours', fmt(r.hours)]]
            : [[null, '', 'No books yet']]));
        })
        .on('mouseleave', () => hideTip(tip));
    },
  });

  // ---------- gender balance ----------
  const GENDERS = [['female', 'Women', C[1]], ['male', 'Men', C[0]], ['non-binary', 'Non-binary', C[2]], ['other', 'Other', C[3]], ['', 'Unknown', 'var(--cds-chart-muted)']];
  dash.calc('author_gender_years', {
    inputs: ['books', 'reads'], title: 'Author gender by year',
    description: 'For each year, how many different books you read (a read ending or last opened that year) by the author’s gender (female, male, non-binary, other, or empty when unknown).',
    fn: (books, reads) => {
      const g = new Map(books.map((b) => [b.id, b.author_gender || '']));
      const seen = new Set(), out = new Map();
      reads.forEach((r) => {
        const year = yearOf(r.end), k = year + '|' + r.book_id;
        if (seen.has(k)) return;
        seen.add(k);
        const row = out.get(year) || { year, total: 0, ...Object.fromEntries(GENDERS.map(([k]) => [k || 'unknown', 0])) };
        row[g.get(r.book_id) || 'unknown']++; row.total++;
        out.set(year, row);
      });
      return [...out.values()].sort((a, b) => a.year - b.year);
    },
  });

  rh.card({
    tab: 'origins', id: 'author-gender', title: 'Author gender balance over time', calc: 'author_gender_years',
    note: 'The books you read each year, by the gender of their author, as a share of the year.',
    draw(box, rows, parts) {
      const key = (k) => k || 'unknown';
      const totals = Object.fromEntries(GENDERS.map(([k]) => [key(k), d3.sum(rows, (r) => r[key(k)])]));
      const knownTotal = d3.sum(GENDERS.filter(([k]) => k), ([k]) => totals[k]);
      if (!knownTotal) { summary(parts, 'or-gen-sum', []); empty(box, `No author genders yet. ${MISSING}`); return; }
      const share = (k) => `${Math.round((totals[k] / knownTotal) * 100)}%`;
      const last = rows[rows.length - 1], lastKnown = last.total - last.unknown;
      summary(parts, 'or-gen-sum', [
        [share('female'), 'of books with a known author gender are by women'],
        [share('male'), 'by men'],
        ...(totals['non-binary'] + totals.other ? [[`${Math.round(((totals['non-binary'] + totals.other) / knownTotal) * 100)}%`, 'by non-binary and other authors']] : []),
        ...(lastKnown ? [[`${Math.round((last.female / lastKnown) * 100)}%`, `by women in ${last.year}`]] : []),
      ]);
      const used = GENDERS.filter(([k]) => totals[key(k)]);
      let lg = parts.card.querySelector('.or-gen-legend');
      if (!lg) { lg = el('div', 'legend or-gen-legend'); box.before(lg); }
      legend(lg, used.map(([, n, c]) => [c, n]));
      const h = 240, { svg, w, tip } = svgIn(box, h), m = { t: 8, r: 6, b: 24, l: 40 };
      box.style.minHeight = h + 'px';
      const x = d3.scaleBand(rows.map((r) => r.year), [m.l, w - m.r]).padding(0.2);
      const bw = Math.min(rh.MARK.bar * 2, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
      const y = d3.scaleLinear([0, 1], [h - m.b, m.t]);
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4, '.0%').tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      const every = Math.ceil(rows.length / Math.max(1, Math.floor((w - m.l) / 44)));
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(rows.map((r) => r.year).filter((_, i) => i % every === 0)).tickFormat(String).tickSize(0).tickPadding(8));
      const stack = d3.stack().keys(used.map(([k]) => key(k))).value((r, k) => r[k] / r.total)(rows);
      const gap = rh.MARK.gap / 2;
      svg.append('g').selectAll('g').data(stack).join('g').attr('fill', (s, i) => used[i][2])
        .selectAll('rect').data((s) => s).join('rect').attr('x', (d) => x(d.data.year) + off).attr('width', bw)
        .attr('y', (d) => y(d[1]) + (d[1] < 1 ? gap : 0)).attr('height', (d) => Math.max(0, y(d[0]) - y(d[1]) - (d[1] < 1 ? gap : 0) - (d[0] > 0 ? gap : 0)))
        .call(grow, 'opacity', 0, 1);
      // half way
      refLine(svg, m.l, y(0.5), w - m.r, y(0.5));
      svg.append('g').selectAll('rect').data(rows).join('rect').attr('class', 'hit').attr('fill', 'transparent')
        .attr('x', (r) => x(r.year) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', m.t).attr('height', h - m.t - m.b)
        .call(links, 'year', (r) => r.year)
        .on('mousemove', (e, r) => showTip(tip, box, e, (t) => tipLines(t, String(r.year), used.map(([k, n, c]) => [c, n, `${plural(r[key(k)], 'book')} · ${Math.round((r[key(k)] / r.total) * 100)}%`]))))
        .on('mouseleave', () => hideTip(tip));
    },
  });
})();
