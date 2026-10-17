// Money: what your books cost (data/prices.json, set in Admin → Prices). Spending over time
// and against a budget, value for money (cost per hour and per 10k words), the dearest
// authors, genres and series, and money stats on their pages. Everything here hides when
// there are no prices, or when they're kept from this viewer.
(() => {
  const { el, fmt, plural, pDate, fDay } = rh;

  // optional: most libraries have no prices, and some viewers aren't shown them
  dash.file('prices', 'data/prices.json', { optional: true });

  const ACQ = { bought: 'Bought', free: 'Free', library: 'Library loan', subscription: 'Subscription', gift: 'Gift' };
  // the file's contents, or null when it's missing (loaded as []) or empty
  const pricesOf = (p) => (p && !Array.isArray(p) && Array.isArray(p.books) ? p : null);
  const MIN_HOURS = 0.5; // less than this is too little reading to judge a book's value by
  const round2 = (n) => Math.round(n * 100) / 100;
  const monthsBetween = (a, b) => {
    const out = [];
    for (let [y, m] = a.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= b; m === 12 ? ((m = 1), y++) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
    return out;
  };

  // ---------- calcs ----------
  dash.calc('money_books', {
    inputs: ['books', 'reads', 'prices'],
    title: 'Book prices',
    description: 'Each priced book with what it cost (in the home currency), the hours and words read, and cost per hour and per 10k words. Books priced but not in the reading data were never opened.',
    fn: (books, reads, prices) => {
      const p = pricesOf(prices);
      if (!p) return [];
      const byId = new Map(books.map((b) => [b.id, b]));
      const firstHours = new Map();
      reads.forEach((r) => { if (r.read_no === 1) firstHours.set(r.book_id, r.hours || 0); });
      return p.books.filter((e) => e.price != null).map((e) => {
        const b = byId.get(e.book_id);
        const hours = b ? b.hours || 0 : 0, words = b ? b.words || 0 : 0, first = firstHours.get(e.book_id) ?? hours;
        const paid = e.price > 0;
        return {
          book_id: e.book_id, title: b ? b.title : e.title, author: (b ? b.author : e.author) || null,
          genre: b ? b.genre : null, subgenre: b ? b.subgenre : null, series: b ? b.series : null, series_no: b ? b.series_no : null,
          status: b ? b.status : 'not_opened', progress: b ? b.progress : null, last_read: b ? b.last_read : null, opened: !!b,
          hours, words, times_read: b ? b.times_read : 0,
          price: e.price, list_price: e.list_price, acquisition: e.acquisition, date: e.date, store: e.store,
          subscription: e.subscription, bundle: e.bundle,
          per_hour: paid && hours >= MIN_HOURS ? round2(e.price / hours) : null,
          per_10k: paid && words > 0 ? round2((e.price / words) * 10000) : null,
          first_per_hour: paid && first >= MIN_HOURS ? round2(e.price / first) : null,
        };
      });
    },
  });

  // every payment: books on the day they were bought, subscription fees on the 1st of each month
  dash.calc('money_events', {
    inputs: ['money_books', 'prices', 'as_of'],
    title: 'Payments',
    description: 'Every payment in date order: priced books on their purchase date and subscription fees on the first of each month they ran.',
    fn: (rows, prices, asOf) => {
      const p = pricesOf(prices);
      if (!p) return [];
      const today = (asOf[0] && asOf[0].date) || new Date().toISOString().slice(0, 10);
      const out = rows.filter((r) => r.date && r.price > 0).map((r) => ({ date: r.date, amount: r.price, kind: 'book', name: r.title, book_id: r.book_id }));
      p.subscriptions.forEach((s) => {
        const end = s.end && s.end < today.slice(0, 7) ? s.end : today.slice(0, 7);
        monthsBetween(s.start, end).forEach((m) => out.push({ date: m + '-01', amount: s.monthly_fee, kind: 'subscription', name: s.name, book_id: null }));
      });
      out.sort((a, b) => a.date.localeCompare(b.date));
      let total = 0;
      out.forEach((e) => { total = round2(total + e.amount); e.cumulative = total; });
      return out;
    },
  });

  dash.calc('money_months', {
    inputs: ['money_events', 'as_of'],
    title: 'Spending per month',
    description: 'Books bought and subscription fees per month, from the first payment to the last day of the reading log.',
    fn: (events, asOf) => {
      if (!events.length) return [];
      const last = [events[events.length - 1].date, (asOf[0] && asOf[0].date) || ''].sort().pop().slice(0, 7);
      const by = new Map(monthsBetween(events[0].date.slice(0, 7), last).map((m) => [m, { month: m, books: 0, subscriptions: 0, total: 0, n_books: 0 }]));
      events.forEach((e) => {
        const r = by.get(e.date.slice(0, 7));
        if (!r) return;
        if (e.kind === 'book') { r.books = round2(r.books + e.amount); r.n_books++; } else r.subscriptions = round2(r.subscriptions + e.amount);
        r.total = round2(r.total + e.amount);
      });
      let cum = 0;
      return [...by.values()].map((r) => ({ ...r, cumulative: (cum = round2(cum + r.total)) }));
    },
  });

  dash.calc('money_years', {
    inputs: ['money_months', 'prices'],
    title: 'Spending per year',
    description: 'Books bought and subscription fees per year, with the yearly budget if one is set.',
    fn: (months, prices) => {
      const p = pricesOf(prices), by = new Map();
      months.forEach((m) => {
        const y = +m.month.slice(0, 4);
        const r = by.get(y) || { year: y, books: 0, subscriptions: 0, total: 0, n_books: 0 };
        r.books = round2(r.books + m.books); r.subscriptions = round2(r.subscriptions + m.subscriptions);
        r.total = round2(r.total + m.total); r.n_books += m.n_books;
        by.set(y, r);
      });
      return [...by.values()].map((r) => ({ ...r, budget: (p && p.budgets[r.year]) || null }));
    },
  });

  dash.calc('money_acquisition', {
    inputs: ['money_books', 'money_events'],
    title: 'How books were got',
    description: 'Books and spending by how they were got. Subscriptions count their fees; list value is what library, gifted and subscription books would have cost to buy.',
    fn: (rows, events) => Object.keys(ACQ).map((a) => {
      const mine = rows.filter((r) => r.acquisition === a);
      const spent = a === 'subscription' ? events.filter((e) => e.kind === 'subscription').reduce((s, e) => s + e.amount, 0) : mine.reduce((s, r) => s + r.price, 0);
      return { acquisition: a, label: ACQ[a], books: mine.length, spent: round2(spent), list_value: round2(mine.reduce((s, r) => s + (r.list_price || 0), 0)), hours: Math.round(mine.reduce((s, r) => s + r.hours, 0)) };
    }).filter((r) => r.books || r.spent),
  });

  dash.calc('money_summary', {
    inputs: ['money_books', 'money_months', 'books', 'as_of'],
    title: 'Money at a glance',
    description: 'Lifetime and this year\'s spending, the monthly average, and everything spent divided by every hour read.',
    fn: (rows, months, books, asOf) => {
      if (!rows.length) return [];
      const year = ((asOf[0] && asOf[0].date) || new Date().toISOString()).slice(0, 4);
      const total = months.length ? months[months.length - 1].cumulative : 0;
      const hours = books.reduce((s, b) => s + (b.hours || 0), 0);
      const paid = rows.filter((r) => r.price > 0);
      return [{
        lifetime: total, year: +year,
        this_year: round2(months.filter((m) => m.month.startsWith(year)).reduce((s, m) => s + m.total, 0)),
        per_month: months.length ? round2(total / months.length) : 0,
        priced: rows.length, paid: paid.length, free: rows.filter((r) => r.price === 0).length,
        unopened: rows.filter((r) => !r.opened).length,
        per_hour_all: hours ? round2(total / hours) : null,
        hours: Math.round(hours),
      }];
    },
  });

  // authors, genres, subgenres and series by spend and cost per hour
  const GROUPS = { author: 'Authors', genre: 'Genres', subgenre: 'Subgenres', series: 'Series' };
  dash.calc('money_groups', {
    inputs: ['money_books'],
    title: 'Spending by author, genre and series',
    description: 'For each author, genre, subgenre and series: what its priced books cost, the hours read in them and the cost per hour.',
    fn: (rows) => {
      const out = [];
      Object.keys(GROUPS).forEach((field) => {
        const by = new Map();
        rows.filter((r) => r[field]).forEach((r) => {
          const g = by.get(r[field]) || { kind: field, name: r[field], [field]: r[field], spent: 0, books: 0, hours: 0, dearest: null };
          g.spent = round2(g.spent + r.price); g.books++; g.hours += r.hours;
          if (!g.dearest || r.price > g.dearest.price) g.dearest = { book_id: r.book_id, title: r.title, price: r.price };
          by.set(r[field], g);
        });
        by.forEach((g) => out.push({ ...g, hours: Math.round(g.hours * 10) / 10, per_hour: g.spent > 0 && g.hours >= MIN_HOURS ? round2(g.spent / g.hours) : null }));
      });
      return out;
    },
  });

  // what's been spent on each series, and a rough cost to finish it
  dash.calc('money_series', {
    inputs: ['money_books', 'books'],
    title: 'Cost to finish a series',
    description: 'Spent on each series so far, what is paid for but not yet finished, and an estimate for volumes you don\'t have (gaps in the series numbers up to the highest you have, at your average price for that series).',
    fn: (rows, books) => {
      const out = [];
      new Set(books.filter((b) => b.series).map((b) => b.series)).forEach((series) => {
        const mine = books.filter((b) => b.series === series);
        const priced = rows.filter((r) => r.series === series);
        if (!priced.length) return;
        const nos = new Set(mine.map((b) => b.series_no).filter((n) => Number.isInteger(n)));
        const max = Math.max(0, ...nos);
        let gaps = 0;
        for (let i = 1; i <= max; i++) if (!nos.has(i)) gaps++;
        const spent = round2(priced.reduce((s, r) => s + r.price, 0));
        const avg = round2(spent / priced.length);
        out.push({
          series, books: mine.length, priced: priced.length, finished: mine.filter((b) => b.status === 'finished').length,
          spent, avg_price: avg,
          unfinished_spent: round2(priced.filter((r) => r.status !== 'finished').reduce((s, r) => s + r.price, 0)),
          missing: gaps, to_buy: round2(gaps * avg),
        });
      });
      return out;
    },
  });

  // ---------- helpers ----------
  let CUR = 'GBP';
  function money(n, dp) {
    if (n == null) return '—';
    const d = dp ?? (Math.abs(n) >= 100 ? 0 : 2);
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: CUR, minimumFractionDigits: d, maximumFractionDigits: d }).format(n); }
    catch (e) { return n.toFixed(d); }
  }
  const perHour = (n) => (n == null ? '—' : money(n, 2) + '/h');
  const data = (id) => { const r = dash.data(id); return r.status === 'ok' ? r.data : null; };
  const hasPrices = () => { const r = data('money_books'); return !!(r && r.length); };
  const fMonth = (d) => d3.utcFormat('%b %Y')(d); // d3 isn't there when the calcs run in tests
  const kpi = (lbl, val, sub) => { const n = el('div', 'rh-kpi'); n.append(el('div', 'lbl', lbl), el('div', 'val', val)); if (sub) n.append(el('div', 'sub', sub)); return n; };
  const swatchLegend = (items) => { const lg = el('div', 'legend'); items.forEach(([c, n, cls]) => { const s = el('span'); const i = el('i', 'sw' + (cls ? ' ' + cls : '')); if (c) i.style.background = c; s.append(i, n); lg.append(s); }); return lg; };

  // bars with money labels: rows, label(r), value(r), linkTo(r) → [kind, id], tip(t, r)
  function moneyBars(box, rows, { label, value, text = (r) => money(value(r)), color = () => rh.C[0], linkTo, tip }) {
    const bh = 22, gap = 6, h = rows.length * (bh + gap) + 4;
    const { svg, w, tip: tipEl } = rh.svgIn(box, h);
    const lw = Math.min(w * 0.45, rh.measure(svg, rows.map(label)) + 10);
    const vw = rh.measure(svg, rows.map(text)) + 8;
    const x = d3.scaleLinear([0, d3.max(rows, value) || 1], [0, Math.max(10, w - lw - vw)]);
    const g = svg.selectAll('g.r').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * (bh + gap)})`).each(function (d) { if (linkTo) rh.linkPage(this, ...linkTo(d)); });
    g.append('text').attr('class', 'axl').attr('x', lw - 8).attr('y', bh / 2).attr('dy', '0.35em').attr('text-anchor', 'end')
      .text((d) => { const s = label(d); return s.length > 34 ? s.slice(0, 33) + '…' : s; });
    g.append('path').call(rh.grow, 'd', () => rh.barPath(lw, 0, 0, bh, 'right'), (d) => rh.barPath(lw, 0, value(d) > 0 ? Math.max(2, x(value(d))) : 0, bh, 'right')).attr('fill', color);
    g.append('text').attr('class', 'lbl-in').attr('x', (d) => lw + x(value(d)) + 6).attr('y', bh / 2).attr('dy', '0.35em').text(text).call(rh.grow, 'opacity', 0, 1);
    g.append('rect').attr('class', 'hit').attr('y', -gap / 2).attr('width', w).attr('height', bh + gap).attr('fill', 'transparent')
      .on('mousemove', (e, d) => rh.showTip(tipEl, box, e, (t) => tip(t, d))).on('mouseleave', () => rh.hideTip(tipEl));
  }

  // a list of books: title, linked byline, and meta on the right
  function bookRows(rows, meta) {
    const ul = el('ul', 'rh-list mn-list');
    if (!rows.length) { ul.append(el('li', 'meta', 'Nothing here yet.')); return ul; }
    rows.forEach((r) => {
      const li = el('li'), ttl = el('div', 'ttl');
      if (r.opened !== false) rh.linkBook(li, r.book_id);
      li.append(rh.cover(r.book_id, r.title, r.genre));
      ttl.append(document.createTextNode(r.title), rh.byline('small', null, r, ['author']));
      li.append(ttl, el('div', 'meta', meta(r)));
      ul.append(li);
    });
    return ul;
  }

  // ---------- the tab ----------
  // made once there are prices to show, so viewers without any never see an empty tab
  let tabMade = false;
  dash.onData(() => {
    const p = data('prices');
    if (p && pricesOf(p)) CUR = p.currency || 'GBP';
    if (tabMade || !hasPrices()) return;
    tabMade = true;
    rh.tab('money', 'Money', { after: 'library' });
    if (location.hash === '#money') rh.show('money');
  });
  const card = (o) => rh.card({ tab: 'money', hidden: () => !hasPrices(), chartClass: 'mn-box', ...o });

  // ---------- BOO-41: spending ----------
  card({
    id: 'money-kpis', title: 'What your books cost', calc: 'money_summary',
    note: 'Books bought plus subscription fees, in your home currency. Free, library and gifted books count as nothing spent.',
    draw(box, rows) {
      const s = rows[0];
      if (!s) return;
      const k = el('div', 'rh-kpis');
      k.append(
        kpi('Spent in all', money(s.lifetime), `${plural(s.paid, 'book')} paid for, ${fmt(s.free)} got for nothing`),
        kpi(`Spent in ${s.year}`, money(s.this_year), null),
        kpi('A month, on average', money(s.per_month), null),
        kpi('Per hour read', perHour(s.per_hour_all), `everything spent ÷ ${fmt(s.hours)} hours`),
      );
      box.replaceChildren(k);
    },
  });

  card({
    id: 'money-months', title: 'Spending by month', calc: 'money_months',
    note: 'Books bought in each month, and subscription fees on top.',
    draw(box, rows) {
      const C = rh.C;
      box.replaceChildren(swatchLegend([[C[0], 'Books'], [C[1], 'Subscriptions']]));
      const chart = el('div', 'chart mn-chart'); box.append(chart);
      const h = 220, { svg, w, tip } = rh.svgIn(chart, h), m = { t: 10, r: 6, b: 24, l: 44 };
      const x = d3.scaleBand(rows.map((r) => r.month), [m.l, w - m.r]).padding(0.2);
      const y = d3.scaleLinear([0, d3.max(rows, (r) => r.total) || 1], [h - m.b, m.t]).nice();
      rh.axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4).tickFormat((v) => money(v, 0)).tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      const jan = rows.filter((r) => r.month.endsWith('-01')).map((r) => r.month);
      const step = Math.ceil(jan.length / Math.max(1, Math.floor((w - m.l) / 46)));
      rh.axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(jan.filter((_, i) => i % step === 0)).tickFormat((s) => s.slice(0, 4)).tickSize(0).tickPadding(8));
      const bw = x.bandwidth();
      const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d) => `translate(${x(d.month)},0)`);
      g.filter((d) => d.books > 0).append('path').call(rh.grow, 'd', () => rh.barPath(0, y(0), bw, 0), (d) => rh.barPath(0, y(d.books), bw, y(0) - y(d.books), 'up', d.subscriptions > 0 ? 0 : rh.MARK.radius)).attr('fill', C[0]);
      g.filter((d) => d.subscriptions > 0).append('path').call(rh.grow, 'd', () => rh.barPath(0, y(0), bw, 0), (d) => rh.barPath(0, y(d.total), bw, Math.max(1, y(d.books) - y(d.total) - (d.books > 0 ? rh.MARK.gap : 0)))).attr('fill', C[1]);
      g.append('rect').attr('class', 'hit').attr('x', -(x.step() - bw) / 2).attr('width', x.step()).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
        .on('mousemove', (e, d) => rh.showTip(tip, chart, e, (t) => rh.tipLines(t, fMonth(pDate(d.month + '-01')), [[C[0], 'Books', `${money(d.books)}${d.n_books ? ` (${d.n_books})` : ''}`], [C[1], 'Subscriptions', money(d.subscriptions)], [null, 'Total', money(d.total)]])))
        .on('mouseleave', () => rh.hideTip(tip));
    },
  });

  card({
    id: 'money-years', title: 'Spending by year', calc: 'money_years', wide: false,
    note: 'Each year\'s spending; the dashed line is that year\'s budget, if you set one in Admin → Prices.',
    draw(box, rows) {
      const C = rh.C;
      const items = [[C[0], 'Books'], [C[1], 'Subscriptions']];
      if (rows.some((r) => r.budget)) items.push([null, 'Budget', 'mn-key-ref']);
      box.replaceChildren(swatchLegend(items));
      const chart = el('div', 'chart mn-chart'); box.append(chart);
      const h = 220, { svg, w, tip } = rh.svgIn(chart, h), m = { t: 18, r: 4, b: 24, l: 44 };
      const x = d3.scaleBand(rows.map((r) => r.year), [m.l, w - m.r]).padding(0.3);
      const y = d3.scaleLinear([0, d3.max(rows, (r) => Math.max(r.total, r.budget || 0)) || 1], [h - m.b, m.t]).nice();
      rh.axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4).tickFormat((v) => money(v, 0)).tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      rh.axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickFormat(String).tickSize(0).tickPadding(8));
      const bw = Math.min(rh.MARK.bar * 1.5, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
      const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d) => `translate(${x(d.year) + off},0)`);
      g.filter((d) => d.books > 0).append('path').call(rh.grow, 'd', () => rh.barPath(0, y(0), bw, 0), (d) => rh.barPath(0, y(d.books), bw, y(0) - y(d.books), 'up', d.subscriptions > 0 ? 0 : rh.MARK.radius)).attr('fill', C[0]);
      g.filter((d) => d.subscriptions > 0).append('path').call(rh.grow, 'd', () => rh.barPath(0, y(0), bw, 0), (d) => rh.barPath(0, y(d.total), bw, Math.max(1, y(d.books) - y(d.total) - (d.books > 0 ? rh.MARK.gap : 0)))).attr('fill', C[1]);
      g.append('text').attr('class', 'lbl-in').attr('x', bw / 2).attr('y', (d) => y(d.total) - 5).attr('text-anchor', 'middle').text((d) => money(d.total, 0)).call(rh.grow, 'opacity', 0, 1);
      g.filter((d) => d.budget).each(function (d) { rh.refLine(d3.select(this), -off / 2, y(d.budget), bw + off / 2, y(d.budget)); });
      g.append('rect').attr('class', 'hit').attr('x', -off - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
        .each(function (d) { rh.linkPage(this, 'year', d.year); })
        .on('mousemove', (e, d) => rh.showTip(tip, chart, e, (t) => rh.tipLines(t, String(d.year), [
          [C[0], 'Books', `${money(d.books)} (${d.n_books})`], [C[1], 'Subscriptions', money(d.subscriptions)], [null, 'Total', money(d.total)],
          ...(d.budget ? [[null, 'Budget', `${money(d.budget)} · ${d.total <= d.budget ? money(d.budget - d.total) + ' left' : money(d.total - d.budget) + ' over'}`]] : [])])))
        .on('mouseleave', () => rh.hideTip(tip));
    },
  });

  // a step line of cumulative spend; pace = [x0, x1, budget] draws the budget's straight line
  function stepChart(box, pts, x0, x1, pace, yMax) {
    const h = 220, { svg, w, tip } = rh.svgIn(box, h), m = { t: 12, r: 12, b: 24, l: 48 };
    const x = d3.scaleUtc([x0, x1], [m.l, w - m.r]);
    const y = d3.scaleLinear([0, Math.max(yMax || 0, d3.max(pts, (p) => p.v) || 1, pace ? pace[2] : 0)], [h - m.b, m.t]).nice();
    rh.axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4).tickFormat((v) => money(v, 0)).tickSize(-(w - m.l - m.r)));
    svg.select('.domain').remove();
    rh.axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(Math.max(2, Math.floor(w / 90))).tickSize(0).tickPadding(8));
    if (pace) rh.refLine(svg, x(pace[0]), y(0), x(pace[1]), y(pace[2]));
    const line = d3.line((p) => x(p.t), (p) => y(p.v)).curve(d3.curveStepAfter);
    svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', rh.C[0]).attr('stroke-width', rh.MARK.line).attr('stroke-linejoin', 'round').attr('d', line).call(rh.drawIn);
    const last = pts[pts.length - 1];
    svg.append('circle').attr('class', 'ring').attr('cx', x(last.t)).attr('cy', y(last.v)).attr('r', rh.MARK.dot).attr('fill', rh.C[0]);
    const guide = svg.append('line').attr('class', 'mn-guide').attr('y1', m.t).attr('y2', h - m.b).style('display', 'none');
    const bis = d3.bisector((p) => p.t).right;
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (e) => {
        const t = x.invert(d3.pointer(e)[0]), p = pts[Math.max(0, bis(pts, t) - 1)];
        guide.style('display', null).attr('x1', x(t)).attr('x2', x(t));
        const lines = [[rh.C[0], 'Spent by then', money(p.v)]];
        if (pace) lines.push([null, 'Budget pace', money((pace[2] * (t - pace[0])) / (pace[1] - pace[0]))]);
        rh.showTip(tip, box, e, (tp) => rh.tipLines(tp, fDay(t), lines));
      })
      .on('mouseleave', () => { guide.style('display', 'none'); rh.hideTip(tip); });
  }
  const utc = (s) => pDate(s);

  let paceYear = null;
  card({
    id: 'money-pace', title: 'Against your budget', calc: 'money_events', wide: false,
    note: 'Spending so far in the year, step by step. The dashed line is the budget spread evenly over the year: under it, you\'re on track.',
    draw(box, events, parts) {
      const years = data('money_years') || [];
      const asOf = (data('as_of') || [])[0]?.date || new Date().toISOString().slice(0, 10);
      if (!years.length) return;
      const withBudget = years.filter((y) => y.budget).map((y) => y.year);
      if (paceYear == null || !years.some((y) => y.year === paceYear)) paceYear = withBudget.includes(+asOf.slice(0, 4)) ? +asOf.slice(0, 4) : withBudget.pop() ?? years[years.length - 1].year;
      let sel = parts.head.querySelector('select');
      if (!sel) {
        sel = el('select', 'rng-sel'); sel.setAttribute('aria-label', 'Year');
        sel.addEventListener('change', () => { paceYear = +sel.value; rh.redraw(); });
        parts.head.append(sel);
      }
      sel.replaceChildren(...years.slice().reverse().map((y) => { const o = el('option', null, String(y.year)); o.value = y.year; return o; }));
      sel.value = paceYear;
      const yr = years.find((y) => y.year === paceYear);
      const x0 = utc(`${paceYear}-01-01`), x1 = utc(`${paceYear + 1}-01-01`);
      const end = String(paceYear) === asOf.slice(0, 4) ? utc(asOf) : x1;
      const pts = [{ t: x0, v: 0 }];
      let v = 0;
      events.filter((e) => e.date.startsWith(String(paceYear))).forEach((e) => { v = round2(v + e.amount); pts.push({ t: utc(e.date), v }); });
      pts.push({ t: end, v });
      const head = el('p', 'mn-take');
      if (yr.budget) {
        const share = (end - x0) / (x1 - x0), expect = yr.budget * share;
        const proj = share > 0 ? v / share : v;
        head.innerHTML = '';
        head.append(el('b', null, money(v)), ` of a ${money(yr.budget)} budget`,
          end < x1 ? (v <= expect ? `, ${money(expect - v)} under pace. At this rate you'd spend about ` : `, ${money(v - expect)} over pace. At this rate you'd spend about `) : (v <= yr.budget ? `: ${money(yr.budget - v)} to spare.` : `: ${money(v - yr.budget)} over.`),
          end < x1 ? el('b', null, money(proj, 0)) : '', end < x1 ? ' by the end of the year.' : '');
      } else head.append(el('b', null, money(v)), ` spent in ${paceYear}. No budget set for this year.`);
      const chart = el('div', 'chart mn-chart');
      box.replaceChildren(head, chart);
      stepChart(chart, pts, x0, x1, yr.budget ? [x0, x1, yr.budget] : null);
    },
  });

  card({
    id: 'money-lifetime', title: 'Lifetime spending', calc: 'money_events', wide: false,
    note: 'Everything spent on books and subscriptions, added up over time.',
    draw(box, events) {
      if (!events.length) { box.replaceChildren(el('p', 'note', 'No dated payments yet.')); return; }
      const asOf = (data('as_of') || [])[0]?.date;
      const pts = [{ t: utc(events[0].date), v: 0 }, ...events.map((e) => ({ t: utc(e.date), v: e.cumulative }))];
      const end = asOf && asOf > events[events.length - 1].date ? utc(asOf) : pts[pts.length - 1].t;
      pts.push({ t: end, v: pts[pts.length - 1].v });
      const head = el('p', 'mn-take');
      head.append(el('b', null, money(pts[pts.length - 1].v)), ` since ${fMonth(pts[0].t)}`);
      const chart = el('div', 'chart mn-chart');
      box.replaceChildren(head, chart);
      stepChart(chart, pts, pts[0].t, end, null);
    },
  });

  card({
    id: 'money-acq', title: 'How you got your books', calc: 'money_acquisition', wide: false,
    note: 'Books by how you got them. Library loans, gifts and subscription books show what they would have cost to buy, where you gave a list price.',
    draw(box, rows) {
      const saved = rows.filter((r) => r.acquisition !== 'bought' && r.acquisition !== 'free').reduce((s, r) => s + r.list_value, 0);
      const head = el('p', 'mn-take');
      if (saved > 0) head.append('Library loans, gifts and subscriptions covered books worth about ', el('b', null, money(saved, 0)), ' at list price.');
      const chart = el('div', 'chart mn-chart');
      box.replaceChildren(head, chart);
      moneyBars(chart, rows, {
        label: (r) => r.label, value: (r) => r.books, text: (r) => `${plural(r.books, 'book')}${r.spent ? ' · ' + money(r.spent, 0) : ''}`,
        color: (r, i) => rh.C[Object.keys(ACQ).indexOf(r.acquisition)],
        tip: (t, r) => rh.tipLines(t, r.label, [[null, 'Books', fmt(r.books)], [null, r.acquisition === 'subscription' ? 'Fees paid' : 'Spent', money(r.spent)], [null, 'Hours read', fmt(r.hours)], ...(r.list_value ? [[null, 'Would have cost', money(r.list_value)]] : [])]),
      });
    },
  });

  // ---------- BOO-42: value for money ----------
  card({
    id: 'money-value', title: 'Price against hours read', calc: 'money_books',
    note: 'Each paid book you\'ve opened: what it cost against the hours you\'ve spent in it. The dashed lines are rough costs of an hour of other things (set in Admin → Prices); books under a line were better value than that.',
    draw(box, rows) {
      const pts = rows.filter((r) => r.price > 0 && r.hours >= MIN_HOURS);
      const p = pricesOf(data('prices'));
      const bench = (p && p.benchmarks) || [];
      const free = rows.filter((r) => r.price === 0 && r.opened);
      const head = el('p', 'mn-take');
      head.append(el('b', null, plural(pts.length, 'paid book')), ' plotted');
      if (free.length) head.append(' · ', el('b', null, plural(free.length, 'free book')), ` gave you ${fmt(Math.round(d3.sum(free, (r) => r.hours)))} hours for nothing`);
      const chart = el('div', 'chart mn-chart');
      box.replaceChildren(head, chart);
      if (!pts.length) return;
      const h = 300, { svg, w, tip } = rh.svgIn(chart, h), m = { t: 12, r: 16, b: 34, l: 48 };
      const x = d3.scaleLinear([0, d3.max(pts, (r) => r.hours) * 1.05], [m.l, w - m.r]).nice();
      const y = d3.scaleLinear([0, d3.max(pts, (r) => r.price) * 1.1], [h - m.b, m.t]).nice();
      rh.axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickFormat((v) => money(v, 0)).tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      rh.axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(6).tickFormat((v) => v + ' h').tickSize(0).tickPadding(8));
      // benchmark lines: price = rate × hours, clipped to the plot; labelled where they leave
      // its right edge, and summed up under it
      const [X1, Y1] = [x.domain()[1], y.domain()[1]];
      const bg = svg.append('g');
      // labels go where each line leaves the plot, skipping any that would overlap the last one
      let lastTop = Infinity, lastRight = Infinity;
      bench.slice().sort((a, b) => a.per_hour - b.per_hour).forEach((b) => {
        const hx = Math.min(X1, Y1 / b.per_hour), py = hx * b.per_hour;
        if (hx <= 0) return;
        rh.refLine(bg, x(0), y(0), x(hx), y(py));
        const label = `${b.name} ${perHour(b.per_hour)}`;
        const tw = rh.measure(svg, [label]);
        if (hx >= X1) {
          if (lastRight - y(py) < 14) return;
          lastRight = y(py);
          bg.append('text').attr('class', 'axl mn-bench').attr('x', x(hx) - 4).attr('y', y(py) - 5).attr('text-anchor', 'end').text(label);
        } else {
          const left = x(hx) + 4 + tw <= w - 2 ? x(hx) + 4 : x(hx) - 4 - tw;
          if (left + tw > lastTop - 6) return;
          lastTop = left;
          bg.append('text').attr('class', 'axl mn-bench').attr('x', left).attr('y', y(py) + 10).text(label);
        }
      });
      svg.append('g').selectAll('circle').data(pts).join('circle').attr('class', 'ring').attr('cx', (r) => x(r.hours)).attr('cy', (r) => y(r.price))
        .attr('fill', (r) => rh.gColor(r.genre)).call(rh.grow, 'r', 0, rh.MARK.dot + 1)
        .each(function (r) { rh.linkBook(this, r.book_id); })
        .on('mousemove', (e, r) => rh.showTip(tip, chart, e, (t) => rh.tipLines(t, r.title, [[rh.gColor(r.genre), r.genre || '', ''], [null, 'Paid', money(r.price)], [null, 'Hours', fmt(r.hours)], [null, 'Per hour', perHour(r.per_hour)], [null, 'Per 10k words', r.per_10k == null ? '—' : money(r.per_10k)]])))
        .on('mouseleave', () => rh.hideTip(tip));
      svg.append('text').attr('class', 'axl').attr('x', w - m.r).attr('y', h - 4).attr('text-anchor', 'end').text('hours read (all reads)');
      if (bench.length) {
        const mid = d3.median(pts, (r) => r.per_hour);
        const cheaper = bench.filter((b) => b.per_hour > mid).sort((a, b) => a.per_hour - b.per_hour);
        const dearer = bench.filter((b) => b.per_hour <= mid);
        const foot = el('p', 'note mn-foot');
        const name = (b) => `${b.name.toLowerCase()} (${perHour(b.per_hour)})`;
        foot.append('Half your paid books cost under ', el('b', null, perHour(mid)), '. ');
        if (cheaper.length) foot.append(`That’s cheaper than ${cheaper.map(name).join(', ')}`);
        if (dearer.length) foot.append(`${cheaper.length ? ', but' : 'That’s'} dearer than ${dearer.map(name).join(', ')}`);
        foot.append('. These are rough figures; set your own in Admin → Prices.');
        box.append(foot);
      }
    },
  });

  card({
    id: 'money-best', title: 'Best and worst value', calc: 'money_books', wide: false,
    note: 'Paid books by cost per hour of reading, over every read. Books you only dipped into look dear; that\'s the point.',
    draw(box, rows) {
      const ranked = rows.filter((r) => r.per_hour != null).sort((a, b) => a.per_hour - b.per_hour);
      const n = Math.min(5, Math.floor(ranked.length / 2)) || Math.min(5, ranked.length);
      const meta = (r) => `${perHour(r.per_hour)} · ${money(r.price)}`;
      const grid = el('div', 'mn-two');
      const col = (t, list) => { const c = el('div'); c.append(el('h3', 'mn-h3', t), bookRows(list, meta)); return c; };
      grid.append(col('Best value', ranked.slice(0, n)), col('Worst value', ranked.slice(-n).reverse()));
      const per10k = rows.filter((r) => r.per_10k != null);
      const foot = el('p', 'note');
      if (per10k.length) foot.textContent = `On average you paid ${money(d3.mean(per10k, (r) => r.per_10k))} per 10,000 words (about 40 pages) for the books you bought.`;
      box.replaceChildren(grid, foot);
    },
  });

  card({
    id: 'money-rereads', title: 'Re-reads make books cheaper', calc: 'money_books', wide: false,
    note: 'Paid books you\'ve read more than once: cost per hour after the first read, and now.',
    hidden: () => !hasPrices() || !(data('money_books') || []).some((r) => r.times_read > 1 && r.first_per_hour != null),
    draw(box, rows) {
      const list = rows.filter((r) => r.times_read > 1 && r.first_per_hour != null && r.per_hour != null).sort((a, b) => b.first_per_hour - b.per_hour - (a.first_per_hour - a.per_hour));
      box.replaceChildren(bookRows(list, (r) => `${perHour(r.first_per_hour)} → ${perHour(r.per_hour)}`));
    },
  });

  // ---------- BOO-43: leaderboards ----------
  let boardKind = 'author', boardSort = 'spent';
  card({
    id: 'money-board', title: 'Where the money went', calc: 'money_groups', wide: false,
    note: 'Top authors, genres, subgenres, series and books by what they cost you, or by cost per hour (paid books only, dearest first).',
    draw(box, groups, parts) {
      if (!parts.head.querySelector('select')) {
        const kind = el('select', 'rng-sel'), sort = el('select', 'rng-sel');
        kind.setAttribute('aria-label', 'Group by'); sort.setAttribute('aria-label', 'Sort by');
        [...Object.entries(GROUPS), ['book', 'Books']].forEach(([v, n]) => { const o = el('option', null, n); o.value = v; kind.append(o); });
        [['spent', 'Total spent'], ['per_hour', 'Cost per hour']].forEach(([v, n]) => { const o = el('option', null, n); o.value = v; sort.append(o); });
        kind.value = boardKind; sort.value = boardSort;
        kind.addEventListener('change', () => { boardKind = kind.value; rh.redraw(); });
        sort.addEventListener('change', () => { boardSort = sort.value; rh.redraw(); });
        const wrap = el('div', 'mn-pick'); wrap.append(kind, sort); parts.head.append(wrap);
      }
      const rows = boardKind === 'book'
        ? (data('money_books') || []).map((r) => ({ ...r, name: r.title, spent: r.price, books: 1 }))
        : groups.filter((g) => g.kind === boardKind);
      const val = boardSort === 'spent' ? (r) => r.spent : (r) => r.per_hour;
      const top = rows.filter((r) => val(r) != null && val(r) > 0).sort((a, b) => val(b) - val(a)).slice(0, 10);
      const chart = el('div', 'chart mn-chart');
      box.replaceChildren(chart);
      if (!top.length) { chart.append(el('p', 'note', 'Nothing to rank yet.')); return; }
      const kindOf = boardKind === 'book' ? 'book' : boardKind;
      moneyBars(chart, top, {
        label: (r) => r.name, value: val, text: (r) => (boardSort === 'spent' ? money(r.spent) : perHour(r.per_hour)),
        color: (r) => (boardKind === 'genre' ? rh.gColor(r.name) : rh.C[0]),
        linkTo: (r) => (r.opened === false ? [null, null] : [kindOf, kindOf === 'book' ? r.book_id : r.name]),
        tip: (t, r) => rh.tipLines(t, r.name, [[null, 'Spent', money(r.spent)], [null, 'Books', fmt(r.books)], [null, 'Hours', fmt(Math.round(r.hours))], [null, 'Per hour', perHour(r.per_hour)]]),
      });
    },
  });

  card({
    id: 'money-series', title: 'Cost to finish a series', calc: 'money_series', wide: false,
    note: 'Spent on each series so far, and a rough cost to fill the gaps: missing numbers up to the highest one you have, at your average price for that series. Volumes beyond that aren\'t known, so this is a floor, not a forecast.',
    draw(box, rows) {
      const list = rows.filter((r) => r.spent > 0).sort((a, b) => b.to_buy - a.to_buy || b.spent - a.spent).slice(0, 8);
      const ul = el('ul', 'rh-list mn-list');
      list.forEach((r) => {
        const li = el('li'), ttl = el('div', 'ttl');
        ttl.append(rh.ref(r, 'series'), el('small', null, `${r.finished} of ${plural(r.books, 'book')} finished · ${money(r.avg_price)} a book`));
        const to = r.missing ? `+ about ${money(r.to_buy)} for ${plural(r.missing, 'missing book')}` : 'no gaps';
        li.append(ttl, el('div', 'meta', `${money(r.spent)} · ${to}`));
        ul.append(li);
      });
      box.replaceChildren(ul);
    },
  });

  // ---------- BOO-44: is a subscription worth it? ----------
  // For each month a subscription ran: its fee, the hours read in its books that month, and
  // what buying the books first opened that month would have cost (their list prices).
  dash.calc('money_subscriptions', {
    inputs: ['money_books', 'daily', 'prices', 'as_of'],
    title: 'Subscriptions month by month',
    description: 'For each month a subscription ran: the fee, hours read in books from it, cost per hour, and what the books first opened that month would have cost to buy (their list price).',
    fn: (rows, daily, prices, asOf) => {
      const p = pricesOf(prices);
      if (!p || !p.subscriptions.length) return [];
      const today = ((asOf[0] && asOf[0].date) || new Date().toISOString()).slice(0, 7);
      const out = [];
      p.subscriptions.forEach((s) => {
        const end = s.end && s.end < today ? s.end : today;
        const months = monthsBetween(s.start, end);
        if (!months.length) return;
        // books from this subscription; with only one subscription, unnamed ones are its
        const mine = new Map(rows.filter((r) => r.acquisition === 'subscription' && (r.subscription === s.name || (!r.subscription && p.subscriptions.length === 1))).map((r) => [r.book_id, r]));
        const by = new Map(months.map((m) => [m, { subscription: s.name, month: m, fee: s.monthly_fee, minutes: 0, list_value: 0, books: [], unpriced: 0 }]));
        const first = new Map();
        daily.forEach((d) => {
          if (!mine.has(d.book_id)) return;
          const r = by.get(d.date.slice(0, 7));
          if (!r) return; // read outside the subscription
          r.minutes += d.minutes || 0;
          if (!first.has(d.book_id) || d.date < first.get(d.book_id)) first.set(d.book_id, d.date);
        });
        first.forEach((date, id) => {
          const r = by.get(date.slice(0, 7)), b = mine.get(id);
          r.books.push(b.title);
          if (b.list_price) r.list_value = round2(r.list_value + b.list_price); else r.unpriced++;
        });
        by.forEach((r) => {
          const hours = Math.round((r.minutes / 60) * 10) / 10;
          out.push({ ...r, hours, per_hour: hours >= MIN_HOURS ? round2(r.fee / hours) : null, paid_off: r.list_value >= r.fee });
        });
      });
      return out;
    },
  });

  let subPick = null;
  card({
    id: 'money-subs', title: 'Is your subscription worth it?', calc: 'money_subscriptions',
    note: 'Each month a subscription ran: its fee against what the books you started that month would have cost to buy (the list price you gave them in Admin → Prices). Months where buying would have cost more paid off.',
    hidden: () => !hasPrices() || !(data('money_subscriptions') || []).length,
    draw(box, rows, parts) {
      const names = [...new Set(rows.map((r) => r.subscription))];
      if (!names.includes(subPick)) subPick = names[0];
      let sel = parts.head.querySelector('select');
      if (names.length > 1 && !sel) {
        sel = el('select', 'rng-sel'); sel.setAttribute('aria-label', 'Subscription');
        sel.addEventListener('change', () => { subPick = sel.value; rh.redraw(); });
        parts.head.append(sel);
      }
      if (sel) { sel.replaceChildren(...names.map((n) => { const o = el('option', null, n); o.value = n; return o; })); sel.value = subPick; }
      const mine = rows.filter((r) => r.subscription === subPick);
      const fees = round2(d3.sum(mine, (r) => r.fee)), value = round2(d3.sum(mine, (r) => r.list_value)), hours = d3.sum(mine, (r) => r.hours);
      const books = d3.sum(mine, (r) => r.books.length), unpriced = d3.sum(mine, (r) => r.unpriced), won = mine.filter((r) => r.paid_off).length;
      const k = el('div', 'rh-kpis');
      k.append(
        kpi('Fees paid', money(fees), `${plural(mine.length, 'month')} of ${subPick}`),
        kpi('Buying would have cost', money(value), `${plural(books, 'book')} started${unpriced ? `, ${fmt(unpriced)} with no list price` : ''}`),
        kpi('Per hour read', perHour(hours ? round2(fees / hours) : null), `${fmt(Math.round(hours))} hours in its books`),
        kpi('Months it paid off', `${fmt(won)} of ${fmt(mine.length)}`, null),
      );
      const take = el('p', 'mn-take');
      take.append(el('b', null, subPick), value >= fees ? ` saved you about ${money(value - fees)} on buying the same books.` : ` cost ${money(fees - value)} more than buying the same books would have.`);
      const C = rh.C;
      const chart = el('div', 'chart mn-chart');
      box.replaceChildren(k, take, swatchLegend([['var(--cds-chart-muted)', 'Fee'], [C[0], 'Would have cost to buy']]), chart);
      const h = 220, { svg, w, tip } = rh.svgIn(chart, h), m = { t: 10, r: 6, b: 24, l: 44 };
      const x = d3.scaleBand(mine.map((r) => r.month), [m.l, w - m.r]).padding(0.25);
      const y = d3.scaleLinear([0, d3.max(mine, (r) => Math.max(r.fee, r.list_value)) || 1], [h - m.b, m.t]).nice();
      rh.axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4).tickFormat((v) => money(v, 0)).tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      const every = Math.ceil(mine.length / Math.max(1, Math.floor((w - m.l) / 52)));
      rh.axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(mine.filter((_, i) => i % every === 0).map((r) => r.month)).tickFormat((s) => d3.utcFormat('%b %y')(pDate(s + '-01'))).tickSize(0).tickPadding(8));
      const bw = Math.min(rh.MARK.bar, (x.bandwidth() - rh.MARK.gap) / 2);
      const g = svg.append('g').selectAll('g').data(mine).join('g').attr('transform', (d) => `translate(${x(d.month) + x.bandwidth() / 2},0)`);
      g.append('path').call(rh.grow, 'd', () => rh.barPath(-bw - rh.MARK.gap / 2, y(0), bw, 0), (d) => rh.barPath(-bw - rh.MARK.gap / 2, y(d.fee), bw, y(0) - y(d.fee))).attr('fill', 'var(--cds-chart-muted)');
      g.filter((d) => d.list_value > 0).append('path').call(rh.grow, 'd', () => rh.barPath(rh.MARK.gap / 2, y(0), bw, 0), (d) => rh.barPath(rh.MARK.gap / 2, y(d.list_value), bw, y(0) - y(d.list_value))).attr('fill', C[0]);
      g.append('rect').attr('class', 'hit').attr('x', -x.step() / 2).attr('width', x.step()).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
        .on('mousemove', (e, d) => rh.showTip(tip, chart, e, (t) => {
          rh.tipLines(t, fMonth(pDate(d.month + '-01')), [['var(--cds-chart-muted)', 'Fee', money(d.fee)], [C[0], 'Would have cost', money(d.list_value)], [null, 'Hours read', fmt(d.hours)], [null, 'Per hour', perHour(d.per_hour)], [null, '', d.paid_off ? 'Paid off' : 'Buying was cheaper']]);
          if (d.books.length) t.append('div').attr('class', 'mn-tip-books').text('Started: ' + d.books.join(', '));
        }))
        .on('mouseleave', () => rh.hideTip(tip));
    },
  });

  // ---------- BOO-45: money left on the shelf ----------
  const BUCKETS = [[0, 10, 'Under 10%'], [10, 25, '10–25%'], [25, 50, '25–50%'], [50, 75, '50–75%'], [75, 95, '75–95%']];
  const SHELF_DAYS = 60; // not opened for this long counts as given up (as "Left unfinished" does)
  dash.calc('money_shelf', {
    inputs: ['money_books', 'as_of'],
    title: 'Money left on the shelf',
    description: 'Priced books you gave up on (not finished and not opened for 60+ days) or never opened, with how far you got and the unread part of what each cost (price × the share not read).',
    fn: (rows, asOf) => {
      const end = Date.parse(((asOf[0] && asOf[0].date) || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
      return rows.flatMap((r) => {
        let state = null;
        if (!r.opened || r.status === 'not_started' || !r.progress) state = 'unopened';
        else if (r.status !== 'finished' && r.progress < 95 && r.last_read && end - Date.parse(r.last_read + 'T00:00:00Z') > SHELF_DAYS * 864e5) state = 'abandoned';
        if (!state) return [];
        const progress = state === 'unopened' ? 0 : r.progress;
        const bucket = state === 'unopened' ? null : (BUCKETS.find(([lo, hi]) => progress >= lo && progress < hi) || BUCKETS[BUCKETS.length - 1])[2];
        return [{ ...r, state, progress, bucket, unread_value: round2(r.price * (1 - progress / 100)) }];
      });
    },
  });

  const shelfCard = (o) => card({ hidden: () => !hasPrices() || !(data('money_shelf') || []).some((r) => r.price > 0), ...o });
  shelfCard({
    id: 'money-shelf', title: 'Money left on the shelf', calc: 'money_shelf',
    note: `Paid books you gave up on (not finished and not opened for ${SHELF_DAYS} days or more) and books you bought but never opened. The unread part is each price times the share of the book you didn't read.`,
    draw(box, rows) {
      const paid = rows.filter((r) => r.price > 0);
      const gaveUp = paid.filter((r) => r.state === 'abandoned'), pile = paid.filter((r) => r.state === 'unopened');
      const k = el('div', 'rh-kpis');
      k.append(
        kpi('Spent on books you gave up', money(d3.sum(gaveUp, (r) => r.price)), plural(gaveUp.length, 'book')),
        kpi('Your unread pile', money(d3.sum(pile, (r) => r.price)), `${plural(pile.length, 'book')} bought, never opened`),
        kpi('The unread part', money(d3.sum(paid, (r) => r.unread_value)), 'what the pages you never read cost'),
      );
      const top = paid.slice().sort((a, b) => b.unread_value - a.unread_value).slice(0, 6);
      const ttl = el('h3', 'mn-h3', 'Dearest left unread');
      box.replaceChildren(k, ttl, bookRows(top, (r) => `${r.state === 'unopened' ? 'never opened' : `${Math.round(r.progress)}% read`} · ${money(r.price)}`));
    },
  });

  shelfCard({
    id: 'money-shelf-progress', title: 'How far you got', calc: 'money_shelf', wide: false,
    note: 'What books you gave up on cost, by how far into them you got.',
    draw(box, rows) {
      const gave = rows.filter((r) => r.state === 'abandoned' && r.price > 0);
      const by = BUCKETS.map(([, , label]) => ({ label, books: gave.filter((r) => r.bucket === label) })).map((b) => ({ ...b, spent: round2(d3.sum(b.books, (r) => r.price)) }));
      const chart = el('div', 'chart mn-chart');
      box.replaceChildren(chart);
      moneyBars(chart, by, {
        label: (r) => r.label, value: (r) => r.spent,
        text: (r) => (r.books.length ? `${money(r.spent)} · ${plural(r.books.length, 'book')}` : '—'),
        tip: (t, r) => rh.tipLines(t, r.label, [[null, 'Spent', money(r.spent)], ...r.books.map((b) => [null, b.title, money(b.price)])]),
      });
    },
  });

  shelfCard({
    id: 'money-shelf-genre', title: 'Given up, by genre', calc: 'money_shelf', wide: false,
    note: 'What books you gave up on cost, by genre, and the unread part of it.',
    draw(box, rows) {
      const gave = rows.filter((r) => r.state === 'abandoned' && r.price > 0);
      const genres = [...new Set(gave.map((r) => r.genre))].map((genre) => {
        const mine = gave.filter((r) => r.genre === genre);
        return { genre, spent: round2(d3.sum(mine, (r) => r.price)), unread: round2(d3.sum(mine, (r) => r.unread_value)), n: mine.length };
      }).sort((a, b) => b.spent - a.spent);
      const chart = el('div', 'chart mn-chart');
      box.replaceChildren(chart);
      if (!genres.length) { chart.append(el('p', 'note', 'You haven\'t given up on any paid books.')); return; }
      moneyBars(chart, genres, {
        label: (r) => r.genre, value: (r) => r.spent, color: (r) => rh.gColor(r.genre), linkTo: (r) => ['genre', r.genre],
        tip: (t, r) => rh.tipLines(t, r.genre, [[null, 'Spent', money(r.spent)], [null, 'Unread part', money(r.unread)], [null, 'Books', fmt(r.n)]]),
      });
    },
  });

  // ---------- money on the author, series, genre, subgenre and year pages ----------
  function pageCard(root, title, note, kpis, extra) {
    const c = el('div', 'rh-card wide mn-page'), k = el('div', 'rh-kpis');
    k.append(...kpis.filter(Boolean));
    c.append(el('h2', null, title), el('p', 'note', note), k);
    if (extra) c.append(extra);
    root.append(c);
  }
  function groupPage(field) {
    return (name, root) => {
      const rows = (data('money_books') || []).filter((r) => r[field] === name);
      if (!rows.length) return;
      const g = (data('money_groups') || []).find((x) => x.kind === field && x.name === name);
      const all = data('money_groups') || [], peers = all.filter((x) => x.kind === field && x.spent > 0).sort((a, b) => b.spent - a.spent);
      const rank = peers.findIndex((x) => x.name === name);
      const kp = [
        kpi('Spent', money(g.spent), rank >= 0 && peers.length > 1 ? `#${rank + 1} of ${peers.length} ${GROUPS[field].toLowerCase()} by spend` : null),
        kpi('Books with a price', fmt(rows.length), `${fmt(rows.filter((r) => r.price === 0).length)} free`),
        kpi('Cost per hour', perHour(g.per_hour), `${fmt(Math.round(g.hours))} hours read`),
        g.dearest && g.dearest.price > 0 ? kpi('Dearest', money(g.dearest.price), g.dearest.title) : null,
      ];
      let extra = null;
      if (field === 'series') {
        const s = (data('money_series') || []).find((x) => x.series === name);
        if (s) kp.push(kpi('To finish', s.missing ? `≈ ${money(s.to_buy)}` : 'Nothing to buy', s.missing ? `${plural(s.missing, 'missing book')} at ${money(s.avg_price)}` : s.unfinished_spent ? `${money(s.unfinished_spent)} paid for, still unfinished` : 'every number up to the last one you have'));
      }
      pageCard(root, 'Money', `What the books ${field === 'author' ? 'by ' + name : 'here'} cost you, from Admin → Prices.`, kp, extra);
    };
  }
  ['author', 'series', 'genre', 'subgenre'].forEach((f) => rh.extend(f, groupPage(f)));
  rh.extend('year', (id, root) => {
    const y = (data('money_years') || []).find((r) => String(r.year) === String(id));
    if (!y) return;
    const read = (data('money_books') || []).filter((r) => r.date && r.date.startsWith(String(id)));
    const dear = read.slice().sort((a, b) => b.price - a.price)[0];
    pageCard(root, 'Money', `What you spent in ${id}: books bought that year and subscription fees.`, [
      kpi('Spent', money(y.total), y.subscriptions ? `${money(y.books)} on books, ${money(y.subscriptions)} on subscriptions` : null),
      kpi('Books bought', fmt(y.n_books), read.length - y.n_books > 0 ? `and ${fmt(read.length - y.n_books)} got for nothing` : null),
      y.budget ? kpi('Budget', money(y.budget), y.total <= y.budget ? `${money(y.budget - y.total)} left` : `${money(y.total - y.budget)} over`) : null,
      dear && dear.price > 0 ? kpi('Dearest', money(dear.price), dear.title) : null,
    ]);
  });
})();
