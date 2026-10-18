// Streaming against books (BOO-98): what an hour of each streaming subscription cost (TV &
// film tab, data/media_money.json) next to what an hour of your books cost and the Money
// tab's benchmarks, all in the home currency. Named to load after tv.js and money.js, whose
// calcs it uses. Money is hidden from some viewers: then both files load empty and the card
// hides.
(() => {
  const { el, fmt } = rh;
  const round2 = (n) => Math.round(n * 100) / 100;
  const median = (xs) => {
    const s = xs.slice().sort((a, b) => a - b), n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
  };

  dash.calc('screen_vs_books', {
    inputs: ['tv_cost', 'money_books', 'money_summary', 'prices'],
    title: 'Streaming against books',
    description: 'Cost per hour of each streaming subscription (everything paid ÷ hours watched on it), of your paid books (the median book, and everything spent on books ÷ every hour read) and of the Money benchmarks, in the home currency. Subscriptions paid in another currency are left out.',
    fn: (tvCost, moneyBooks, summary, prices) => {
      const p = prices && !Array.isArray(prices) && Array.isArray(prices.books) ? prices : null;
      if (!p || !tvCost.length) return [];
      const home = p.currency || 'GBP';
      const rows = [];
      // streaming: each service over every year it was paid for, and its latest year
      const services = [...new Set(tvCost.map((r) => r.service))];
      let otherCurrency = 0;
      services.forEach((service) => {
        const years = tvCost.filter((r) => r.service === service && r.currency === home);
        otherCurrency += tvCost.filter((r) => r.service === service && r.currency !== home).length ? 1 : 0;
        if (!years.length) return;
        const cost = years.reduce((s, r) => s + r.cost, 0), hours = years.reduce((s, r) => s + r.hours, 0);
        const last = years.reduce((a, r) => (r.year > a.year ? r : a));
        rows.push({
          kind: 'streaming', name: service, per_hour: hours >= 0.1 ? round2(cost / hours) : null,
          cost: round2(cost), hours: Math.round(hours * 10) / 10, from: years[0].year, to: last.year,
          latest_year: last.year, latest_per_hour: last.per_hour,
        });
      });
      const paid = moneyBooks.filter((r) => r.price > 0 && r.per_hour != null);
      if (paid.length) rows.push({ kind: 'books', name: 'A paid book (median)', per_hour: round2(median(paid.map((r) => r.per_hour))), books: paid.length });
      const s = summary[0];
      if (s && s.per_hour_all != null && s.hours) rows.push({ kind: 'books_all', name: 'All your reading', per_hour: s.per_hour_all, cost: s.lifetime, hours: s.hours });
      (p.benchmarks || []).forEach((b) => { if (b && b.name && b.per_hour > 0) rows.push({ kind: 'benchmark', name: b.name, per_hour: b.per_hour }); });
      // both sides are needed for a comparison
      if (!rows.some((r) => r.kind === 'streaming' && r.per_hour != null) || !rows.some((r) => r.kind.startsWith('books'))) return [];
      rows.sort((a, b) => (a.per_hour ?? Infinity) - (b.per_hour ?? Infinity));
      return rows.map((r) => ({ ...r, currency: home, other_currency: otherCurrency }));
    },
  });

  const money = (v, cur) => { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v); } catch (e) { return `${v.toFixed(2)} ${cur}`; } };
  const perHour = (v, cur) => (v == null ? '—' : money(v, cur) + '/h');
  const COLOR = { streaming: () => rh.C[1], books: () => rh.C[0], books_all: () => rh.C[0], benchmark: () => 'var(--cds-chart-muted)' };
  const times = (a, b) => { const x = a / b; return x >= 1.95 ? `${fmt(Math.round(x * 10) / 10)}×` : null; };

  rh.card({
    tab: 'money', id: 'money-screen', title: 'Streaming against books', calc: 'screen_vs_books', after: 'card-money-value', wide: false,
    privacy: 'money', chartClass: 'mn-box',
    note: 'What an hour cost you: each streaming subscription (everything paid ÷ hours watched on it, from the TV & film tab), your books, and the rough benchmarks from Admin → Prices.',
    hidden: () => { const r = dash.data('screen_vs_books'); return r.status === 'ok' && !r.data.length; },
    draw(box, rows) {
      box.replaceChildren();
      if (!rows.length) return;
      const cur = rows[0].currency;
      const book = rows.find((r) => r.kind === 'books') || rows.find((r) => r.kind === 'books_all');
      const subs = rows.filter((r) => r.kind === 'streaming' && r.per_hour != null);
      // the verdict, for the dearest-watched subscription
      const head = el('p', 'mn-take');
      subs.slice(0, 2).forEach((s, i) => {
        if (i) head.append(' ');
        const x = s.per_hour > book.per_hour ? times(s.per_hour, book.per_hour) : times(book.per_hour, s.per_hour);
        head.append(`An hour of ${s.name} cost you `, el('b', null, perHour(s.per_hour, cur)),
          s.per_hour > book.per_hour ? `, ${x ? `${x} ` : 'more than '}an hour of ${book.kind === 'books' ? 'a paid book' : 'reading'} (${perHour(book.per_hour, cur)}).`
            : s.per_hour < book.per_hour ? `, ${x ? `a ${x} cheaper hour than ` : 'less than '}${book.kind === 'books' ? 'a paid book' : 'reading'} (${perHour(book.per_hour, cur)}).`
              : `, the same as an hour of ${book.kind === 'books' ? 'a paid book' : 'reading'}.`);
      });
      const leg = el('div', 'legend');
      [[rh.C[0], 'Books'], [rh.C[1], 'Streaming'], ['var(--cds-chart-muted)', 'Benchmark']].forEach(([c, n]) => {
        if (n === 'Benchmark' && !rows.some((r) => r.kind === 'benchmark')) return;
        const s = el('span'), i = el('i', 'sw'); i.style.background = c; s.append(i, n); leg.append(s);
      });
      const chart = el('div', 'chart mn-chart');
      box.append(head, leg, chart);
      // a benchmark far dearer than anything of yours would squash the bars that matter
      const ownMax = d3.max(rows.filter((r) => r.kind !== 'benchmark'), (r) => r.per_hour) || 0;
      const dropped = rows.filter((r) => r.kind === 'benchmark' && r.per_hour > ownMax * 2);
      const shown = rows.filter((r) => r.per_hour != null && !dropped.includes(r));
      const label = (r) => r.name, text = (r) => perHour(r.per_hour, cur);
      const bh = 22, gap = 6, h = shown.length * (bh + gap) + 4;
      const { svg, w, tip } = rh.svgIn(chart, h);
      const lw = Math.min(w * 0.45, rh.measure(svg, shown.map(label)) + 10), vw = rh.measure(svg, shown.map(text)) + 8;
      const x = d3.scaleLinear([0, d3.max(shown, (r) => r.per_hour) || 1], [0, Math.max(10, w - lw - vw)]);
      const g = svg.selectAll('g.r').data(shown).join('g').attr('class', 'r').attr('transform', (d, i) => `translate(0,${i * (bh + gap)})`);
      g.append('text').attr('class', 'axl').attr('x', lw - 8).attr('y', bh / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(label);
      g.append('path').attr('fill', (d) => COLOR[d.kind]())
        .call(rh.grow, 'd', () => rh.barPath(lw, 0, 0, Math.min(bh, rh.MARK.bar), 'right'), (d) => rh.barPath(lw, 0, Math.max(1, x(d.per_hour)), Math.min(bh, rh.MARK.bar), 'right'));
      g.append('text').attr('class', 'axl').attr('x', (d) => lw + Math.max(1, x(d.per_hour)) + 6).attr('y', bh / 2).attr('dy', '0.35em').text(text);
      g.append('rect').attr('class', 'hit').attr('width', w).attr('height', bh).attr('fill', 'transparent')
        .on('mousemove', (e, d) => rh.showTip(tip, chart, e, (t) => rh.tipLines(t, d.name, d.kind === 'streaming'
          ? [[null, 'Paid', money(d.cost, cur)], [null, 'Hours watched', fmt(d.hours)], [null, d.from === d.to ? String(d.from) : `${d.from}–${d.to}`, perHour(d.per_hour, cur)],
            ...(d.from !== d.to && d.latest_per_hour != null ? [[null, `In ${d.latest_year}`, perHour(d.latest_per_hour, cur)]] : [])]
          : d.kind === 'books' ? [[null, 'Per hour', perHour(d.per_hour, cur)], [null, 'Half your paid books cost less', `of ${fmt(d.books)}`]]
            : d.kind === 'books_all' ? [[null, 'Spent on books', money(d.cost, cur)], [null, 'Hours read', fmt(d.hours)], [null, 'Per hour', perHour(d.per_hour, cur)]]
              : [[null, 'A rough figure', perHour(d.per_hour, cur)]])))
        .on('mouseleave', () => rh.hideTip(tip));
      if (dropped.length) box.append(el('p', 'note', `Off the scale: ${dropped.map((r) => `${r.name.toLowerCase()} (${perHour(r.per_hour, cur)})`).join(', ')}.`));
      if (rows[0].other_currency) box.append(el('p', 'note', `${fmt(rows[0].other_currency)} subscription${rows[0].other_currency === 1 ? ' is' : 's are'} paid in another currency and left out.`));
    },
  });
})();
