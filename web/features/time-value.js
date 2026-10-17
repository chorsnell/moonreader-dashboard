// What your reading time is worth: hours read × an hourly rate you choose, for each book,
// author, genre, series and year, and the true cost of a book (its price plus your time).
// Works without any prices. The rate is a setting of this browser only (dash.setParams): it
// is never sent to the server, and every viewer can value their own time.
(() => {
  const { el, fmt, plural } = rh;

  // roughly the UK minimum wage; a stand-in until you set your own
  const DEFAULT_RATE = 12.71;
  const CURRENCIES = ['GBP', 'EUR', 'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'JPY', 'INR'];
  const GROUPS = { author: 'Authors', book: 'Books', genre: 'Genres', series: 'Series' };
  const round1 = (n) => Math.round(n * 10) / 10;

  // ---------- calcs (hours only: the rate is applied when drawing) ----------
  dash.calc('time_years', {
    inputs: ['daily'],
    title: 'Hours read per year',
    description: 'Hours logged per year from the daily log, for valuing your reading time.',
    fn: (daily) => {
      const by = new Map();
      daily.forEach((d) => { const y = +d.date.slice(0, 4); by.set(y, (by.get(y) || 0) + (d.minutes || 0)); });
      return [...by].sort((a, b) => a[0] - b[0]).map(([year, m]) => ({ year, hours: round1(m / 60) }));
    },
  });

  dash.calc('time_books', {
    inputs: ['books', 'money_books'],
    title: 'Hours and price per book',
    description: 'Each book\'s lifetime hours, with its price when one is recorded, for valuing your time and the true cost (price + time).',
    fn: (books, priced) => {
      const price = new Map(priced.map((r) => [r.book_id, r.price]));
      return books.filter((b) => b.hours > 0).map((b) => ({
        book_id: b.id, title: b.title, author: b.author, genre: b.genre, subgenre: b.subgenre, series: b.series,
        first_read: b.first_read, hours: b.hours, price: price.has(b.id) ? price.get(b.id) : null,
      }));
    },
  });

  dash.calc('time_groups', {
    inputs: ['books'],
    title: 'Hours per author, genre and series',
    description: 'Lifetime hours read for each author, genre, subgenre and series.',
    fn: (books) => {
      const out = [];
      ['author', 'genre', 'subgenre', 'series'].forEach((field) => {
        const by = new Map();
        books.filter((b) => b[field] && b.hours > 0).forEach((b) => {
          const g = by.get(b[field]) || { kind: field, name: b[field], [field]: b[field], hours: 0, books: 0 };
          g.hours += b.hours; g.books++;
          by.set(b[field], g);
        });
        by.forEach((g) => out.push({ ...g, hours: round1(g.hours) }));
      });
      return out;
    },
  });

  // ---------- the rate ----------
  const data = (id) => { const r = dash.data(id); return r.status === 'ok' ? r.data : null; };
  const homeCurrency = () => { const p = data('prices'); return p && !Array.isArray(p) && p.currency ? p.currency : null; };
  const currency = () => homeCurrency() || dash.params().time_currency || 'GBP';
  const rate = () => { const r = Number(dash.params().time_rate); return r > 0 ? r : DEFAULT_RATE; };
  const isDefault = () => !(Number(dash.params().time_rate) > 0);
  function money(n, dp) {
    if (n == null) return '—';
    const d = dp ?? (Math.abs(n) >= 100 ? 0 : 2);
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency(), minimumFractionDigits: d, maximumFractionDigits: d }).format(n); }
    catch (e) { return n.toFixed(d); }
  }
  const kpi = (lbl, val, sub) => { const n = el('div', 'rh-kpi'); n.append(el('div', 'lbl', lbl), el('div', 'val', val)); if (sub) n.append(el('div', 'sub', sub)); return n; };

  // the rate and currency inputs, made once so typing in them survives redraws
  function controls(parts) {
    let box = parts.head.querySelector('.tv-controls');
    if (!box) {
      box = el('div', 'tv-controls');
      const label = el('label', 'tv-rate');
      const input = el('input');
      Object.assign(input, { type: 'number', min: '0', step: '0.01', inputMode: 'decimal', placeholder: String(DEFAULT_RATE) });
      input.setAttribute('aria-label', 'Your hourly rate');
      input.addEventListener('change', () => { const v = Number(input.value); dash.setParams({ time_rate: v > 0 ? v : null }); });
      const cur = el('select', 'rng-sel');
      cur.setAttribute('aria-label', 'Currency');
      CURRENCIES.forEach((c) => { const o = el('option', null, c); o.value = c; cur.append(o); });
      cur.addEventListener('change', () => dash.setParams({ time_currency: cur.value }));
      label.append(el('span', null, 'Your time per hour'), input);
      box.append(label, cur);
      parts.head.append(box);
    }
    const input = box.querySelector('input'), cur = box.querySelector('select');
    if (document.activeElement !== input) input.value = isDefault() ? '' : rate();
    cur.value = currency();
    cur.hidden = !!homeCurrency(); // with prices, everything is in their home currency
  }

  // horizontal bars with money labels
  function bars(box, rows, { label, value, text, color = () => rh.C[0], linkTo, tip }) {
    const bh = 22, gap = 6, h = rows.length * (bh + gap) + 4;
    const { svg, w, tip: tipEl } = rh.svgIn(box, h);
    const lw = Math.min(w * 0.45, rh.measure(svg, rows.map(label)) + 10);
    const vw = rh.measure(svg, rows.map(text)) + 8;
    const x = d3.scaleLinear([0, d3.max(rows, value) || 1], [0, Math.max(10, w - lw - vw)]);
    const g = svg.selectAll('g.r').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * (bh + gap)})`).each(function (d) { if (linkTo) rh.linkPage(this, ...linkTo(d)); });
    g.append('text').attr('class', 'axl').attr('x', lw - 8).attr('y', bh / 2).attr('dy', '0.35em').attr('text-anchor', 'end')
      .text((d) => { const s = String(label(d)); return s.length > 34 ? s.slice(0, 33) + '…' : s; });
    g.append('path').call(rh.grow, 'd', () => rh.barPath(lw, 0, 0, bh, 'right'), (d) => rh.barPath(lw, 0, value(d) > 0 ? Math.max(2, x(value(d))) : 0, bh, 'right')).attr('fill', color);
    g.append('text').attr('class', 'lbl-in').attr('x', (d) => lw + x(value(d)) + 6).attr('y', bh / 2).attr('dy', '0.35em').text(text).call(rh.grow, 'opacity', 0, 1);
    g.append('rect').attr('class', 'hit').attr('y', -gap / 2).attr('width', w).attr('height', bh + gap).attr('fill', 'transparent')
      .on('mousemove', (e, d) => rh.showTip(tipEl, box, e, (t) => tip(t, d))).on('mouseleave', () => rh.hideTip(tipEl));
  }

  const card = (o) => rh.card({ tab: 'money', chartClass: 'mn-box', ...o });
  rh.tab('money', 'Money', { after: 'library' });

  // ---------- cards ----------
  card({
    id: 'time-value', title: 'What your reading time is worth', calc: 'time_books',
    note: 'Hours read times an hourly rate you choose: what you earn, or what an hour of your free time is worth to you. The rate stays in this browser; nobody else sees it.',
    draw(box, rows, parts) {
      controls(parts);
      const r = rate(), hours = d3.sum(rows, (b) => b.hours);
      const years = data('time_years') || [], asOf = (data('as_of') || [])[0]?.date;
      const year = asOf ? +asOf.slice(0, 4) : null, thisYear = years.find((y) => y.year === year);
      const priced = rows.filter((b) => b.price != null);
      const spent = d3.sum(priced, (b) => b.price);
      const k = el('div', 'rh-kpis');
      k.append(...[
        kpi('Your reading time is worth', money(hours * r, 0), `${fmt(Math.round(hours))} hours at ${money(r)} an hour`),
        thisYear ? kpi(`In ${year}`, money(thisYear.hours * r, 0), `${fmt(Math.round(thisYear.hours))} hours`) : null,
        kpi('A book, on average', money(rows.length ? (hours * r) / rows.length : 0), `${plural(rows.length, 'book')} with time logged`),
        priced.length ? kpi('True cost of your priced books', money(spent + d3.sum(priced, (b) => b.hours) * r, 0), `${Math.round((100 * d3.sum(priced, (b) => b.hours) * r) / Math.max(1e-9, spent + d3.sum(priced, (b) => b.hours) * r))}% of it is your time`) : null,
      ].filter(Boolean));
      const note = el('p', 'note tv-default');
      note.hidden = !isDefault();
      note.textContent = `Using ${money(DEFAULT_RATE)} an hour, roughly the UK minimum wage, until you set your own rate above.`;
      box.replaceChildren(k, note);
    },
  });

  card({
    id: 'time-years', title: 'Time value by year', calc: 'time_years', wide: false,
    note: 'Hours read each year (from the daily log) at your rate.',
    draw(box, rows) {
      const r = rate(), list = rows.slice().reverse();
      bars(box, list, {
        label: (d) => d.year, value: (d) => d.hours * r, text: (d) => money(d.hours * r, 0),
        linkTo: (d) => ['year', d.year],
        tip: (t, d) => rh.tipLines(t, String(d.year), [[null, 'Hours', fmt(d.hours)], [null, 'Worth', money(d.hours * r, 0)]]),
      });
    },
  });

  let boardKind = 'author';
  card({
    id: 'time-board', title: 'Who had most of your time', calc: 'time_groups', wide: false,
    note: 'The authors, books, genres and series you spent the most hours on, valued at your rate.',
    draw(box, groups, parts) {
      if (!parts.head.querySelector('select')) {
        const sel = el('select', 'rng-sel');
        sel.setAttribute('aria-label', 'Group by');
        Object.entries(GROUPS).forEach(([v, n]) => { const o = el('option', null, n); o.value = v; sel.append(o); });
        sel.value = boardKind;
        sel.addEventListener('change', () => { boardKind = sel.value; rh.redraw(); });
        parts.head.append(sel);
      }
      const r = rate();
      const rows = boardKind === 'book'
        ? (data('time_books') || []).map((b) => ({ ...b, name: b.title, books: 1 }))
        : groups.filter((g) => g.kind === boardKind);
      const top = rows.slice().sort((a, b) => b.hours - a.hours).slice(0, 10);
      bars(box, top, {
        label: (d) => d.name, value: (d) => d.hours, text: (d) => `${money(d.hours * r, 0)} · ${fmt(Math.round(d.hours))} h`,
        color: (d) => (boardKind === 'genre' ? rh.gColor(d.name) : rh.C[0]),
        linkTo: (d) => (boardKind === 'book' ? ['book', d.book_id] : [boardKind, d.name]),
        tip: (t, d) => rh.tipLines(t, d.name, [[null, 'Hours', fmt(d.hours)], [null, 'Worth', money(d.hours * r, 0)], ...(d.books > 1 ? [[null, 'Books', fmt(d.books)]] : [])]),
      });
    },
  });

  card({
    id: 'time-true', title: 'True cost: price plus your time', calc: 'time_books',
    note: 'Your priced books by what they cost you counting your time: the price you paid, and the hours you spent at your rate. For most books the time is the larger part.',
    hidden: () => !(data('time_books') || []).some((b) => b.price != null),
    draw(box, rows) {
      const r = rate(), C = rh.C;
      const list = rows.filter((b) => b.price != null).map((b) => ({ ...b, time: b.hours * r, total: b.price + b.hours * r }))
        .sort((a, b) => b.total - a.total).slice(0, 10);
      const lg = el('div', 'legend');
      [[C[1], 'Price'], [C[0], 'Your time']].forEach(([c, n]) => { const s = el('span'), i = el('i', 'sw'); i.style.background = c; s.append(i, n); lg.append(s); });
      const chart = el('div', 'chart mn-chart');
      box.replaceChildren(lg, chart);
      const bh = 22, gap = 6, h = list.length * (bh + gap) + 4;
      const { svg, w, tip } = rh.svgIn(chart, h);
      const lw = Math.min(w * 0.4, rh.measure(svg, list.map((d) => d.title)) + 10);
      const vw = rh.measure(svg, list.map((d) => money(d.total, 0))) + 8;
      const x = d3.scaleLinear([0, d3.max(list, (d) => d.total) || 1], [0, Math.max(10, w - lw - vw)]);
      const g = svg.selectAll('g.r').data(list).join('g').attr('transform', (d, i) => `translate(0,${i * (bh + gap)})`).each(function (d) { rh.linkBook(this, d.book_id); });
      g.append('text').attr('class', 'axl').attr('x', lw - 8).attr('y', bh / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => (d.title.length > 30 ? d.title.slice(0, 29) + '…' : d.title));
      // price first (square end), then time with a surface gap and the rounded end
      const pw = (d) => (d.price > 0 ? Math.max(2, x(d.price)) : 0);
      g.filter((d) => d.price > 0).append('path').call(rh.grow, 'd', () => rh.barPath(lw, 0, 0, bh, 'right', 0), (d) => rh.barPath(lw, 0, pw(d), bh, 'right', 0)).attr('fill', C[1]);
      g.append('path').call(rh.grow, 'd', (d) => rh.barPath(lw + pw(d), 0, 0, bh, 'right'), (d) => rh.barPath(lw + pw(d) + (d.price > 0 ? rh.MARK.gap : 0), 0, Math.max(2, x(d.time) - (d.price > 0 ? rh.MARK.gap : 0)), bh, 'right')).attr('fill', C[0]);
      g.append('text').attr('class', 'lbl-in').attr('x', (d) => lw + x(d.total) + 6).attr('y', bh / 2).attr('dy', '0.35em').text((d) => money(d.total, 0)).call(rh.grow, 'opacity', 0, 1);
      g.append('rect').attr('class', 'hit').attr('y', -gap / 2).attr('width', w).attr('height', bh + gap).attr('fill', 'transparent')
        .on('mousemove', (e, d) => rh.showTip(tip, chart, e, (t) => rh.tipLines(t, d.title, [[C[1], 'Price', money(d.price)], [C[0], 'Your time', `${money(d.time, 0)} (${fmt(d.hours)} h)`], [null, 'True cost', money(d.total, 0)]])))
        .on('mouseleave', () => rh.hideTip(tip));
    },
  });

  // ---------- pages ----------
  const MANY = { author: 'authors', series: 'series', genre: 'genres', subgenre: 'subgenres' };
  ['author', 'series', 'genre', 'subgenre'].forEach((field) => rh.extend(field, (name, root) => {
    const groups = data('time_groups');
    const g = groups && groups.find((x) => x.kind === field && x.name === name);
    if (!g) return;
    const peers = groups.filter((x) => x.kind === field).sort((a, b) => b.hours - a.hours);
    const all = d3.sum((data('time_books') || []), (b) => b.hours);
    const r = rate();
    const c = el('div', 'rh-card wide tv-page'), k = el('div', 'rh-kpis');
    k.append(
      kpi('Your time here', money(g.hours * r, 0), `${fmt(Math.round(g.hours))} hours at ${money(r)} an hour`),
      kpi('Share of your reading', `${Math.round((100 * g.hours) / Math.max(1, all))}%`, `#${peers.indexOf(g) + 1} of ${peers.length} ${MANY[field]} by hours`),
      kpi('A book, on average', money((g.hours * r) / g.books), plural(g.books, 'book')),
    );
    c.append(el('h2', null, 'Your time'), el('p', 'note', 'Hours read here, valued at your hourly rate (set it on the Money tab).'), k);
    root.append(c);
  }));
  rh.extend('year', (id, root) => {
    const y = (data('time_years') || []).find((x) => String(x.year) === String(id));
    if (!y) return;
    const r = rate();
    const c = el('div', 'rh-card wide tv-page'), k = el('div', 'rh-kpis');
    k.append(kpi('Your reading time was worth', money(y.hours * r, 0), `${fmt(Math.round(y.hours))} hours at ${money(r)} an hour`),
      kpi('A day, on average', money((y.hours * r) / 365), `${fmt(Math.round((y.hours * 60) / 365))} minutes a day`));
    c.append(el('h2', null, 'Your time'), el('p', 'note', `Hours logged in ${id}, valued at your hourly rate (set it on the Money tab).`), k);
    root.append(c);
  });
  rh.bookCard({
    id: 'bk-time', title: 'What it cost you', calc: 'time_books', before: 'card-bk-log', chartClass: 'tv-box',
    note: 'The hours you spent in it at your hourly rate (set it on the Money tab), plus what you paid for it.',
    draw(box, rows, parts, b) {
      const row = rows.find((x) => x.book_id === b.id);
      if (!row) return false;
      const r = rate(), k = el('div', 'rh-kpis');
      k.append(kpi('Your time', money(row.hours * r, 0), `${fmt(row.hours)} hours at ${money(r)} an hour`));
      if (row.price != null) k.append(kpi('Price', money(row.price), row.price > 0 && row.hours >= 0.5 ? `${money(row.price / row.hours)} an hour` : null), kpi('True cost', money(row.price + row.hours * r, 0), 'price plus your time'));
      box.replaceChildren(k);
    },
  });
})();
