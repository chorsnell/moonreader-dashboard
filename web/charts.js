(() => {
  const C = dash.colors;
  const fmt = d3.format(',');
  const pDate = (s) => new Date(s + 'T00:00:00Z');
  // a day, or the week or month it falls in when the owner shows visitors only those
  // (dash.dates, from /api/config; the server has already rounded the dates down)
  const fExact = d3.utcFormat('%-d %b %Y'), fWeek = d3.utcFormat('w/c %-d %b %Y');
  const fDay = (d) => (dash.dates === 'month' ? fShort(d) : dash.dates === 'week' ? fWeek(d) : fExact(d));
  const fShort = d3.utcFormat('%b %Y');
  const $ = (s) => document.querySelector(s);
  let tab = 'overview';

  // ---------- helpers ----------
  const D = (id) => dash.data(id);
  function state(el, id) {
    const r = D(id);
    if (r.status === 'ok') { el.classList.remove('dash-skeleton'); return r.data; }
    if (r.status === 'error' || r.status === 'missing') {
      el.classList.remove('dash-skeleton');
      el.replaceChildren(Object.assign(document.createElement('div'), { className: 'fail', textContent: 'Failed to load' }));
    } else { el.replaceChildren(); el.classList.add('dash-skeleton'); }
    return null;
  }
  // ---------- motion ----------
  // charts animate when they first appear on a view or their data or range changes, not on a
  // resize or a table sort, and never with prefers-reduced-motion. moving is true (everything)
  // or the card whose control changed
  const DUR = 220, calm = matchMedia('(prefers-reduced-motion: reduce)');
  let moving = true;
  const motion = (node) => !calm.matches && (moving === true || (!!moving && !!node && moving.contains(node)));
  // set attr to `to`, growing it from `from` when the chart animates: sel.call(grow, 'r', 0, (d) => d.r)
  function grow(sel, attr, from, to) {
    if (motion(sel.node())) sel.attr(attr, from).transition().duration(DUR).ease(d3.easeCubicOut).attr(attr, to);
    else sel.attr(attr, to);
    return sel;
  }
  // draw a line in from its start
  function drawIn(path) {
    if (!motion(path.node())) return path;
    path.each(function () {
      const len = this.getTotalLength ? this.getTotalLength() : 0;
      if (!len) return;
      d3.select(this).attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
        .transition().duration(DUR).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
        .on('end', function () { d3.select(this).attr('stroke-dasharray', null).attr('stroke-dashoffset', null); });
    });
    return path;
  }
  function svgIn(el, h) {
    el.querySelectorAll('svg,.tip').forEach((n) => n.remove());
    const w = Math.max(280, el.clientWidth);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).attr('height', h);
    if (motion(el)) svg.style('opacity', 0).transition().duration(DUR).style('opacity', null);
    const tip = d3.select(el).append('div').attr('class', 'tip');
    return { svg, w, tip };
  }
  function measure(svg, texts) {
    const t = svg.append('text').attr('class', 'axl');
    let m = 0;
    texts.forEach((s) => { t.text(s); m = Math.max(m, t.node().getComputedTextLength()); });
    t.remove();
    return m;
  }
  function showTip(tip, el, event, html) {
    const [x, y] = d3.pointer(event, el);
    tip.style('display', 'block').html('');
    html(tip);
    const tw = tip.node().offsetWidth, th = tip.node().offsetHeight, W = el.clientWidth;
    tip.style('left', Math.min(Math.max(0, x + 12), W - tw) + 'px').style('top', Math.max(0, y - th - 8) + 'px');
  }
  const hideTip = (tip) => tip.style('display', 'none');
  function tipLines(tip, head, lines) {
    tip.append('div').attr('class', 't').text(head);
    lines.forEach(([color, name, val]) => {
      const d = tip.append('div');
      if (color) d.append('span').attr('class', 'sw').style('background', color);
      d.append('span').text(name ? name + ': ' : '');
      d.append('b').text(val);
    });
  }
  function axis(g, ax) { g.call(ax).attr('font-size', null).attr('font-family', null); }
  // shared mark sizes (colours live in CSS: --series-*, --cds-chart-*)
  const MARK = { bar: 24, radius: 4, gap: 2, line: 2, dot: 4 };
  // a bar with a rounded data end and a square baseline; dir 'up' (column) or 'right' (bar)
  function barPath(x, y, w, h, dir = 'up', r = MARK.radius) {
    w = Math.max(0, w); h = Math.max(0, h);
    r = Math.max(0, Math.min(r, dir === 'up' ? w / 2 : h / 2, dir === 'up' ? h : w));
    if (dir === 'right') return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${r - w}Z`;
    return `M${x},${y + h}v${r - h}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}Z`;
  }
  // a reference line (an average, a target): thin, dashed, recessive
  const refLine = (g, x1, y1, x2, y2) => g.append('line').attr('class', 'ref').attr('x1', x1).attr('x2', x2).attr('y1', y1).attr('y2', y2);
  function legend(el, items, kind) {
    el.replaceChildren(...items.map(([c, n]) => { const s = document.createElement('span'); const i = document.createElement('i'); i.className = 'sw'; i.style.background = c; s.append(i, n); return link(s, kind, n); }));
  }
  const genreLegend = (box, genres) => legend(box, genres.map((g) => [gColor(g), g]), 'genre');
  let genreOrder = [];
  const gColor = (g) => { const i = genreOrder.indexOf(g); return i >= 0 && i < C.length ? C[i] : 'var(--cds-chart-muted)'; };

  // ---------- links ----------
  // Everything you can click through to, keyed by kind, with the row field that names it.
  // Nothing else needs wiring: ref(), byline(), chip(), legend(), hbars(), table() and list()
  // link any of these fields they show, and #<kind>/<id> opens the page (book: the book
  // page; the rest: the page pages/<kind>.js registers). Add a kind here and it links
  // everywhere it's shown.
  const LINKS = {
    book: { field: 'title', id: (r) => r.book_id ?? r.id, label: 'Book', many: 'Books' },
    author: { field: 'author', label: 'Author', many: 'Authors' },
    series: { field: 'series', label: 'Series', many: 'Series' },
    genre: { field: 'genre', label: 'Genre', many: 'Genres' },
    subgenre: { field: 'subgenre', label: 'Subgenre', many: 'Subgenres' },
    year: { field: 'year', label: 'Year', many: 'Years' },
    // TV and film (features/tv.js): a show's page lists its seasons; a film has its own page
    show: { field: 'show', id: (r) => r.show_id, label: 'Show', many: 'Shows' },
    film: { field: 'film', id: (r) => r.film_id, label: 'Film', many: 'Films' },
  };
  const KIND_OF = Object.fromEntries(Object.entries(LINKS).map(([k, o]) => [o.field, k]));
  const idOf = (kind, r) => (LINKS[kind].id ? LINKS[kind].id(r) : r[LINKS[kind].field]);
  // make any node (HTML or SVG) open that thing's page; a missing id unlinks it
  function link(node, kind, id) {
    if (!node) return node;
    if (LINKS[kind] && id != null && id !== '') {
      node.setAttribute('data-link', kind); node.setAttribute('data-id', id);
      if (!(node instanceof SVGElement)) { node.tabIndex = 0; node.setAttribute('role', 'link'); }
    } else ['data-link', 'data-id', 'role', 'tabindex'].forEach((a) => node.removeAttribute(a));
    return node;
  }
  // for d3 selections: .call(links, 'genre', (d) => d.genre)
  const links = (sel, kind, id) => sel.each(function (d) { link(this, kind, id(d)); });
  // a row's field as text, linked to its page: ref(r, 'author'), or with other text
  function ref(r, field, text) {
    const kind = KIND_OF[field], v = r[field];
    return link(el('span', 'lk', text ?? v ?? ''), kind, kind ? idOf(kind, r) : null);
  }
  const seriesText = (r) => r.series + (r.series_no != null ? ' #' + r.series_no : '');
  // a row about a book (a read, a day…) with any fields it lacks filled in from the book
  let bookMap = null, bookData = null;
  function withBook(r) {
    const all = D('books').data;
    if (all !== bookData) { bookData = all; bookMap = new Map(all.map((b) => [b.id, b])); }
    const b = bookMap.get(idOf('book', r));
    return b ? { ...b, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== '')) } : r;
  }
  // "Author · Series #2 · extra", each part linked; parts the book doesn't have are skipped
  function byline(tag, cls, r, fields = ['author', 'series'], ...extra) {
    r = withBook(r);
    const box = el(tag, cls), parts = fields.filter((f) => r[f]).map((f) => ref(r, f, f === 'series' ? seriesText(r) : null)).concat(extra.filter(Boolean));
    parts.forEach((p, i) => { if (i) box.append(' · '); box.append(p); });
    return box;
  }
  const chip = (kind, id, text) => { const c = link(el('span', 'chip', text ?? id), kind, id); if (kind === 'genre') c.style.color = gColor(id); return c; };

  // ---------- horizontal bars ----------
  // one bar per row; give it a field ('genre', 'author'…) and its label links to that page
  function hbars(el, rows, { field, label = (r) => r[field], value, color, tipFn, link: to = KIND_OF[field] ? (d) => [KIND_OF[field], d[field]] : null }) {
    const bh = 22, gap = 6, h = rows.length * (bh + gap) + 4;
    el.style.minHeight = h + 'px';
    const { svg, w, tip } = svgIn(el, h);
    const lw = Math.min(w * 0.45, measure(svg, rows.map(label)) + 10);
    const vw = measure(svg, rows.map((r) => fmt(value(r)))) + 8;
    const x = d3.scaleLinear([0, d3.max(rows, value) || 1], [0, Math.max(10, w - lw - vw)]);
    const g = svg.selectAll('g.r').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * (bh + gap)})`).each(function (d) { if (to) link(this, ...to(d)); });
    g.append('text').attr('class', 'axl').attr('x', lw - 8).attr('y', bh / 2).attr('dy', '0.35em').attr('text-anchor', 'end')
      .text((d) => { const s = label(d); return s.length > 34 ? s.slice(0, 33) + '…' : s; });
    g.append('path').call(grow, 'd', () => barPath(lw, 0, 0, bh, 'right'), (d) => barPath(lw, 0, Math.max(2, x(value(d))), bh, 'right')).attr('fill', color);
    g.append('text').attr('class', 'lbl-in').attr('x', (d) => lw + x(value(d)) + 6).attr('y', bh / 2).attr('dy', '0.35em').text((d) => fmt(value(d))).call(grow, 'opacity', 0, 1);
    g.append('rect').attr('class', 'hit').attr('y', -gap / 2).attr('width', w).attr('height', bh + gap).attr('fill', 'transparent')
      .on('mousemove', (e, d) => showTip(tip, el, e, (t) => tipFn(t, d))).on('mouseleave', () => hideTip(tip));
  }

  // ---------- charts ----------
  function drawYears() {
    const el = $('#ch-years'), rows = state(el, 'per_year'); if (!rows) return;
    legend($('#leg-years'), [[C[0], 'First reads'], [C[1], 'Re-reads']]);
    const h = 260, { svg, w, tip } = svgIn(el, h), m = { t: 18, r: 4, b: 24, l: 28 };
    const x = d3.scaleBand(rows.map((r) => r.year), [m.l, w - m.r]).padding(0.25);
    const y = d3.scaleLinear([0, d3.max(rows, (r) => r.finished) || 1], [h - m.b, m.t]).nice();
    axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)));
    svg.select('.domain').remove();
    const every = Math.ceil(rows.length / Math.max(1, Math.floor((w - m.l) / 44)));
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(rows.filter((r, i) => i % every === 0).map((r) => r.year)).tickFormat(String).tickSize(0).tickPadding(8));
    const bw = Math.min(MARK.bar, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d) => `translate(${x(d.year) + off},0)`);
    // re-reads stack on first reads with a surface gap between; only the top segment is rounded
    g.append('path').call(grow, 'd', () => barPath(0, y(0), bw, 0), (d) => barPath(0, y(d.first_reads), bw, y(0) - y(d.first_reads), 'up', d.finished > d.first_reads ? 0 : MARK.radius)).attr('fill', C[0]);
    g.filter((d) => d.finished > d.first_reads).append('path').call(grow, 'd', () => barPath(0, y(0), bw, 0), (d) => barPath(0, y(d.finished), bw, y(d.first_reads) - y(d.finished) - MARK.gap)).attr('fill', C[1]);
    g.append('text').attr('class', 'lbl-in').attr('x', bw / 2).attr('y', (d) => y(d.finished) - 5).attr('text-anchor', 'middle').text((d) => (d.finished ? d.finished : '')).call(grow, 'opacity', 0, 1);
    g.append('rect').attr('class', 'hit').attr('x', -off - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent').call(links, 'year', (d) => d.year)
      .on('mousemove', (e, d) => showTip(tip, el, e, (t) => tipLines(t, String(d.year), [[C[0], 'First reads', d.first_reads], [C[1], 'Re-reads', d.rereads], [null, 'Reads started', d.started], [null, 'Hours logged', d.hours ? fmt(d.hours) : '—']])))
      .on('mouseleave', () => hideTip(tip));
  }

  function drawMonths() {
    const el = $('#ch-months'), rows = state(el, 'per_month'); if (!rows || !rows.length) return; // none without the daily log
    const h = 240, { svg, w, tip } = svgIn(el, h), m = { t: 10, r: 6, b: 24, l: 30 };
    const x = d3.scaleBand(rows.map((r) => r.month), [m.l, w - m.r]).padding(0.15);
    const y = d3.scaleLinear([0, d3.max(rows, (r) => r.hours) || 1], [h - m.b, m.t]).nice();
    axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)));
    svg.select('.domain').remove();
    const jan = rows.filter((r) => r.month.endsWith('-01')).map((r) => r.month);
    const step = Math.ceil(jan.length / Math.max(1, Math.floor((w - m.l) / 46)));
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(jan.filter((_, i) => i % step === 0)).tickFormat((s) => s.slice(0, 4)).tickSize(0).tickPadding(8));
    svg.append('g').selectAll('path').data(rows).join('path').call(grow, 'd', (d) => barPath(x(d.month), y(0), x.bandwidth(), 0), (d) => barPath(x(d.month), y(d.hours), x.bandwidth(), y(0) - y(d.hours))).attr('fill', 'var(--cds-chart-muted)');
    svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', C[0]).attr('stroke-width', MARK.line).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
      .attr('d', d3.line((d) => x(d.month) + x.bandwidth() / 2, (d) => y(d.rolling))).call(drawIn);
    const last = rows[rows.length - 1];
    svg.append('circle').attr('class', 'ring').attr('cx', x(last.month) + x.bandwidth() / 2).attr('cy', y(last.rolling)).call(grow, 'r', 0, MARK.dot).attr('fill', C[0]);
    svg.append('g').selectAll('rect').data(rows).join('rect').attr('class', 'hit').attr('x', (d) => x(d.month) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (e, d) => showTip(tip, el, e, (t) => tipLines(t, fShort(pDate(d.month + '-01')), [['var(--cds-chart-muted)', 'Hours', d.hours], [C[0], '12-month average', d.rolling]])))
      .on('mouseleave', () => hideTip(tip));
  }

  function drawGenre() {
    const el = $('#ch-genre'), rows = state(el, 'genre_counts'); if (!rows) return;
    hbars(el, rows, { field: 'genre', value: (r) => r.books, color: (r) => gColor(r.genre), tipFn: (t, d) => tipLines(t, d.genre, [[null, 'Books finished', d.books], [null, 'Hours', fmt(d.hours)]]) });
  }
  function drawSub() {
    const el = $('#ch-sub'), rows = state(el, 'subgenres'); if (!rows) return;
    hbars(el, rows, { field: 'subgenre', value: (r) => r.books, color: (r) => gColor(r.genre), tipFn: (t, d) => tipLines(t, d.subgenre, [[gColor(d.genre), d.genre, d.books + ' books']]) });
  }
  function drawAuthors() {
    const el = $('#ch-authors'), rows = state(el, 'authors'); if (!rows) return;
    hbars(el, rows, { field: 'author', value: (r) => r.finished, color: (r) => gColor(r.genre), tipFn: (t, d) => tipLines(t, d.author, [[null, 'Books finished', d.finished], [null, 'Hours', fmt(d.hours)]]) });
  }

  // a streamgraph of hours per genre per month, lightly smoothed
  function drawGenreStream() {
    const el = $('#ch-gy'), rows = state(el, 'genre_month'); if (!rows) return;
    if (!rows.length) { el.replaceChildren(Object.assign(document.createElement('div'), { className: 'fail', textContent: 'No reading yet' })); return; }
    const mDate = (m) => pDate(m + '-01'), mid = (d) => d3.utcDay.offset(d, 14);
    const months = d3.utcMonths(d3.utcMonth.offset(mDate(rows[0].month), -1), d3.utcMonth.offset(mDate(rows[rows.length - 1].month), 2));
    const genres = [...genreOrder.filter((g) => rows.some((r) => r.genre === g)), ...new Set(rows.map((r) => r.genre).filter((g) => !genreOrder.includes(g)))];
    genreLegend($('#leg-gy'), genres);
    const at = new Map(rows.map((r) => [r.month + '|' + r.genre, r.hours]));
    // the first and last months are empty padding, so streams taper to a point
    const raw = months.map((d, i) => { const m = iso(d).slice(0, 7), o = { date: mid(d), month: m }; genres.forEach((g) => (o[g] = i === 0 || i === months.length - 1 ? 0 : at.get(m + '|' + g) || 0)); return o; });
    const tbl = raw.map((o, i) => { const s = { ...o }; genres.forEach((g) => { const a = raw[i - 1], b = raw[i + 1]; s[g] = i === 0 || i === raw.length - 1 ? 0 : ((a ? a[g] : 0) + 2 * o[g] + (b ? b[g] : 0)) / 4; }); return s; });
    const series = d3.stack().keys(genres).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut)(tbl);
    const phone = el.clientWidth < 520, h = phone ? 240 : 320, { svg, w, tip } = svgIn(el, h), m = { t: 26, r: 18, b: 26, l: 6 };
    svg.attr('class', 'gs');
    const x = d3.scaleUtc([raw[0].date, raw[raw.length - 1].date], [m.l, w - m.r]);
    const y = d3.scaleLinear([d3.min(series, (s) => d3.min(s, (d) => d[0])), d3.max(series, (s) => d3.max(s, (d) => d[1]))], [h - m.b, m.t]);
    const years = d3.utcYears(d3.utcYear.ceil(raw[0].date), raw[raw.length - 1].date);
    svg.append('g').selectAll('line').data(years).join('line').attr('class', 'gs-yr').attr('x1', x).attr('x2', x).attr('y1', m.t).attr('y2', h - m.b);
    const every = Math.ceil(years.length / Math.max(1, Math.floor(w / 60)));
    const ax = svg.append('g').attr('transform', `translate(0,${h - m.b})`);
    axis(ax, d3.axisBottom(x).tickValues(years.filter((d, i) => i % every === 0)).tickFormat(d3.utcFormat('%Y')).tickSize(0).tickPadding(8));
    ax.select('.domain').remove();
    ax.selectAll('.tick text').attr('text-anchor', 'start').attr('dx', 4).each(function (d) { link(this, 'year', d.getUTCFullYear()); });
    const area = d3.area().x((d) => x(d.data.date)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis);
    const flat = d3.area().x((d) => x(d.data.date)).y0((d) => y((d[0] + d[1]) / 2)).y1((d) => y((d[0] + d[1]) / 2)).curve(d3.curveBasis);
    svg.append('g').selectAll('path').data(series).join('path').attr('class', 'gs-stream').call(grow, 'd', flat, area).attr('fill', (s) => gColor(s.key)).call(links, 'genre', (s) => s.key);
    // names inside the streams, where there's room, in white or near-black, whichever reads better
    const cs = getComputedStyle(document.documentElement);
    const inkOn = (c) => { const v = d3.color(c.startsWith('var(') ? cs.getPropertyValue(c.slice(4, -1)).trim() : c); if (!v) return '#fff'; const { r, g, b } = v.rgb(); return 0.299 * r + 0.587 * g + 0.114 * b > 135 ? '#1a1816' : '#fff'; };
    const lbl = svg.append('g').attr('class', 'gs-lbls');
    series.forEach((s) => {
      const th = s.map((d) => y(d[0]) - y(d[1])), i = d3.maxIndex(th);
      if (th[i] < 15) return;
      let a = i, b = i; while (a > 0 && th[a - 1] >= 13) a--; while (b < th.length - 1 && th[b + 1] >= 13) b++;
      const t = lbl.append('text').attr('class', 'gs-lbl').attr('x', x(s[i].data.date)).attr('y', (y(s[i][0]) + y(s[i][1])) / 2).attr('dy', '0.35em').attr('fill', inkOn(gColor(s.key))).text(s.key);
      const tw = t.node().getComputedTextLength(), room = x(s[b].data.date) - x(s[a].data.date);
      if (tw + 10 > room) { t.remove(); return; }
      const cx = Math.min(Math.max(x(s[i].data.date), x(s[a].data.date) + tw / 2 + 5, m.l + tw / 2 + 2), x(s[b].data.date) - tw / 2 - 5, w - m.r - tw / 2 - 2);
      t.attr('x', cx);
    });
    // scale: a bar for a round number of hours
    const per = d3.tickStep(0, (y.domain()[1] - y.domain()[0]) / 4, 1), bh = y(0) - y(per);
    const sc = svg.append('g').attr('class', 'gs-scale').attr('transform', `translate(${w - 5},${m.t})`);
    sc.append('line').attr('y2', bh); sc.append('line').attr('x1', -3).attr('x2', 3); sc.append('line').attr('x1', -3).attr('x2', 3).attr('y1', bh).attr('y2', bh);
    sc.append('text').attr('class', 'axl').attr('x', 4).attr('y', -9).attr('text-anchor', 'end').text(`${fmt(per)} h a month`);
    // hover: a guide and that month's hours by genre
    const guide = svg.append('line').attr('class', 'gs-guide').attr('y1', m.t).attr('y2', h - m.b).style('display', 'none');
    svg.on('mousemove', (e) => {
      const [px] = d3.pointer(e, svg.node()), i = Math.max(1, Math.min(raw.length - 2, d3.leastIndex(raw, (d) => Math.abs(x(d.date) - px))));
      const o = raw[i], tot = d3.sum(genres, (g) => o[g]);
      guide.style('display', null).attr('x1', x(o.date)).attr('x2', x(o.date));
      const hov = e.target.__data__ && e.target.__data__.key;
      showTip(tip, el, e, (t) => tipLines(t, `${d3.utcFormat('%B %Y')(mDate(o.month))} · ${fmt(Math.round(tot * 10) / 10)} h`, genres.filter((g) => o[g] > 0).sort((a, b) => o[b] - o[a]).map((g) => [gColor(g), g === hov ? '▸ ' + g : g, fmt(o[g]) + ' h'])));
    }).on('mouseleave', () => { guide.style('display', 'none'); hideTip(tip); });
  }

  // ---------- date ranges (heatmap, timeline, diary, speed over time) ----------
  const RANGE_DEFAULTS = { heat: '12m', gantt: '24m', diary: '30d', speedtl: '12m' };
  const iso = (d) => d.toISOString().slice(0, 10);
  const params = () => (dash.params ? dash.params() || {} : {});
  const asOf = () => { const r = D('as_of'); return r.status === 'ok' && r.data[0] ? r.data[0].date : null; };
  const firstDay = () => { const r = D('day_totals'); return r.status === 'ok' && r.data.length ? r.data[0].date : null; };
  function resolveRange(key) {
    const end0 = asOf(); if (!end0) return null;
    const p = params(), E = pDate(end0), preset = p[key + '_preset'] || RANGE_DEFAULTS[key];
    let s, e = end0;
    if (preset === '30d') s = iso(d3.utcDay.offset(E, -29));
    else if (preset === '90d') s = iso(d3.utcDay.offset(d3.utcMonth.offset(E, -3), 1));
    else if (preset === '12m') s = iso(d3.utcDay.offset(d3.utcYear.offset(E, -1), 1));
    else if (preset === '24m') s = iso(d3.utcDay.offset(d3.utcYear.offset(E, -2), 1));
    else if (preset === 'ytd') s = end0.slice(0, 4) + '-01-01';
    else if (preset === 'ly') { const y = +end0.slice(0, 4) - 1; s = y + '-01-01'; e = y + '-12-31'; }
    else if (preset === 'all') s = firstDay() || end0;
    else { s = p[key + '_start'] || iso(d3.utcDay.offset(E, -29)); e = p[key + '_end'] || end0; }
    if (s > e) [s, e] = [e, s];
    return { preset, start: s, end: e, days: d3.utcDay.count(pDate(s), pDate(e)) + 1 };
  }
  const rangeLabel = (R) => `${fDay(pDate(R.start))} – ${fDay(pDate(R.end))}`;
  function syncRanges() {
    document.querySelectorAll('.rng').forEach((box) => {
      const R = resolveRange(box.dataset.range); if (!R) return;
      const sel = box.querySelector('select'), [f, t] = box.querySelectorAll('input[type=date]');
      sel.value = R.preset; box.dataset.preset = R.preset;
      const lo = firstDay() || '', hi = asOf() || '';
      [f, t].forEach((inp) => { inp.min = lo; inp.max = hi; });
      if (f !== document.activeElement) f.value = R.start;
      if (t !== document.activeElement) t.value = R.end;
    });
  }
  document.querySelectorAll('.rng').forEach((box) => {
    const key = box.dataset.range, sel = box.querySelector('select'), inputs = box.querySelectorAll('input[type=date]');
    sel.addEventListener('change', () => {
      const ps = { [key + '_preset']: sel.value };
      if (sel.value === 'custom') { const R = resolveRange(key); if (R) { ps[key + '_start'] = R.start; ps[key + '_end'] = R.end; } }
      if (key === 'diary') diaryLimit = DIARY_PAGE;
      dash.setParams(ps);
    });
    inputs.forEach((inp, i) => {
      inp.addEventListener('change', () => {
        if (!inp.value || !inp.validity.valid || !/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) return;
        const R = resolveRange(key); if (!R) return;
        if (key === 'diary') diaryLimit = DIARY_PAGE;
        dash.setParams({ [key + '_preset']: 'custom', [key + '_start']: i === 0 ? inp.value : R.start, [key + '_end']: i === 1 ? inp.value : R.end });
      });
      inp.addEventListener('blur', syncRanges);
    });
  });

  function drawHeat() {
    const el = $('#ch-heat'), rows = state(el, 'day_totals'); if (!rows) return;
    const R = resolveRange('heat'); if (!R) return;
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const days = d3.utcDay.range(pDate(R.start), d3.utcDay.offset(pDate(R.end), 1)).map((d) => {
      const k = iso(d), r = byDate.get(k);
      return { date: k, d, minutes: r ? r.minutes : 0, words: r ? r.words : 0, books: r ? r.books : '' };
    });
    // up to a year: one strip; longer: one strip per calendar year, newest first
    let blocks = days.length <= 371 ? [{ label: null, days }]
      : d3.groups(days, (x) => x.date.slice(0, 4)).map(([label, ds]) => ({ label, days: ds })).reverse();
    const lab = 28, w0 = Math.max(280, el.clientWidth), weekOf = (b, d) => d3.utcMonday.count(b.w0, d);
    blocks.forEach((b) => {
      b.w0 = d3.utcMonday.floor(b.days[0].d); b.weeks = weekOf(b, b.days[b.days.length - 1].d) + 1;
      b.read = b.days.filter((r) => r.minutes > 0 || r.books).length; b.mins = d3.sum(b.days, (r) => r.minutes);
    });
    // on narrow screens, wrap a strip into shorter ones so squares stay big enough to tap
    const fit = Math.max(4, Math.floor((w0 - lab) / 11));
    blocks = blocks.flatMap((b) => {
      if (b.weeks <= fit) return [b];
      const size = Math.ceil(b.weeks / Math.ceil(b.weeks / fit));
      return d3.groups(b.days, (r) => Math.floor(weekOf(b, r.d) / size)).map(([, ds], i) => {
        const c = { label: i === 0 ? b.label : null, read: b.read, mins: b.mins, days: ds };
        c.w0 = d3.utcMonday.floor(ds[0].d); c.weeks = d3.utcMonday.count(c.w0, ds[ds.length - 1].d) + 1;
        return c;
      });
    });
    const maxWeeks = d3.max(blocks, (b) => b.weeks);
    const cs = Math.max(6, Math.min(18, Math.floor((w0 - lab) / maxWeeks) - 2)), cell = cs + 2, monthRow = 14;
    let y0 = 0;
    blocks.forEach((b) => { b.y = y0; b.yr = b.label ? 20 : 0; y0 += b.yr + monthRow + 7 * cell + 14; });
    const h = y0;
    el.style.minHeight = h + 'px';
    const { svg, tip } = svgIn(el, h);
    const max = d3.quantile(days.map((r) => r.minutes).filter((v) => v > 0).sort(d3.ascending), 0.95) || 1;
    const op = d3.scaleSqrt([0, max], [0.18, 1]).clamp(true);
    blocks.forEach((b) => {
      const yrRow = b.yr, g = svg.append('g').attr('transform', `translate(0,${b.y})`), top = yrRow + monthRow;
      if (b.label) {
        g.append('text').attr('class', 'yr-lbl').attr('x', 0).attr('y', 13).text(b.label)
          .append('tspan').attr('class', 'axl').attr('dx', 8).text(`${fmt(b.read)} days · ${fmt(Math.round(b.mins / 60))} h`);
      }
      ['Mon', 'Wed', 'Fri'].forEach((n, i) => g.append('text').attr('class', 'axl').attr('x', 0).attr('y', top + i * 2 * cell + cs / 2).attr('dy', '0.35em').text(n));
      let lastM = '', lastX = -99;
      b.days.forEach((r) => {
        const m = r.date.slice(0, 7); if (m === lastM) return; lastM = m;
        const x = lab + weekOf(b, r.d) * cell;
        if (x - lastX > 30) { g.append('text').attr('class', 'axl').attr('x', x).attr('y', yrRow + 10).text(d3.utcFormat('%b')(r.d)); lastX = x; }
      });
      g.append('g').selectAll('rect').data(b.days).join('rect').attr('class', 'day')
        .attr('x', (r) => lab + weekOf(b, r.d) * cell).attr('y', (r) => top + ((r.d.getUTCDay() + 6) % 7) * cell)
        .attr('width', cs).attr('height', cs).attr('rx', Math.min(3, cs / 4))
        .attr('fill', (r) => (r.minutes > 0 || r.books ? C[0] : 'var(--cds-chart-grid)'))
        .attr('fill-opacity', (r) => (r.minutes > 0 ? op(r.minutes) : r.books ? 0.18 : 1))
        .on('mousemove', (e, r) => showTip(tip, el, e, (t) => {
          tipLines(t, d3.utcFormat('%a %-d %b %Y')(r.d), [[null, 'Minutes', r.minutes ? fmt(r.minutes) : '—']]);
          if (r.books) r.books.split('; ').forEach((bk) => t.append('div').text(bk));
        }))
        .on('mouseleave', () => hideTip(tip))
        .on('click', (e, r) => { hideTip(tip); openDiary(r.date); });
    });
    const read = days.filter((r) => r.minutes > 0 || r.books).length, mins = d3.sum(days, (r) => r.minutes);
    $('#heat-note').textContent = `${rangeLabel(R)}: read on ${fmt(read)} of ${fmt(days.length)} days, ${fmt(Math.round(mins / 60))} hours. Hover a square for the books; click it to open that day in the diary.`;
    const lg = $('#hm-leg'); lg.replaceChildren(document.createTextNode('Less'));
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => { const i = document.createElement('i'); i.style.background = f ? C[0] : 'var(--cds-chart-grid)'; if (f) i.style.opacity = op(f * max); lg.append(i); });
    lg.append(document.createTextNode('More'));
  }

  function drawGantt() {
    const el = $('#ch-gantt'), all = state(el, 'timeline'); if (!all) return;
    const R = resolveRange('gantt'); if (!R) return;
    const rows = all.filter((r) => r.end >= R.start && r.start <= R.end);
    const genres = genreOrder.filter((g) => rows.some((r) => r.genre === g));
    genreLegend($('#leg-gantt'), genres);
    $('#gantt-note').textContent = `${rangeLabel(R)}: ${fmt(rows.length)} read${rows.length === 1 ? '' : 's'}, one bar from first to last day, solid on the days the book was opened. Colour is genre; faded bars weren't finished. ↻ marks a re-read.`;
    if (!rows.length) { el.style.minHeight = '80px'; el.replaceChildren(Object.assign(document.createElement('div'), { className: 'dy-empty', textContent: 'No reads in this period.' })); return; }
    const rh = 16, m = { t: 22, r: 8, b: 4, l: 8 }, h = m.t + rows.length * rh + m.b;
    el.style.minHeight = h + 'px';
    const { svg, w, tip } = svgIn(el, h);
    const lo = pDate(R.start), hi = d3.utcDay.offset(pDate(R.end), 1);
    const x = d3.scaleUtc([lo, hi], [m.l, w - m.r]);
    const x0 = (d) => x(pDate(d.start < R.start ? R.start : d.start)), x1 = (d) => x(d3.utcDay.offset(pDate(d.end > R.end ? R.end : d.end), 1));
    axis(svg.append('g').attr('transform', `translate(0,${m.t - 4})`), d3.axisTop(x).ticks(Math.max(2, Math.floor(w / 90))).tickFormat(d3.utcFormat(R.days <= 120 ? '%-d %b' : '%b %y')).tickSize(-(h - m.t)));
    svg.select('.domain').remove();
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${m.t + i * rh})`);
    // the whole span faintly, then the days the book was actually opened on top
    g.append('rect').attr('x', x0).attr('y', 2).attr('height', rh - 4).attr('rx', 3)
      .attr('width', (d) => Math.max(3, x1(d) - x0(d))).attr('fill', (d) => gColor(d.genre)).attr('fill-opacity', 0.16);
    g.each(function (d) {
      const runs = (d.active || []).filter(([s, e]) => e >= R.start && s <= R.end);
      d3.select(this).selectAll('rect.run').data(runs).join('rect').attr('class', 'run')
        .attr('x', ([s]) => x0({ start: s })).attr('y', 2).attr('height', rh - 4).attr('rx', 1.5)
        .attr('width', ([s, e]) => Math.max(1.5, x1({ end: e }) - x0({ start: s }))).attr('fill', gColor(d.genre)).attr('fill-opacity', d.finished ? 1 : 0.5);
    });
    g.append('text').attr('class', 'axl').attr('y', rh / 2).attr('dy', '0.35em')
      .each(function (d) {
        const t = d3.select(this).text((d.read_no > 1 ? '↻ ' : '') + d.title);
        const xe = x1(d) + 5, len = this.getComputedTextLength();
        if (xe + len < w) t.attr('x', xe); else if (x0(d) - 5 - len > 0) t.attr('x', x0(d) - 5).attr('text-anchor', 'end'); else t.attr('x', x0(d) + 4).style('fill', 'var(--color-fg)');
      });
    g.append('rect').attr('class', 'hit').attr('width', w).attr('height', rh).attr('fill', 'transparent').call(links, 'book', (d) => d.book_id)
      .on('mousemove', (e, d) => showTip(tip, el, e, (t) => tipLines(t, d.title, [[gColor(d.genre), d.genre, ''], [null, 'From', fDay(pDate(d.start))], [null, 'To', fDay(pDate(d.end))], [null, 'Opened on', `${fmt(d3.sum(d.active || [], ([a, b]) => d3.utcDay.count(pDate(a), pDate(b)) + 1))} of ${fmt(d3.utcDay.count(pDate(d.start), pDate(d.end)) + 1)} days`], [null, 'Reached', d.progress != null ? d.progress + '%' : '—']])))
      .on('mouseleave', () => hideTip(tip));
  }

  // ---------- speed ----------
  const avgWpm = () => { const r = D('speed_overall'); const row = r.status === 'ok' ? r.data.find((x) => x.metric === 'avg_wpm') : null; return row ? row.value : null; };
  const vsAvg = (v) => (v == null ? '' : Math.abs(v) < 0.005 ? 'your average' : `${Math.round(Math.abs(v) * 100)}% ${v > 0 ? 'faster' : 'slower'}`);

  function drawSpeedBooks() {
    const el = $('#ch-speed-books'), rows = state(el, 'book_speed'); if (!rows) return;
    const avg = avgWpm();
    if (!rows.length) { el.style.minHeight = '80px'; el.replaceChildren(Object.assign(document.createElement('div'), { className: 'dy-empty', textContent: 'Not enough timed reading yet.' })); return; }
    const genres = genreOrder.filter((g) => rows.some((r) => r.genre === g)).concat([...new Set(rows.map((r) => r.genre))].filter((g) => !genreOrder.includes(g)));
    genreLegend($('#leg-speed'), genres);
    const w0 = Math.max(280, el.clientWidth), probe = d3.select(el).append('svg').attr('width', 0).attr('height', 0);
    const lab = Math.min(w0 * 0.3, measure(probe, genres) + 12); probe.remove();
    const m = { t: 22, r: 12, b: 26, l: lab };
    const x = d3.scaleLinear(d3.extent(rows.concat(avg ? [{ wpm: avg }] : []), (r) => r.wpm), [m.l, w0 - m.r]).nice();
    const rad = d3.scaleSqrt([0, d3.max(rows, (r) => r.hours)], [2.5, w0 < 500 ? 7 : 10]);
    // beeswarm per genre row: place each dot at the smallest offset that doesn't overlap
    const lanes = genres.map((g) => {
      const placed = [], dots = rows.filter((r) => r.genre === g).sort((a, b) => b.hours - a.hours).map((r) => ({ ...r, x: x(r.wpm), r: rad(r.hours) }));
      dots.forEach((d) => {
        for (let k = 0; ; k++) {
          const y = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2;
          if (placed.every((p) => (p.x - d.x) ** 2 + (p.y - y) ** 2 >= (p.r + d.r + 1) ** 2)) { d.y = y; break; }
        }
        placed.push(d);
      });
      const lo = d3.min(placed, (d) => d.y - d.r) ?? -10, hi = d3.max(placed, (d) => d.y + d.r) ?? 10;
      return { g, dots: placed, lo, hi, h: Math.max(28, hi - lo + 10) };
    });
    let y0 = m.t; lanes.forEach((l) => { l.top = y0; l.mid = y0 + l.h / 2 - (l.hi + l.lo) / 2; y0 += l.h; });
    const h = y0 + m.b;
    el.style.minHeight = h + 'px';
    const { svg, tip } = svgIn(el, h);
    lanes.forEach((l, i) => { if (i) svg.append('line').attr('x1', m.l).attr('x2', w0 - m.r).attr('y1', l.top).attr('y2', l.top).attr('stroke', 'var(--cds-chart-grid)'); });
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(Math.max(3, Math.floor(w0 / 80))).tickFormat((v) => v + ' wpm').tickSizeOuter(0));
    if (avg) {
      refLine(svg, x(avg), m.t - 6, x(avg), h - m.b);
      svg.append('text').attr('class', 'axl').attr('x', x(avg)).attr('y', m.t - 10).attr('text-anchor', 'middle').text(`your average ${avg} wpm`);
    }
    lanes.forEach((l) => {
      link(svg.append('text').attr('class', 'axl').attr('x', m.l - 10).attr('y', l.top + l.h / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(l.g).node(), 'genre', l.g);
      svg.append('g').selectAll('circle').data(l.dots).join('circle')
        .attr('cx', (d) => d.x).attr('cy', (d) => l.mid + d.y).call(grow, 'r', 0, (d) => d.r)
        .attr('class', 'ring').attr('fill', gColor(l.g)).attr('fill-opacity', 0.75).call(links, 'book', (d) => d.book_id)
        .on('mousemove', (e, d) => showTip(tip, el, e, (t) => tipLines(t, d.title, [[gColor(d.genre), d.subgenre || d.genre, ''], [null, 'Author', d.author || '—'], [null, 'Speed', `${d.wpm} wpm (${vsAvg(d.vs_avg)})`], [null, 'Timed', `${d.hours} h over ${d.days} days`]])))
        .on('mouseleave', () => hideTip(tip));
    });
  }

  // speed over time: a dot per book per day, a rolling average, and each book as a bar at its speed
  const tlBooks = $('#speedtl-books');
  tlBooks.addEventListener('change', () => dash.setParams({ speedtl_books: tlBooks.checked ? null : 0 }));
  function drawSpeedTimeline() {
    const el = $('#ch-speedtl'), all = state(el, 'speed_days'); if (!all) return;
    const R = resolveRange('speedtl'); if (!R) return;
    const showBooks = params().speedtl_books !== 0; tlBooks.checked = showBooks;
    const rows = all.filter((r) => r.date >= R.start && r.date <= R.end);
    const genres = genreOrder.filter((g) => rows.some((r) => r.genre === g));
    genreLegend($('#leg-speedtl'), genres);
    if (!rows.length) {
      $('#speedtl-note').textContent = `${rangeLabel(R)}: no timed reading in this period (Moon+ logs minutes and words from 2019).`;
      el.style.minHeight = '80px'; el.replaceChildren(Object.assign(document.createElement('div'), { className: 'dy-empty', textContent: 'No timed reading in this period.' })); return;
    }
    // rolling average over the last `win` days, weighted by minutes; reaches back before the range so the line starts filled
    const win = R.days <= 120 ? 7 : R.days <= 800 ? 30 : 90;
    const perDay = d3.rollup(all, (v) => ({ w: d3.sum(v, (r) => r.words), m: d3.sum(v, (r) => r.minutes) }), (r) => r.date);
    const trend = d3.utcDay.range(pDate(R.start), d3.utcDay.offset(pDate(R.end), 1)).map((d) => {
      let w = 0, m = 0;
      for (let k = 0; k < win; k++) { const p = perDay.get(iso(d3.utcDay.offset(d, -k))); if (p) { w += p.w; m += p.m; } }
      return { d, wpm: m >= 30 ? w / m : null };
    });
    const books = d3.groups(rows, (r) => r.book_id).map(([id, v]) => {
      const w = d3.sum(v, (r) => r.words), m = d3.sum(v, (r) => r.minutes);
      return { id, title: v[0].title, author: v[0].author, genre: v[0].genre, start: v[0].date, end: v[v.length - 1].date, days: v.length, m, wpm: w / m };
    }).filter((b) => b.m >= 30);
    const W = d3.sum(rows, (r) => r.words), M = d3.sum(rows, (r) => r.minutes), avg = avgWpm();
    $('#speedtl-note').textContent = `${rangeLabel(R)}: ${fmt(Math.round(W / M))} wpm over ${fmt(Math.round(M / 60))} timed hours. Dots are a book on a day (bigger dots, longer sessions); the line is a ${win}-day rolling average${showBooks ? '; bars show each book from first to last timed day at its speed' : ''}. Hover for details.`;

    const h = 340, { svg, w, tip } = svgIn(el, h), m = { t: 22, r: 10, b: 24, l: 34 };
    el.style.minHeight = h + 'px';
    const x = d3.scaleUtc([pDate(R.start), d3.utcDay.offset(pDate(R.end), 1)], [m.l, w - m.r]);
    const vals = rows.map((r) => r.wpm).sort(d3.ascending);
    const lo = Math.min(d3.quantile(vals, 0.01), d3.min(trend, (t) => t.wpm) ?? Infinity, avg ?? Infinity);
    const hi = Math.max(d3.quantile(vals, 0.99), d3.max(trend, (t) => t.wpm) ?? 0, avg ?? 0);
    const y = d3.scaleLinear([Math.max(0, lo - 20), hi + 20], [h - m.b, m.t]).nice();
    const [y0, y1] = y.domain(), cy = (v) => y(Math.max(y0, Math.min(y1, v)));
    axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)));
    svg.select('.domain').remove();
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(Math.max(2, Math.floor(w / 90))).tickFormat(d3.utcFormat(R.days <= 120 ? '%-d %b' : '%b %y')).tickSizeOuter(0));
    svg.append('text').attr('class', 'axl').attr('x', m.l + 4).attr('y', m.t - 8).text('words per minute');
    if (avg) {
      refLine(svg, m.l, y(avg), w - m.r, y(avg));
      svg.append('text').attr('class', 'axl').attr('x', w - m.r).attr('y', y(avg) - 5).attr('text-anchor', 'end').text(`your average ${avg}`);
    }
    const mid = (s) => d3.utcHour.offset(pDate(s), 12);
    const rad = d3.scaleSqrt([0, d3.max(rows, (r) => r.minutes)], [1.5, w < 500 ? 4 : 5.5]);
    svg.append('g').selectAll('circle').data(rows).join('circle')
      .attr('cx', (d) => x(mid(d.date))).attr('cy', (d) => cy(d.wpm)).call(grow, 'r', 0, (d) => rad(d.minutes))
      .attr('fill', (d) => gColor(d.genre)).attr('fill-opacity', showBooks ? 0.3 : 0.6);
    svg.append('path').datum(trend).attr('fill', 'none').attr('stroke', 'var(--color-fg)').attr('stroke-width', MARK.line).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('d', d3.line((t) => x(d3.utcHour.offset(t.d, 12)), (t) => y(t.wpm)).defined((t) => t.wpm != null).curve(d3.curveMonotoneX)).call(drawIn);
    // hover anywhere: that day's reading and the rolling average
    const byDate = d3.group(rows, (r) => r.date), tAt = new Map(trend.map((t) => [iso(t.d), t.wpm]));
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (e) => {
        const day = iso(d3.utcDay.floor(x.invert(d3.pointer(e)[0]))), v = byDate.get(day) || [], t = tAt.get(day);
        showTip(tip, el, e, (tp) => tipLines(tp, d3.utcFormat('%a %-d %b %Y')(pDate(day)),
          [[null, `${win}-day average`, t != null ? Math.round(t) + ' wpm' : '—'], ...v.map((r) => [gColor(r.genre), r.title, `${r.wpm} wpm · ${mins(r.minutes)}`])]));
      })
      .on('mouseleave', () => hideTip(tip));
    if (!showBooks) return;
    const bx0 = (b) => x(pDate(b.start)), bx1 = (b) => x(d3.utcDay.offset(pDate(b.end), 1));
    const g = svg.append('g').selectAll('g').data(books).join('g');
    g.append('rect').attr('x', bx0).attr('y', (b) => cy(b.wpm) - 3).attr('height', 6).attr('rx', 3)
      .attr('width', (b) => Math.max(4, bx1(b) - bx0(b))).attr('fill', (b) => gColor(b.genre)).attr('class', 'ring');
    g.append('text').attr('class', 'lbl-in').attr('x', bx0).attr('y', (b) => cy(b.wpm) - 7).text((b) => b.title)
      .each(function (b) { if (this.getComputedTextLength() > bx1(b) - bx0(b) + 24) this.remove(); });
    g.append('rect').attr('x', (b) => bx0(b) - 2).attr('y', (b) => cy(b.wpm) - 8).attr('height', 16)
      .attr('width', (b) => Math.max(8, bx1(b) - bx0(b) + 4)).attr('fill', 'transparent').call(links, 'book', (b) => b.id)
      .on('mousemove', (e, b) => showTip(tip, el, e, (tp) => tipLines(tp, b.title, [[gColor(b.genre), b.genre, ''], [null, 'Author', b.author || '—'],
        [null, 'Speed', `${Math.round(b.wpm)} wpm${avg ? ` (${vsAvg(b.wpm / avg - 1)})` : ''}`], [null, 'Timed', `${mins(b.m)} over ${b.days} day${b.days === 1 ? '' : 's'}`],
        [null, 'Dates', `${fDay(pDate(b.start))} – ${fDay(pDate(b.end))}`]])))
      .on('mouseleave', () => hideTip(tip));
  }

  // lollipops from your average to each group's speed
  function speedDots(el, rows, avg) {
    if (!rows.length) { el.style.minHeight = '80px'; el.replaceChildren(Object.assign(document.createElement('div'), { className: 'dy-empty', textContent: 'Not enough timed reading yet.' })); return; }
    const rh = 26, m = { t: 20, r: 44, b: 6 }, h = m.t + rows.length * rh + m.b, w0 = Math.max(280, el.clientWidth);
    el.style.minHeight = h + 'px';
    const probe = d3.select(el).append('svg').attr('width', 0).attr('height', 0);
    const short = (s) => (s.length > 26 ? s.slice(0, 25) + '…' : s);
    const lab = Math.min(w0 * 0.42, measure(probe, rows.map((r) => short(r.name))) + 12); probe.remove();
    const { svg, tip } = svgIn(el, h);
    const ext = d3.extent(rows.map((r) => r.wpm).concat(avg ? [avg] : []));
    const x = d3.scaleLinear([ext[0] - 8, ext[1] + 8], [lab, w0 - m.r]);
    if (avg) {
      refLine(svg, x(avg), m.t - 4, x(avg), h - m.b);
      svg.append('text').attr('class', 'axl').attr('x', x(avg)).attr('y', m.t - 8).attr('text-anchor', 'middle').text(`avg ${avg}`);
    }
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${m.t + i * rh + rh / 2})`).each(function (d) { link(this, d.kind, d.name); });
    g.append('text').attr('class', 'axl').attr('x', lab - 10).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => short(d.name));
    if (avg) g.append('line').attr('x1', x(avg)).call(grow, 'x2', x(avg), (d) => x(d.wpm)).attr('stroke', (d) => gColor(d.genre)).attr('stroke-width', MARK.line).attr('stroke-linecap', 'round').attr('stroke-opacity', 0.6);
    g.append('circle').attr('class', 'ring').attr('cx', (d) => x(d.wpm)).call(grow, 'r', 0, 5.5).attr('fill', (d) => gColor(d.genre));
    const leftOf = (d) => avg && d.wpm < avg && x(d.wpm) - lab > 40; // room for the number between name and dot?
    g.append('text').attr('class', 'lbl-in').attr('x', (d) => (leftOf(d) ? x(d.wpm) - 10 : avg && d.wpm < avg ? x(avg) + 8 : x(d.wpm) + 10)).attr('dy', '0.35em')
      .attr('text-anchor', (d) => (leftOf(d) ? 'end' : 'start')).text((d) => d.wpm);
    g.append('rect').attr('class', 'hit').attr('x', 0).attr('y', -rh / 2).attr('width', w0).attr('height', rh).attr('fill', 'transparent')
      .on('mousemove', (e, d) => showTip(tip, el, e, (t) => tipLines(t, d.name, [[gColor(d.genre), 'Speed', `${d.wpm} wpm`], [null, 'vs average', avg ? vsAvg(d.wpm / avg - 1) : '—'], [null, 'Timed', `${fmt(d.hours)} h · ${d.books} book${d.books === 1 ? '' : 's'}`]])))
      .on('mouseleave', () => hideTip(tip));
  }
  const kindSel = $('#genre-speed-kind');
  kindSel.addEventListener('change', () => dash.setParams({ speed_kind: kindSel.value }));
  function drawSpeedTab() {
    fillMetrics('speed_overall');
    const bsp = D('book_speed').status === 'ok' ? D('book_speed').data : [];
    link($('#kpi-fastest'), 'book', bsp.length ? bsp[0].book_id : null); link($('#kpi-slowest'), 'book', bsp.length ? bsp[bsp.length - 1].book_id : null);
    drawSpeedTimeline();
    drawSpeedBooks();
    const avg = avgWpm();
    const li = (r) => ({ note: `${r.hours} h timed`, meta: `${r.wpm} wpm · ${vsAvg(r.vs_avg)}` });
    list('#fast', 'book_speed', li, (rows) => rows.slice(0, 10));
    list('#slow', 'book_speed', li, (rows) => rows.slice(-10).reverse());
    const gs = D('group_speed'), kind = (params().speed_kind) || 'genre';
    kindSel.value = kind;
    $('#genre-speed-note').textContent = kind === 'genre' ? 'All timed reading in each genre (3+ hours), against your average.' : 'All timed reading in each subgenre (5+ hours), against your average.';
    const ge = $('#ch-genre-speed'), ae = $('#ch-author-speed');
    if (state(ge, 'group_speed')) speedDots(ge, gs.data.filter((r) => r.kind === kind), avg);
    if (state(ae, 'group_speed')) speedDots(ae, gs.data.filter((r) => r.kind === 'author'), avg);
    drawSpeed();
  }

  // ---------- diary ----------
  const DIARY_PAGE = 60;
  let diaryLimit = DIARY_PAGE, diaryFocus = null;
  function openDiary(date) {
    const s = date.slice(0, 8) + '01', last = iso(d3.utcDay.offset(d3.utcMonth.offset(pDate(s), 1), -1)), end = asOf();
    diaryFocus = date; diaryLimit = 400;
    dash.setParams({ diary_preset: 'custom', diary_start: s, diary_end: end && last > end ? end : last });
    show('diary');
  }
  $('#dy-more').addEventListener('click', () => { diaryLimit += 90; drawDiary(); });
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  const mins = (v) => (v >= 60 ? `${Math.floor(v / 60)} h ${Math.round(v % 60)} min` : `${Math.round(v)} min`);
  function drawDiary() {
    const list = $('#dy-list'), sum = $('#dy-sum'), more = $('#dy-more');
    const rows = state(list, 'diary'); if (!rows) { sum.replaceChildren(); more.hidden = true; return; }
    const R = resolveRange('diary'); if (!R) return;
    const inR = rows.filter((r) => r.date >= R.start && r.date <= R.end);
    const days = d3.groups(inR, (r) => r.date).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const totalMin = d3.sum(inR, (r) => r.minutes || 0), finished = inR.filter((r) => r.event === 'finished').length;
    const stat = (v, l) => { const d = el('div'); d.append(el('b', null, v), el('span', null, l)); return d; };
    sum.replaceChildren(
      stat(`${fmt(days.length)} / ${fmt(R.days)}`, 'days with reading'),
      stat(totalMin ? fmt(Math.round(totalMin / 60)) : '—', 'hours read'),
      stat(days.length && totalMin ? fmt(Math.round(totalMin / days.length)) : '—', 'minutes per reading day'),
      stat(fmt(new Set(inR.map((r) => r.book_id)).size), 'books opened'),
      stat(fmt(finished), 'books finished'));
    drawDiaryTimeline(inR, R, days);
    if (!days.length) { list.replaceChildren(el('div', 'dy-empty', `No reading recorded between ${fDay(pDate(R.start))} and ${fDay(pDate(R.end))}.`)); more.hidden = true; return; }
    const monthTotals = d3.rollup(inR, (v) => ({ days: new Set(v.map((r) => r.date)).size, min: d3.sum(v, (r) => r.minutes || 0), books: new Set(v.map((r) => r.book_id)).size }), (r) => r.date.slice(0, 7));
    const out = []; let month = '', prev = null;
    days.slice(0, diaryLimit).forEach(([date, entries]) => {
      const d = pDate(date), m = date.slice(0, 7);
      if (m !== month) {
        month = m; prev = null;
        const t = monthTotals.get(m), head = el('div', 'dy-month');
        head.append(el('h3', null, d3.utcFormat('%B %Y')(d)), el('span', null, `${t.days} days · ${t.min ? fmt(Math.round(t.min / 60)) + ' h' : '—'} · ${t.books} book${t.books === 1 ? '' : 's'}`));
        out.push(head);
      }
      if (prev) { const gap = d3.utcDay.count(d, prev) - 1; if (gap > 0) out.push(el('div', 'dy-gap', `${gap} day${gap === 1 ? '' : 's'} without reading`)); }
      prev = d;
      const row = el('div', 'dy-day'); row.id = 'day-' + date;
      const total = d3.sum(entries, (r) => r.minutes || 0), dc = el('div', 'dy-date');
      dc.append(el('b', null, d3.utcFormat('%a %-d')(d)), el('span', null, total ? mins(total) : '—'));
      const books = el('div');
      entries.slice().sort((a, b) => (b.minutes || 0) - (a.minutes || 0)).forEach((r) => {
        const bk = link(el('div', 'dy-book'), 'book', r.book_id), t = el('div', 't');
        bk.append(cover(r.book_id, r.title, r.genre, 'xs'));
        t.append(document.createTextNode(r.title));
        if (r.event) t.append(el('span', 'ev ' + r.event, r.event === 'finished' ? 'Finished' : r.event === 'reread' ? 'Started re-read' : 'Started'));
        t.append(byline('small', 'by', r));
        const bits = [];
        if (r.minutes) bits.push(mins(r.minutes));
        if (r.words) bits.push(fmt(r.words) + ' words');
        bk.append(t, el('div', 'm', bits.join(' · ') || ''));
        if (r.progress != null) {
          const p = el('div', 'dy-prog'), bar = el('div', 'bar'), from = r.prev_progress != null ? Math.min(r.prev_progress, r.progress) : null;
          const base = el('i'); base.style.left = '0'; base.style.width = (from ?? 0) + '%'; base.style.background = 'var(--cds-chart-muted)';
          const gain = el('i'); gain.style.left = (from ?? 0) + '%'; gain.style.width = Math.max(0.5, r.progress - (from ?? 0)) + '%'; gain.style.background = gColor(r.genre);
          bar.append(base, gain);
          const pc = (v) => (v >= 99.95 ? '100' : String(Math.round(v * 10) / 10)) + '%';
          p.append(bar, el('span', null, from != null && from !== r.progress ? `${pc(from)} → ${pc(r.progress)}` : pc(r.progress)));
          bk.append(p);
        }
        books.append(bk);
      });
      row.append(dc, books); out.push(row);
    });
    list.replaceChildren(...out);
    more.hidden = days.length <= diaryLimit;
    more.textContent = `Show more days (${fmt(days.length - diaryLimit)} left)`;
    if (diaryFocus) {
      const target = document.getElementById('day-' + diaryFocus); diaryFocus = null;
      if (target) { target.classList.add('hl'); target.scrollIntoView({ block: 'center' }); setTimeout(() => target.classList.remove('hl'), 2500); }
      else list.scrollIntoView({ block: 'start' });
    }
  }

  // the diary period as one strip: a column per day, stacked by book; click a day to jump to it in the list
  function jumpToDay(date, days) {
    // an empty day snaps to the nearest day with reading
    const t = +pDate(date), i = d3.minIndex(days, ([d]) => Math.abs(+pDate(d) - t)); if (i < 0) return;
    if (i >= diaryLimit) diaryLimit = i + 30;
    diaryFocus = days[i][0]; drawDiary();
  }
  function drawDiaryTimeline(inR, R, days) {
    const el = $('#ch-dytl'), lg = $('#leg-dytl');
    if (!days.length) { el.hidden = lg.hidden = true; return; }
    el.hidden = lg.hidden = false;
    const genres = genreOrder.filter((g) => inR.some((r) => r.genre === g));
    genreLegend(lg, genres);
    const byDate = new Map(days);
    const h = 160, { svg, w, tip } = svgIn(el, h), m = { t: 8, r: 4, b: 22, l: 30 };
    el.style.minHeight = h + 'px';
    const x = d3.scaleUtc([pDate(R.start), d3.utcDay.offset(pDate(R.end), 1)], [m.l, w - m.r]);
    const step = (w - m.l - m.r) / R.days, gap = step > 6 ? 1.5 : step > 3 ? 0.5 : 0, bw = Math.max(0.5, step - gap);
    const dayMin = (es) => d3.sum(es, (r) => r.minutes || 0);
    const y = d3.scaleLinear([0, d3.max(days, ([, es]) => dayMin(es)) || 60], [h - m.b, m.t]).nice();
    axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4).tickFormat((v) => (v >= 60 && v % 60 === 0 ? v / 60 + 'h' : v)).tickSize(-(w - m.l - m.r)));
    svg.select('.domain').remove();
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(Math.max(2, Math.floor(w / 90))).tickFormat(d3.utcFormat(R.days <= 120 ? '%-d %b' : '%b %y')).tickSizeOuter(0));
    // stack each day's books, longest at the bottom; days with books but no minutes (before 2019) get a small muted tick
    const segs = [];
    days.forEach(([date, es]) => {
      let acc = 0;
      es.slice().sort((a, b) => (b.minutes || 0) - (a.minutes || 0)).forEach((r) => {
        if (!r.minutes) return;
        segs.push({ date, r, y0: acc, y1: acc + r.minutes }); acc += r.minutes;
      });
      if (!acc) segs.push({ date, r: null, y0: 0, y1: null });
    });
    svg.append('g').selectAll('rect').data(segs).join('rect')
      .attr('x', (s) => x(pDate(s.date)) + gap / 2).attr('width', bw)
      .attr('y', (s) => (s.r ? y(s.y1) : h - m.b - 4)).attr('height', (s) => (s.r ? Math.max(0.5, y(s.y0) - y(s.y1) - (s.y0 && step > 6 ? 0.5 : 0)) : 4))
      .attr('fill', (s) => (s.r ? gColor(s.r.genre) : 'var(--cds-chart-muted)'));
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('mousemove', (e) => {
        const day = iso(d3.utcDay.floor(x.invert(d3.pointer(e)[0]))), es = byDate.get(day) || [];
        showTip(tip, el, e, (t) => {
          tipLines(t, d3.utcFormat('%a %-d %b %Y')(pDate(day)), es.length ? [[null, 'Total', dayMin(es) ? mins(dayMin(es)) : '—']] : [[null, '', 'No reading']]);
          es.slice().sort((a, b) => (b.minutes || 0) - (a.minutes || 0)).forEach((r) => {
            const d = t.append('div'); d.append('span').attr('class', 'sw').style('background', gColor(r.genre));
            d.append('span').text(r.title + (r.minutes ? ': ' : '')); if (r.minutes) d.append('b').text(mins(r.minutes));
          });
        });
      })
      .on('mouseleave', () => hideTip(tip))
      .on('click', (e) => { hideTip(tip); jumpToDay(iso(d3.utcDay.floor(x.invert(d3.pointer(e)[0]))), days); });
  }

  // to(d) → ['year', 2024] links each bar
  function vbars(el, rows, key, val, color, unit, to) {
    const h = 220, { svg, w, tip } = svgIn(el, h), m = { t: 18, r: 4, b: 24, l: 30 };
    const x = d3.scaleBand(rows.map(key), [m.l, w - m.r]).padding(0.3);
    const y = d3.scaleLinear([0, d3.max(rows, val) || 1], [h - m.b, m.t]).nice();
    // counts get whole-number ticks only
    const whole = rows.every((r) => Number.isInteger(val(r))), ticks = whole ? Math.min(4, y.domain()[1]) : 4;
    axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(ticks, whole ? 'd' : undefined).tickSize(-(w - m.l - m.r)));
    svg.select('.domain').remove();
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickSize(0).tickPadding(8));
    const bw = Math.min(MARK.bar, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d) => `translate(${x(key(d)) + off},0)`);
    g.append('path').call(grow, 'd', () => barPath(0, y(0), bw, 0), (d) => barPath(0, y(val(d)), bw, y(0) - y(val(d)))).attr('fill', color);
    g.append('text').attr('class', 'lbl-in').attr('x', bw / 2).attr('y', (d) => y(val(d)) - 5).attr('text-anchor', 'middle').text((d) => fmt(val(d))).call(grow, 'opacity', 0, 1);
    g.append('rect').attr('class', 'hit').attr('x', -off - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .each(function (d) { if (to) link(this, ...to(d)); })
      .on('mousemove', (e, d) => showTip(tip, el, e, (t) => tipLines(t, String(key(d)), [[null, unit, fmt(val(d))]]))).on('mouseleave', () => hideTip(tip));
  }
  function drawWeek() { const el = $('#ch-week'), rows = state(el, 'weekday'); if (rows && rows.some((r) => r.avg_minutes > 0)) vbars(el, rows, (r) => r.weekday, (r) => r.avg_minutes, C[0], 'Avg minutes'); }
  function drawSpeed() { const el = $('#ch-speed'), rows = state(el, 'speed_year'); if (rows) vbars(el, rows, (r) => r.year, (r) => r.wpm, C[2], 'Words per minute', (r) => ['year', r.year]); }

  // ---------- covers ----------
  // the book's cover, or a tile with its first letter in the genre's colour
  function cover(id, title, genre, size) {
    const box = el('div', 'cv' + (size ? ' ' + size : '')), url = id && dash.cover ? dash.cover(id) : null;
    box.style.setProperty('--cv', gColor(genre));
    const blank = () => { box.replaceChildren(el('span', null, (String(title || '?').replace(/^[^\p{L}\p{N}]+/u, '')[0] || '?').toUpperCase())); box.classList.add('blank'); };
    if (url) {
      const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = blank; img.src = url; box.append(img);
    } else blank();
    return box;
  }

  // "On the go": a list, or one book shown large when it's the only one
  function onGo() {
    const ul = $('#current'), rows = state(ul, 'current'); if (!rows) return;
    if (rows.length !== 1) return list('#current', 'current', (r) => ({ meta: 'last ' + d3.utcFormat('%-d %b')(pDate(r.last_read)), prog: r.progress }));
    const r = rows[0], li = link(el('li', 'go-one'), 'book', r.id), info = el('div', 'go-info'), p = r.progress || 0;
    info.append(el('div', 'go-title', r.title));
    info.append(byline('div', 'go-sub', r));
    const prog = el('div', 'go-prog'), bar = el('div', 'pbar'), fill = el('i');
    fill.style.width = Math.min(100, p) + '%'; fill.style.background = C[0]; bar.append(fill);
    prog.append(el('b', null, (Math.round(p * 10) / 10) + '%'), bar);
    info.append(prog);
    const facts = el('dl', 'go-facts'), fact = (k, v) => { if (v) facts.append(el('dt', null, k), el('dd', null, v)); };
    fact(r.read_no > 1 ? `Started re-read ${r.read_no}` : 'Started', r.start ? fDay(pDate(r.start)) : null);
    fact('Last read', fDay(pDate(r.last_read)));
    fact('Reading days', r.days_read ? fmt(r.days_read) : null);
    fact('Time so far', r.hours ? `${fmt(r.hours)} h` : null);
    // the rest, at the pace of this read so far
    if (r.hours && p >= 5 && p < 100) fact('Left at this pace', `about ${fmt(Math.max(1, Math.round(r.hours * (100 - p) / p)))} h`);
    const wpm = D('book_speed').status === 'ok' ? (D('book_speed').data.find((s) => s.book_id === r.id) || {}).wpm : null;
    fact('Speed', wpm ? `${wpm} wpm` : null);
    info.append(facts);
    li.append(cover(r.id, r.title, r.genre, 'lg'), info);
    ul.replaceChildren(li);
  }

  // ---------- lists ----------
  // a list of books from a data source: cover, title, linked author and series, and item(r)'s
  // { meta, prog, note } (note joins the byline; title overrides the row's title)
  function list(sel, id, item, pick) {
    const ul = $(sel), all = state(ul, id); if (!all) return;
    bookList(ul, pick ? pick(all) : all, item);
  }
  function bookList(ul, rows, item = () => ({}), { fields = ['author', 'series'], cur } = {}) {
    if (!rows.length) { ul.replaceChildren(el('li', 'meta', 'Nothing here right now.')); return; }
    ul.replaceChildren(...rows.map((r) => {
      const { title, meta, prog, note } = item(r), id = idOf('book', r), li = el('li', id === cur ? 'cur' : null), a = el('div', 'ttl');
      li.append(cover(id, r.title, r.genre));
      if (id !== cur) link(li, 'book', id);
      a.append(document.createTextNode(title ?? r.title), byline('small', null, r, fields, note));
      if (prog != null) { const p = el('div', 'pbar'), i = el('i'); i.style.width = Math.min(100, prog) + '%'; i.style.background = C[0]; p.append(i); a.append(p); }
      li.append(a, el('div', 'meta', meta ?? '')); return li;
    }));
  }

  // ---------- tables ----------
  const sorts = {};
  function table(sel, id, cols, opts = {}) {
    const tblEl = $(sel), body = tblEl.querySelector('tbody'), r = D(id);
    if (r.status !== 'ok') { body.replaceChildren(); return null; }
    let rows = opts.filter ? r.data.filter(opts.filter) : r.data.slice();
    const st = sorts[sel];
    if (st) { const c = cols.find((c) => c.f === st.f); const val = c && c.get ? c.get : (row) => row[st.f]; rows.sort((a, b) => { const x = val(a), y = val(b); const n = x == null ? 1 : y == null ? -1 : c.num ? x - y : String(x).localeCompare(String(y)); return x == null || y == null ? n : n * st.dir; }); }
    tblEl.querySelectorAll('th').forEach((th) => th.setAttribute('aria-sort', st && th.dataset.field === st.f ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'));
    const key = tblEl.dataset.rowKey;
    body.replaceChildren(...rows.map((row) => {
      const tr = document.createElement('tr'); tr.dataset.key = row[key];
      link(tr, 'book', idOf('book', row));
      cols.forEach((c) => { const td = document.createElement('td'); if (c.num) td.className = 'n'; if (c.cls) td.className += ' ' + c.cls; c.render(td, row); tr.append(td); });
      return tr;
    }));
    if (!tblEl.dataset.wired) {
      tblEl.dataset.wired = 1;
      tblEl.querySelectorAll('th button').forEach((btn) => btn.addEventListener('click', () => {
        const f = btn.parentElement.dataset.field, c = cols.find((c) => c.f === f), cur = sorts[sel];
        sorts[sel] = { f, dir: cur && cur.f === f ? -cur.dir : c.num ? -1 : 1 }; redraw();
      }));
    }
    return rows.length;
  }
  // a cell showing r[f]; authors, series, genres… link to their page
  const txt = (f, fn) => (td, r) => { const v = fn ? fn(r[f], r) : r[f] ?? '—'; if (r[f] && KIND_OF[f] && KIND_OF[f] !== 'book') td.append(ref(r, f, v)); else td.textContent = v; };
  const pct = (v) => (v == null ? '—' : (v >= 99.95 ? 100 : Math.round(v * 10) / 10) + '%');
  const date = (v) => (v ? fDay(pDate(v)) : '—');

  let speedMap = new Map();
  const speedOf = (id) => speedMap.get(id) ?? null;
  function drawTables() {
    const bs = D('book_speed'); speedMap = new Map(bs.status === 'ok' ? bs.data.map((r) => [r.book_id, r.wpm]) : []);
    const q = $('#lib-q').value.trim().toLowerCase(), gsel = $('#lib-genre').value, ssel = $('#lib-status').value, rr = $('#lib-reread').value;
    const n = table('#tbl-books', 'books', [
      { f: 'title', render: (td, r) => { const w = el('div', 'tt'); w.append(cover(r.id, r.title, r.genre, 'sm'), el('span', null, r.title)); td.append(w); } },
      { f: 'author', render: txt('author'), cls: 'hide-sm' }, { f: 'genre', render: txt('genre'), cls: 'hide-sm' },
      { f: 'last_read', render: txt('last_read', date) }, { f: 'times_read', num: true, render: txt('times_read') }, { f: 'hours', num: true, render: txt('hours', (v) => (v ? fmt(v) : '—')), cls: 'hide-sm' },
      { f: 'wpm', num: true, cls: 'hide-sm', get: (r) => speedOf(r.id), render: (td, r) => { const v = speedOf(r.id); td.textContent = v ?? '—'; } },
      { f: 'progress', num: true, render: txt('progress', pct) },
    ], { filter: (b) => (!q || [b.title, b.author, b.series].join(' ').toLowerCase().includes(q)) && (!gsel || b.genre === gsel) && (!ssel || b.status === ssel) && (!rr || b.times_read > 1) });
    const total = D('books').status === 'ok' ? D('books').data.length : 0;
    $('#lib-count').textContent = n == null ? '' : `Showing ${fmt(n)} of ${fmt(total)} books.`;
    if (D('books').status === 'ok' && $('#lib-genre').options.length === 1) {
      [...new Set(D('books').data.map((b) => b.genre))].sort().forEach((g) => $('#lib-genre').append(new Option(g, g)));
    }
    table('#tbl-rereads', 'rereads', [
      { f: 'title', render: txt('title') }, { f: 'read_no', num: true, render: txt('read_no') }, { f: 'start', render: txt('start', date) }, { f: 'end', render: txt('end', date) },
      { f: 'days_read', num: true, render: txt('days_read'), cls: 'hide-sm' }, { f: 'hours', num: true, render: txt('hours', (v) => (v ? v : '—')), cls: 'hide-sm' }, { f: 'progress', num: true, render: txt('progress', pct) },
    ]);
    table('#tbl-series', 'series', [
      { f: 'series', render: txt('series') }, { f: 'author', render: txt('author'), cls: 'hide-sm' }, { f: 'finished', num: true, render: (td, r) => { td.textContent = `${r.finished} of ${r.books}`; } }, { f: 'hours', num: true, render: txt('hours', fmt) },
    ]);
    $('#tbl-series').querySelectorAll('tbody tr').forEach((tr) => link(tr, 'series', tr.dataset.key));
  }
  ['#lib-q', '#lib-genre', '#lib-status', '#lib-reread'].forEach((s) => $(s).addEventListener('input', () => drawTables()));

  // ---------- data checks ----------
  const CHECKS = [
    ['stray', 'Stray first or last day', 'Opened once, then nothing for weeks. Stretches the dates of the read.'],
    ['sparse', 'Thinly spread reads', 'Opened on only a few of the days between first and last.'],
    ['pause', 'Long pauses', 'A break of two months or more in the middle of a read.'],
    ['busy', 'Many books in a day', 'Three or more books opened on the same day.'],
    ['jump', 'Progress jumps', 'Big leaps with little time logged, or going backwards.'],
    ['speed', 'Implausible speed', 'Over 800 or under 40 words a minute.'],
    ['long', 'Very long sessions', 'Six hours or more on one book in a day.'],
    ['guessed', 'Guessed finished', 'Stopped in the back matter, or no progress recorded but long enough to be the whole book.'],
    ['noprog', 'No progress recorded', 'Read, but never counts as finished.'],
    ['untagged', 'Untagged books', 'Missing from catalogue.json.'],
    ['samework', 'Same work?', 'The metadata lookup matched these to the same Open Library work.'],
    ['noisbn', 'No ISBN', 'No ISBN in catalogue.json or found by the lookup, so it can’t be matched reliably across sources.'],
  ];
  const CK_PAGE = 50;
  let ckLimit = CK_PAGE;
  $('#ck-more').addEventListener('click', () => { ckLimit += 100; drawChecks(); });
  function strip(r) {
    const box = el('div', 'ck-strip'), lo = pDate(r.start), n = d3.utcDay.count(lo, pDate(r.end)) + 1;
    const bg = el('span'); bg.style.background = gColor(r.genre); box.append(bg);
    r.active.forEach(([a, b]) => {
      const i = el('i'); i.style.background = gColor(r.genre);
      i.style.left = (d3.utcDay.count(lo, pDate(a)) / n) * 100 + '%'; i.style.width = ((d3.utcDay.count(pDate(a), pDate(b)) + 1) / n) * 100 + '%';
      box.append(i);
    });
    box.title = `${fDay(lo)} – ${fDay(pDate(r.end))}`;
    return box;
  }
  function drawChecks() {
    const list = $('#ck-list'), filt = $('#ck-filter'), more = $('#ck-more');
    const rows = state(list, 'anomalies'); if (!rows) { filt.replaceChildren(); more.hidden = true; return; }
    const counts = d3.rollup(rows, (v) => v.length, (r) => r.check);
    const cur = params().check || CHECKS.find(([k]) => counts.get(k))?.[0] || 'stray';
    filt.replaceChildren(...CHECKS.map(([k, name, help]) => {
      const b = el('button', null, name); b.append(el('b', null, fmt(counts.get(k) || 0)));
      b.title = help; b.setAttribute('aria-pressed', String(k === cur)); b.disabled = !counts.get(k);
      b.addEventListener('click', () => { ckLimit = CK_PAGE; dash.setParams({ check: k }); });
      return b;
    }));
    let shown = rows.filter((r) => r.check === cur);
    if (cur === 'sparse') shown.sort((a, b) => a.share - b.share);
    else if (cur === 'stray' || cur === 'pause') shown.sort((a, b) => b.gap - a.gap);
    else if (cur === 'busy') shown.sort((a, b) => b.books - a.books || (a.date < b.date ? 1 : -1));
    if (!shown.length) { list.replaceChildren(el('li', 'meta', 'Nothing to check here.')); more.hidden = true; return; }
    list.replaceChildren(...shown.slice(0, ckLimit).map((r) => {
      const li = link(el('li'), 'book', r.book_id), a = el('div', 'ttl');
      a.append(el('span', 'ck-title', r.title), byline('small', null, r));
      a.append(el('p', null, r.detail));
      if (r.active) a.append(strip(r));
      const right = el('div', 'meta');
      if (r.date) { const btn = el('button', 'ck-date', fDay(pDate(r.date))); btn.title = 'Open this day in the diary'; btn.addEventListener('click', () => openDiary(r.date)); right.append(btn); }
      li.append(a, right); return li;
    }));
    more.hidden = shown.length <= ckLimit;
    more.textContent = `Show more (${fmt(shown.length - ckLimit)} left)`;
  }

  // ---------- KPIs & header ----------
  function fillMetrics(id) {
    const r = D(id);
    document.querySelectorAll(`[data-source="${id}"][data-where]`).forEach((el) => {
      if (r.status !== 'ok') { if (r.status === 'error') { el.textContent = '—'; el.classList.remove('dash-skeleton'); } return; }
      const metric = new URLSearchParams(el.dataset.where).get('metric');
      const row = r.data.find((x) => x.metric === metric);
      el.textContent = row && row.value != null ? (typeof row.value === 'number' ? fmt(row.value) : row.value) : '—';
      el.title = el.textContent;
      el.classList.remove('dash-skeleton');
      el.closest('.val')?.classList.remove('dash-skeleton');
    });
  }
  function drawKpis() {
    const r = D('kpis');
    document.querySelectorAll('[data-source="kpis"]').forEach((el) => {
      if (r.status !== 'ok') { if (r.status === 'error') { el.textContent = '—'; el.classList.remove('dash-skeleton'); } return; }
      const metric = new URLSearchParams(el.dataset.where).get('metric');
      const row = r.data.find((x) => x.metric === metric);
      el.textContent = row ? (typeof row.value === 'number' ? fmt(row.value) : row.value) : '—';
      el.classList.remove('dash-skeleton');
      el.closest('.val')?.classList.remove('dash-skeleton');
    });
    if (r.status === 'ok') {
      const v = Object.fromEntries(r.data.map((x) => [x.metric, x.value]));
      $('#lbl-ytd').textContent = `Finished in ${v.year}`;
      $('#unit-streak-now').textContent = v.streak_now === 1 ? 'day' : 'days';
      $('#unit-streak-best').textContent = v.streak_best === 1 ? 'day' : 'days';
      const cmp = (sel, a, b) => { const el = $(sel); el.classList.remove('up', 'down'); if (a !== b) el.classList.add(a > b ? 'up' : 'down'); };
      cmp('#kpi-ytd .val', v.finished_ytd, v.finished_prev_ytd); cmp('#kpi-hours-ytd .val', v.hours_ytd, v.hours_prev_ytd);
    }
  }

  // ---------- pages for one book, author, series, genre, year… ----------
  // a book opens the book page; any other kind in LINKS opens the page pages/<kind>.js registered
  const pages = {};
  let bookId = null, bookRead = null, prevTab = 'overview', pageKind = null, pageId = null, detailName = '';
  const onPage = () => tab === 'book' || tab === 'entity';
  const tabName = (t) => $('#tab-' + t)?.textContent || 'Overview';
  function openLink(kind, id) {
    if (!LINKS[kind] || id == null || id === '') return;
    const back = onPage() ? detailName : tabName(tab);
    if (!onPage()) prevTab = tab;
    try { history.pushState({ link: kind, from: prevTab, back }, '', '#' + kind + '/' + encodeURIComponent(id)); } catch (e) { /* sandboxed */ }
    go(kind, String(id));
    window.scrollTo(0, 0);
  }
  function go(kind, id) {
    if (kind === 'book') { if (id !== bookId) bookRead = null; bookId = id; show('book', false); }
    else { pageKind = kind; pageId = id; show('entity', false); }
  }
  // one handler for every link on the page; the innermost wins (an author inside a book row)
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-link],[data-day],[data-read]');
    if (!t || e.target.closest('button,input,select,a')) return;
    if (t.hasAttribute('data-link')) openLink(t.getAttribute('data-link'), t.getAttribute('data-id'));
    else if (t.hasAttribute('data-day')) openDiary(t.getAttribute('data-day'));
    else { bookRead = +t.getAttribute('data-read'); drawBook(); $('#card-bk-days').scrollIntoView({ block: 'nearest' }); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.hasAttribute || !e.target.hasAttribute('data-link')) return;
    e.target.click();
  });
  document.querySelectorAll('.bk-back').forEach((b) => b.addEventListener('click', () => { if (history.state && history.state.link) history.back(); else show(prevTab); }));
  function drawEntity() {
    const root = $('#pg-body'), p = pages[pageKind];
    if (!p) { document.title = 'Reading history'; root.replaceChildren(el('div', 'dy-empty', 'Nothing to show here.')); return; }
    try { p.draw(pageId, root); } catch (e) { console.error(pageKind, e); root.replaceChildren(el('div', 'fail', 'Failed to load')); return; }
    (extensions[pageKind] || []).forEach((fn) => { try { fn(pageId, root); } catch (e) { console.error(pageKind, e); } });
  }
  $('#bk-read').addEventListener('change', (e) => { bookRead = +e.target.value; drawBook(); });

  const okDay = (d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800;
  const speedFrom = (rows) => { const v = rows.filter(okDay), m = d3.sum(v, (d) => d.minutes); return m >= 30 ? { wpm: d3.sum(v, (d) => d.words) / m, m } : null; };
  const span = (a, b) => d3.utcDay.count(pDate(a), pDate(b)) + 1;
  const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
  const progStep = (d) => (d.progress == null ? '—' : d.prev_progress != null && d.prev_progress !== d.progress ? `${pct(d.prev_progress)} → ${pct(d.progress)}` : pct(d.progress));
  const STATUS = { finished: 'Finished', in_progress: 'In progress', not_started: 'Not started', unknown: 'Progress unknown' };

  // a book in a list on a book page: its status, progress and when it was last opened
  const relItem = (numbered) => (x) => ({ title: (numbered && x.series_no != null ? `#${x.series_no} ` : '') + x.title, note: STATUS[x.status] || '', prog: x.progress, meta: x.last_read ? fShort(pDate(x.last_read)) : '' });

  function drawBook() {
    const head = $('#bk-head'), books = state(head, 'books'); if (!books) return;
    const b = books.find((x) => x.id === bookId);
    ['#bk-kpis', '#card-bk-days', '#card-bk-reads', '#card-bk-related', '#card-bk-log'].forEach((s) => ($(s).hidden = !b));
    if (!b) { document.title = 'Reading history'; head.replaceChildren(el('div', 'dy-empty', 'That book isn’t in your library.')); return; }
    detailName = b.title; document.title = `${b.title} · Reading history`;
    const reads = (D('reads').data || []).filter((r) => r.book_id === b.id).sort((x, y) => x.read_no - y.read_no);
    const days = (D('diary').status === 'ok' ? D('diary').data : []).filter((d) => d.book_id === b.id);
    // a book only an import knows (Goodreads, a Kobo without day data) may have no days to show
    ['#card-bk-days', '#card-bk-log'].forEach((s) => ($(s).hidden = !!b.source && !days.length));
    const latest = reads[reads.length - 1];

    // header: cover, title, author, series, genre, status and progress
    const info = el('div', 'go-info');
    info.append(el('div', 'bk-title', b.title));
    info.append(byline('div', 'go-sub', b));
    const chips = el('div', 'bk-chips');
    chips.append(el('span', 'chip' + (b.status === 'finished' ? ' ok' : ''), STATUS[b.status] || b.status));
    if (b.times_read > 1) chips.append(el('span', 'chip', `Read ${b.times_read} times`));
    chips.append(...['genre', 'subgenre'].filter((f) => b[f]).map((f) => { const c = chip(KIND_OF[f], b[f]); c.style.color = gColor(b.genre); return c; }));
    info.append(chips);
    if (b.progress != null) {
      const prog = el('div', 'go-prog'), bar = el('div', 'pbar'), fill = el('i');
      fill.style.width = Math.min(100, b.progress) + '%'; fill.style.background = gColor(b.genre); bar.append(fill);
      prog.append(el('b', null, pct(b.progress)), bar); info.append(prog);
    }
    const facts = el('dl', 'go-facts'), fact = (k, v) => { if (v) facts.append(el('dt', null, k), el('dd', null, v)); };
    fact('First opened', b.first_read ? fDay(pDate(b.first_read)) : null);
    fact('Last opened', b.last_read ? fDay(pDate(b.last_read)) : null);
    const p = b.progress || 0;
    if (b.status !== 'finished' && latest && latest.hours && p >= 5 && p < 99) fact('Left at this pace', `about ${fmt(Math.max(1, Math.round(latest.hours * (100 - p) / p)))} h`);
    fact('Published', b.published_year != null ? (b.published_year < 0 ? `${-b.published_year} BC` : String(b.published_year)) : null);
    fact('Pages', b.pages ? fmt(b.pages) : null);
    fact('ISBN', b.isbn13 ? b.isbn13 + (b.isbn10 ? ` · ${b.isbn10}` : '') : null);
    info.append(facts);
    const gr = goodreadsUrl(b);
    if (gr) {
      const a = el('a', 'bk-ext', 'Goodreads ↗');
      a.href = gr; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.title = b.goodreads_id ? 'Open this book on Goodreads' : 'Find this book on Goodreads';
      info.append(a);
    }
    head.replaceChildren(cover(b.id, b.title, b.genre, 'lg'), info);

    // headline figures
    const timed = days.filter((d) => d.minutes > 0), totalMin = d3.sum(timed, (d) => d.minutes);
    const fin = reads.filter((r) => r.finished === true), spd = speedFrom(days), avg = avgWpm();
    const bs = D('book_speed').status === 'ok' ? D('book_speed').data : [], rank = bs.findIndex((r) => r.book_id === b.id);
    const kpi = (lbl, val, sub) => {
      const k = el('div', 'rh-kpi'); k.append(el('div', 'lbl', lbl), el('div', 'val' + (val.length > 12 ? ' val-sm' : ''), val));
      if (sub) k.append(el('div', 'sub', sub)); return k;
    };
    const k = [];
    k.push(kpi('Times read', fmt(Math.max(reads.length, b.times_read || 0)), fin.length ? `finished ${plural(fin.length, 'time')}` : 'not finished yet'));
    // Goodreads only knows the day a book was finished
    if (latest && !(latest.source && latest.start === latest.end)) k.push(kpi(reads.length > 1 ? `Read ${latest.read_no} started` : 'Started', fDay(pDate(latest.start)), reads.length > 1 ? `first read ${fShort(pDate(reads[0].start))}` : null));
    if (fin.length) {
      const f = fin[fin.length - 1];
      k.push(kpi('Finished', fDay(pDate(f.end)), fin.length > 1 ? `also ${fin.slice(0, -1).map((r) => fShort(pDate(r.end))).join(', ')}` : null));
      // an imported read has no reading days (Goodreads only knows the day it was finished)
      if (f.days_read) k.push(kpi('Start to finish', plural(span(f.start, f.end), 'day'), `read on ${plural(f.days_read, 'day')}`));
    } else if (latest) k.push(kpi('Reading for', plural(span(latest.start, latest.end), 'day'), `read on ${plural(latest.days_read, 'day')}`));
    if (totalMin) k.push(kpi('Time spent', mins(totalMin), reads.length > 1 ? 'across every read' : `${fmt(Math.round(totalMin / timed.length))} min per reading day`));
    if (spd) k.push(kpi('Speed', `${fmt(Math.round(spd.wpm))} wpm`, (avg ? vsAvg(spd.wpm / avg - 1) : '') + (rank >= 0 ? ` · #${rank + 1} fastest of ${fmt(bs.length)}` : '')));
    if (b.words) k.push(kpi('Words read', fmt(b.words), reads.length > 1 ? 'across every read' : null));
    if (timed.length) { const top = timed.reduce((a, d) => (d.minutes > a.minutes ? d : a)); k.push(kpi('Longest day', mins(top.minutes), fDay(pDate(top.date)))); }
    $('#bk-kpis').replaceChildren(...k);

    // day by day, for one read
    if (!reads.some((r) => r.read_no === bookRead)) bookRead = latest ? latest.read_no : null;
    const read = reads.find((r) => r.read_no === bookRead), sel = $('#bk-read');
    sel.hidden = reads.length < 2;
    sel.replaceChildren(...reads.map((r) => new Option(`Read ${r.read_no} · ${fShort(pDate(r.start))}`, r.read_no)));
    sel.value = bookRead;
    drawBookDays(b, read, days);

    // every read
    $('#tbl-bk-reads tbody').replaceChildren(...reads.slice().reverse().map((r) => {
      const tr = el('tr', r.read_no === bookRead ? 'sel' : null), s = speedFrom(days.filter((d) => d.date >= r.start && d.date <= r.end));
      tr.setAttribute('data-read', r.read_no);
      tr.append(el('td', 'n', String(r.read_no)), el('td', null, date(r.start)), el('td', null, date(r.end)),
        el('td', 'n hide-sm', plural(span(r.start, r.end), 'day')), el('td', 'n hide-sm', r.hours ? fmt(r.hours) : '—'),
        el('td', 'n hide-sm', s ? fmt(Math.round(s.wpm)) : '—'), el('td', 'n', pct(r.progress)));
      return tr;
    }));

    // the rest of the series, or more by the author
    const ser = b.series ? books.filter((x) => x.series === b.series) : [];
    const rel = ser.length > 1 ? ser.sort((x, y) => (x.series_no ?? 1e9) - (y.series_no ?? 1e9) || x.title.localeCompare(y.title))
      : books.filter((x) => x.author && x.author === b.author && x.id !== b.id).sort((x, y) => ((x.last_read || '') < (y.last_read || '') ? 1 : -1));
    $('#card-bk-related').hidden = !rel.length;
    $('#bk-rel-h').replaceChildren(...(ser.length > 1 ? [ref(b, 'series')] : ['More by ', ref(b, 'author')]));
    $('#bk-rel-note').textContent = ser.length > 1 ? `${fmt(ser.filter((x) => x.status === 'finished').length)} of ${fmt(ser.length)} in the series finished.` : `${plural(rel.length, 'other book')} in your library.`;
    bookList($('#bk-related'), rel, relItem(ser.length > 1), { fields: ser.length > 1 ? [] : ['series'], cur: b.id });

    // every day, newest first
    $('#tbl-bk-log tbody').replaceChildren(...days.slice().reverse().map((d) => {
      const tr = el('tr'), c0 = el('td');
      tr.setAttribute('data-day', d.date);
      c0.append(document.createTextNode(d3.utcFormat('%a %-d %b %Y')(pDate(d.date))));
      if (d.event) c0.append(el('span', 'ev ' + d.event, d.event === 'finished' ? 'Finished' : d.event === 'reread' ? 'Started re-read' : 'Started'));
      tr.append(c0, el('td', 'n', d.minutes ? mins(d.minutes) : '—'), el('td', 'n hide-sm', d.words ? fmt(d.words) : '—'),
        el('td', 'n hide-sm', okDay(d) ? fmt(Math.round(d.words / d.minutes)) : '—'), el('td', 'n', progStep(d)));
      return tr;
    }));
    drawBookCards(b);
  }

  // the book's Goodreads page: by the id a Goodreads import gave, else by ISBN (Goodreads
  // redirects to the book), else a search; none for a private book, which mustn't be named
  function goodreadsUrl(b) {
    if (/^private-\d+$/.test(b.id)) return null;
    const GR = 'https://www.goodreads.com';
    if (b.goodreads_id) return `${GR}/book/show/${encodeURIComponent(b.goodreads_id)}`;
    const isbn = b.isbn13 || b.isbn10;
    if (isbn) return `${GR}/book/isbn/${encodeURIComponent(isbn)}`;
    const q = [b.title, b.author].filter(Boolean).join(' ');
    return q ? `${GR}/search?q=${encodeURIComponent(q)}` : null;
  }

  // minutes per day as bars and progress as a line, across one read
  function drawBookDays(b, read, days) {
    const box = $('#ch-bk-days'), note = $('#bk-days-note');
    if (!state(box, 'diary')) return;
    const rows = read ? days.filter((d) => d.date >= read.start && d.date <= read.end) : [];
    if (!rows.length) { note.textContent = ''; box.style.minHeight = '80px'; box.replaceChildren(el('div', 'dy-empty', 'No days recorded for this read.')); return; }
    const n = span(read.start, read.end), tm = d3.sum(rows, (d) => d.minutes || 0), s = speedFrom(rows);
    note.textContent = `${rangeLabel(read)}: read on ${fmt(rows.length)} of ${plural(n, 'day')}` + (tm ? `, ${mins(tm)} in all` : '') +
      (s ? `, ${fmt(Math.round(s.wpm))} wpm` : '') + '. Bars are minutes read, the line is how far you got. Click a day to open it in the diary.';
    const h = 260, m = { t: 22, r: 42, b: 24, l: 34 };
    box.style.minHeight = h + 'px';
    const { svg, w, tip } = svgIn(box, h);
    const lo = pDate(read.start), x = d3.scaleUtc([lo, d3.utcDay.offset(pDate(read.end), 1)], [m.l, w - m.r]);
    const hasMin = rows.some((d) => d.minutes > 0);
    const y = d3.scaleLinear([0, d3.max(rows, (d) => d.minutes || 0) || 1], [h - m.b, m.t]).nice();
    const yp = d3.scaleLinear([0, 100], [h - m.b, m.t]);
    if (hasMin) {
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)));
      svg.append('text').attr('class', 'axl').attr('x', 0).attr('y', m.t - 10).text('minutes');
    }
    axis(svg.append('g').attr('transform', `translate(${w - m.r},0)`), d3.axisRight(yp).ticks(5).tickFormat((v) => v + '%').tickSize(hasMin ? 0 : -(w - m.l - m.r)).tickPadding(6));
    svg.selectAll('.domain').remove();
    svg.append('text').attr('class', 'axl').attr('x', w).attr('y', m.t - 10).attr('text-anchor', 'end').text('progress');
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(Math.max(2, Math.min(n, Math.floor(w / 90)))).tickFormat(d3.utcFormat(n <= 120 ? '%-d %b' : '%b %y')).tickSizeOuter(0));
    const dw = x(d3.utcDay.offset(lo, 1)) - x(lo), gap = dw > 6 ? Math.min(4, dw * 0.2) : 0;
    svg.append('g').selectAll('path').data(rows.filter((d) => d.minutes > 0)).join('path')
      .call(grow, 'd', (d) => barPath(x(pDate(d.date)) + gap / 2, y(0), Math.max(1, dw - gap), 0), (d) => barPath(x(pDate(d.date)) + gap / 2, y(d.minutes), Math.max(1, dw - gap), y(0) - y(d.minutes))).attr('fill', gColor(b.genre)).attr('fill-opacity', 0.5);
    // progress at the end of each day, from where the read began
    const pts = rows.filter((d) => d.progress != null).map((d) => ({ t: d3.utcDay.offset(pDate(d.date), 1), p: d.progress }));
    if (pts.length) {
      const first = rows.find((d) => d.progress != null);
      pts.unshift({ t: pDate(first.date), p: first.prev_progress ?? first.progress });
      svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', 'var(--color-fg)').attr('stroke-width', MARK.line).attr('stroke-linejoin', 'round')
        .attr('d', d3.line((d) => x(d.t), (d) => yp(d.p))).call(drawIn);
      if (pts.length <= 120) svg.append('g').selectAll('circle').data(pts.slice(1)).join('circle').attr('cx', (d) => x(d.t)).attr('cy', (d) => yp(d.p)).attr('r', 2.5).attr('fill', 'var(--color-fg)');
    }
    const byDate = new Map(rows.map((d) => [d.date, d]));
    const at = (e) => iso(d3.utcDay.floor(x.invert(d3.pointer(e, svg.node())[0])));
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (e) => {
        const day = at(e), d = byDate.get(day);
        e.target.style.cursor = d ? 'pointer' : 'default';
        showTip(tip, box, e, (tp) => tipLines(tp, d3.utcFormat('%a %-d %b %Y')(pDate(day)), d
          ? [[null, 'Time', d.minutes ? mins(d.minutes) : '—'], [null, 'Words', d.words ? fmt(d.words) : '—'], [null, 'Speed', okDay(d) ? Math.round(d.words / d.minutes) + ' wpm' : '—'], [null, 'Progress', progStep(d)]]
          : [[null, '', 'Not opened']]));
      })
      .on('mouseleave', () => hideTip(tip))
      .on('click', (e) => { const day = at(e); if (byDate.has(day)) { hideTip(tip); openDiary(day); } });
  }

  // ---------- feature scripts (web/features/*.js) ----------
  // Each feature lives in its own file and adds itself with rh.card, rh.bookCard, rh.extend
  // and rh.tab, so new views don't all edit this file and index.html.
  const featureCards = [], bookCards = [], extensions = {};
  function cardShell(o, cls) {
    const c = el('div', 'rh-card' + (o.wide === false ? '' : ' wide') + (cls ? ' ' + cls : ''));
    c.id = 'card-' + o.id;
    // what the card shows that the owner may hide from visitors (web/features/privacy.js)
    if (o.privacy) c.dataset.privacy = [].concat(o.privacy).join(' ');
    const head = el('div', 'card-head'), h = el('h2', null, o.title || '');
    head.append(h); c.append(head);
    const note = el('p', 'note', o.note || ''); note.hidden = !o.note; c.append(note);
    const box = el('div', 'chart' + (o.chartClass ? ' ' + o.chartClass : ''));
    box.id = 'ch-' + o.id;
    if (o.calc) box.dataset.source = o.calc;
    // data files the card does without when a visitor gets them empty (web/features/privacy.js)
    if (o.copesWithout) box.dataset.copes = [].concat(o.copesWithout).join(' ');
    c.append(box);
    return { card: c, head, h, note, box };
  }
  // a card on a tab: { tab, id, title, note, wide, calc, before, after, draw(box, rows, parts) }
  // draw runs on every redraw of that tab; with calc it gets that calc's rows (or isn't called
  // until they load)
  function addCard(o) {
    const parts = cardShell(o);
    featureCards.push({ ...o, parts, placed: false });
    return parts;
  }
  function place(f, root) {
    if (f.placed && f.parts.card.isConnected) return;
    const ref = (f.before && document.getElementById(f.before)) || (f.after && document.getElementById(f.after));
    if (ref && f.before) ref.before(f.parts.card); else if (ref) ref.after(f.parts.card); else root.append(f.parts.card);
    f.placed = true;
  }
  function runCard(f, ...args) {
    const { box } = f.parts;
    let rows;
    if (f.calc) { rows = state(box, f.calc); if (!rows) return; }
    try { f.draw(box, rows, f.parts, ...args); } catch (e) { console.error(f.id, e); box.replaceChildren(el('div', 'fail', 'Failed to load')); }
  }
  function drawFeatureCards(name) {
    const root = document.getElementById(name);
    if (!root) return;
    featureCards.filter((f) => f.tab === name).forEach((f) => {
      place(f, root);
      if (f.hidden && f.hidden()) { f.parts.card.hidden = true; return; }
      f.parts.card.hidden = false;
      runCard(f);
    });
  }
  // a card on every book page: draw(box, rows, parts, book); return false to hide it for that book
  function drawBookCards(b) {
    const root = $('#book');
    bookCards.forEach((f) => {
      place(f, root);
      f.parts.card.hidden = false;
      const { box } = f.parts;
      let rows;
      if (f.calc) { rows = state(box, f.calc); if (!rows) return; }
      try { if (f.draw(box, rows, f.parts, b) === false) f.parts.card.hidden = true; }
      catch (e) { console.error(f.id, e); box.replaceChildren(el('div', 'fail', 'Failed to load')); }
    });
  }

  // ---------- tabs ----------
  let tabs = [...document.querySelectorAll('.rh-tabs button')];
  const top = $('.rh-top'), nav = $('.rh-tabs');
  // keep scroll-margin in step with the sticky bar so scrollIntoView lands below it
  const syncTopH = () => document.documentElement.style.setProperty('--top-h', top.offsetHeight + 8 + 'px');
  new ResizeObserver(syncTopH).observe(top); syncTopH();

  let booted = false;
  function show(name, setLink = true, dir = 0) {
    const page = document.getElementById(name);
    if (!page) return;
    const changed = name !== tab, from = tabs.findIndex((t) => t.dataset.tab === tab), to = tabs.findIndex((t) => t.dataset.tab === name);
    // a tab slides in from the side it sits on; a book or entity page fades up
    if (booted && !dir && changed && from >= 0 && to >= 0) dir = to > from ? 1 : -1;
    const fade = booted && !dir && !calm.matches && (name === 'book' || name === 'entity' || (changed && from < 0));
    if (calm.matches) dir = 0;
    if (booted && (changed || fade)) moving = true;
    booted = true;
    tab = name;
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.rh-page').forEach((p) => (p.hidden = p.id !== name));
    if (!onPage()) document.title = 'Reading history';
    const back = '← Back to ' + ((history.state && history.state.back) || tabName(prevTab));
    document.querySelectorAll('.bk-back').forEach((b) => (b.textContent = back));
    if (setLink) dash.setLink(name);
    // for web/features/analytics.js: which view is now on screen
    window.dispatchEvent(new CustomEvent('rh:view', { detail: { view: name, kind: name === 'entity' ? pageKind : name === 'book' ? 'book' : null } }));
    redraw();
    // bring the active tab into view inside the (horizontally scrolling) tab strip
    const b = tabs.find((t) => t.dataset.tab === name);
    if (b) nav.scrollTo({ left: b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
    // if we were scrolled past the top of the content, start the new tab at its top
    if (changed) {
      const y = page.getBoundingClientRect().top + scrollY - top.offsetHeight - 8;
      if (scrollY > y) scrollTo(0, Math.max(0, y));
      if (dir) { page.classList.remove('in-l', 'in-r', 'in-up'); void page.offsetWidth; page.classList.add(dir > 0 ? 'in-r' : 'in-l'); }
    }
    if (fade) { page.classList.remove('in-l', 'in-r', 'in-up'); void page.offsetWidth; page.classList.add('in-up'); }
  }
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  // a tab added by a feature script (rh.tab)
  function addTab(id, label, o = {}) {
    if (document.getElementById(id)) return document.getElementById(id);
    const b = el('button', null, label);
    Object.assign(b, { id: 'tab-' + id, role: 'tab' });
    b.dataset.tab = id; b.setAttribute('aria-selected', 'false');
    b.addEventListener('click', () => show(id));
    const after = o.after && document.getElementById('tab-' + o.after);
    if (after) after.after(b); else (document.getElementById('tab-checks') ? document.getElementById('tab-checks').before(b) : nav.append(b));
    const page = el('section', 'rh-page');
    page.id = id; page.hidden = true;
    const prev = document.getElementById('checks');
    prev.before(page);
    tabs = [...document.querySelectorAll('.rh-tabs button')];
    return page;
  }
  // a page with no tab, opened by its link (#id): rh.page(id, draw); draw runs on every redraw
  // while it's shown, so it should only rebuild what changed
  const hiddenPages = {};
  function addPage(id, draw) {
    let page = document.getElementById(id);
    if (!page) {
      page = el('section', 'rh-page');
      page.id = id; page.hidden = true;
      document.getElementById('entity').after(page);
    }
    hiddenPages[id] = draw;
    return page;
  }
  // sections of the admin page (web/features/admin.js draws them); see web/features/README.md
  const adminSections = [];
  document.addEventListener('animationend', (e) => e.target.classList?.remove('in-l', 'in-r', 'in-up'));

  // ---------- swipe between tabs (touch) ----------
  const scrollsX = (el) => {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.matches('input,select,textarea,dialog')) return true;
      const ox = getComputedStyle(el).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return true;
    }
    return false;
  };
  let sw = null;
  const rh = $('.rh');
  rh.addEventListener('touchstart', (e) => {
    sw = null;
    if (e.touches.length !== 1 || nav.hidden || onPage() || hiddenPages[tab] || top.contains(e.target) || scrollsX(e.target)) return;
    const t = e.touches[0];
    sw = { x: t.clientX, y: t.clientY, dx: 0, mode: null, page: document.getElementById(tab) };
  }, { passive: true });
  rh.addEventListener('touchmove', (e) => {
    if (!sw) return;
    const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (!sw.mode) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      sw.mode = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
      if (sw.mode === 'x') sw.page.classList.add('drag');
    }
    if (sw.mode !== 'x') return;
    const i = tabs.findIndex((b) => b.dataset.tab === tab);
    const edge = (dx > 0 && i === 0) || (dx < 0 && i === tabs.length - 1);
    sw.dx = dx;
    const off = edge ? dx / 4 : dx / 2;  // resist at the first/last tab
    sw.page.style.transform = `translateX(${off}px)`;
    sw.page.style.opacity = String(1 - Math.min(Math.abs(off) / 400, 0.4));
  }, { passive: true });
  const endSwipe = () => {
    if (!sw || sw.mode !== 'x') { sw = null; return; }
    const { page, dx } = sw; sw = null;
    page.classList.remove('drag');
    const i = tabs.findIndex((b) => b.dataset.tab === tab);
    const j = Math.abs(dx) > Math.min(80, innerWidth / 5) ? i + (dx < 0 ? 1 : -1) : i;
    if (j !== i && tabs[j]) {
      page.style.transform = page.style.opacity = '';
      show(tabs[j].dataset.tab, true, dx < 0 ? 1 : -1);
    } else {
      page.classList.add('settle');
      page.style.transform = page.style.opacity = '';
      setTimeout(() => page.classList.remove('settle'), 200);
    }
  };
  rh.addEventListener('touchend', endSwipe);
  rh.addEventListener('touchcancel', endSwipe);

  // a range, toggle or other setting changing animates the redraw it causes
  const setParams = dash.setParams;
  dash.setParams = (p) => { moving = (window.event?.target || document.activeElement)?.closest?.('.rh-card') || true; setParams(p); };
  let seen = null;
  function redraw() {
    if (D('books').data !== seen) { seen = D('books').data; moving = true; }
    const gc = D('genre_counts');
    if (gc.status === 'ok') genreOrder = gc.data.map((r) => r.genre);
    drawKpis();
    syncRanges();
    if (tab === 'overview') {
      drawYears(); drawMonths();
      onGo();
      list('#recent', 'recent', (r) => ({ title: (r.read_no > 1 ? '↻ ' : '') + r.title, meta: fDay(pDate(r.end)) + (r.hours ? ` · ${r.hours} h` : '') }));
    } else if (tab === 'genres') { drawGenre(); drawSub(); drawGenreStream(); drawAuthors(); drawTables(); }
    else if (tab === 'diary') drawDiary();
    else if (tab === 'speed') drawSpeedTab();
    else if (tab === 'checks') drawChecks();
    else if (tab === 'timeline') {
      drawHeat(); drawGantt(); drawWeek();
      list('#big', 'big_reads', (r) => ({ meta: `${r.hours} h · ${r.days_read} days` }));
      list('#stalled', 'stalled', (r) => ({ meta: 'last ' + fShort(pDate(r.last_read)), prog: r.progress }));
    } else if (tab === 'book') drawBook();
    else if (tab === 'entity') drawEntity();
    else if (hiddenPages[tab]) { try { hiddenPages[tab](document.getElementById(tab)); } catch (e) { console.error(tab, e); } }
    else drawTables();
    drawFeatureCards(tab);
    moving = false;
  }
  dash.onData(redraw);
  // #speed, #diary… open a tab; #book/<id>, #author/<name>… open a page
  function route() {
    const named = decodeURIComponent(location.hash.slice(1)), i = named.indexOf('/');
    if (i > 0 && LINKS[named.slice(0, i)]) {
      if (history.state && history.state.from) prevTab = history.state.from;
      go(named.slice(0, i), named.slice(i + 1));
    } else if (i > 0 && hiddenPages[named.slice(0, i)]) show(named.slice(0, i), false);
    else show(named && !['book', 'entity'].includes(named) && document.getElementById(named)?.classList.contains('rh-page') ? named : 'overview', false);
  }
  window.addEventListener('popstate', route);
  // after pages/*.js have registered
  document.addEventListener('DOMContentLoaded', route);
  // a #tab link makes the browser jump to that section, hiding the intro under the sticky bar
  window.addEventListener('load', () => {
    const intro = $('.rh-intro');
    if (location.hash && intro && scrollY > 0 && scrollY <= intro.getBoundingClientRect().bottom + scrollY) scrollTo(0, 0);
  }, { once: true });

  // what pages/*.js build with
  window.rh = {
    register: (kind, page) => { pages[kind] = page; if (tab === 'entity' && pageKind === kind) redraw(); },
    D, state, el, fmt, pDate, iso, fDay, fShort, C, gColor, genres: () => genreOrder.slice(),
    svgIn, measure, showTip, hideTip, tipLines, axis, legend, hbars, vbars, cover, MARK, barPath, refLine, motion, grow, drawIn,
    link, links, ref, byline, chip, linkBook: (n, id) => link(n, 'book', id), linkPage: link, openLink, openDiary,
    setTitle: (s) => { detailName = s || ''; document.title = s ? `${s} · Reading history` : 'Reading history'; },
    mins, pct, date, plural, span, okDay, speedFrom, avgWpm, vsAvg, STATUS,
    // feature scripts
    card: addCard,
    bookCard: (o) => { const parts = cardShell(o); bookCards.push({ ...o, parts, placed: false }); return parts; },
    extend: (kind, fn) => { (extensions[kind] = extensions[kind] || []).push(fn); },
    tab: addTab,
    page: addPage,
    adminSection: (o) => { adminSections.push(o); window.dispatchEvent(new CustomEvent('rh:admin-section', { detail: o })); },
    adminSections: () => adminSections.slice().sort((a, b) => (a.order ?? 50) - (b.order ?? 50)),
    show: (name) => show(name),
    current: () => tab,
    redraw: () => redraw(),
  };
})();
