// Ridgelines (joyplots): minutes per reading day by year, and words per minute by genre.
(() => {
  const { fmt, gColor, svgIn, showTip, hideTip, tipLines, linkPage, mins, okDay } = rh;

  dash.calc('ridge_wpm', {
    inputs: ['daily'],
    title: 'Speed by genre, day by day',
    description: 'Words per minute for each book on each day with believable timings, with its genre and minutes.',
    fn: (daily) => daily.filter(okDay).map((d) => ({ genre: d.genre, wpm: Math.round(d.words / d.minutes), minutes: d.minutes })),
  });

  rh.card({
    tab: 'timeline',
    id: 'ridge-minutes',
    title: 'How long you read, year by year',
    note: 'The spread of minutes on the days you read, one ridge per year. A tall narrow peak means a steady habit; a long tail to the right means big reading days. The line marks the median day.',
    calc: 'day_totals',
    after: 'card-gantt',
    draw(box, rows) {
      const days = rows.filter((r) => r.minutes >= 1);
      if (!days.length) { box.replaceChildren(rh.el('div', 'fail', 'No reading days yet')); return; }
      const years = d3.groups(days, (r) => +r.date.slice(0, 4)).sort((a, b) => a[0] - b[0]);
      const ramp = yearRamp(years.length);
      const top = Math.max(30, Math.ceil(d3.quantile(days.map((r) => r.minutes).sort(d3.ascending), 0.98) / 15) * 15);
      ridges(box, years.map(([y, rs], i) => ({ key: y, kind: 'year', label: String(y), color: ramp[i], values: rs.map((r) => ({ v: r.minutes, w: 1 })) })), {
        id: 'rm', max: top, bw: Math.max(3, top / 28), unit: (v) => mins(v), axis: (v) => (!v ? '0' : v < 60 ? v + ' min' : Math.floor(v / 60) + ' h' + (v % 60 ? ' ' + (v % 60) : '')), tick: 30, what: 'days', reflect: true,
      });
    },
  });

  rh.card({
    tab: 'speed',
    id: 'ridge-wpm',
    title: 'Speed by genre, day by day',
    note: 'The spread of your words per minute in each genre, weighted by time spent, slowest median at the top. A wide ridge means your pace swings a lot in that genre. Only days with believable timings count.',
    calc: 'ridge_wpm',
    after: 'card-speed',
    draw(box, rows) {
      if (!rows.length) { box.replaceChildren(rh.el('div', 'fail', 'Not enough timed reading yet')); return; }
      const sorted = rows.map((r) => r.wpm).sort(d3.ascending);
      const lo = Math.max(0, Math.floor(d3.quantile(sorted, 0.01) / 50) * 50), hi = Math.ceil(d3.quantile(sorted, 0.99) / 50) * 50;
      const groups = d3.groups(rows, (r) => r.genre).filter(([, rs]) => d3.sum(rs, (r) => r.minutes) >= 30)
        .map(([g, rs]) => ({ key: g, kind: 'genre', label: g, color: gColor(g), values: rs.map((r) => ({ v: r.wpm, w: r.minutes })) }))
        .sort((a, b) => wMedian(a.values) - wMedian(b.values));
      ridges(box, groups, { id: 'rw', min: lo, max: hi, bw: Math.max(8, (hi - lo) / 30), unit: (v) => fmt(Math.round(v)) + ' wpm', short: (v) => fmt(Math.round(v)), axis: (v) => fmt(v), what: 'minutes' });
    },
  });

  // a ramp across the years from one series colour to another, read from the theme
  function yearRamp(n) {
    const cs = getComputedStyle(document.documentElement), c = (v) => cs.getPropertyValue(v).trim() || '#888';
    const ip = d3.piecewise(d3.interpolateLab, [c('--series-3'), c('--series-1'), c('--series-5')]);
    return d3.range(n).map((i) => ip(n === 1 ? 0.5 : i / (n - 1)));
  }

  function wQuantile(vals, p) {
    const s = vals.slice().sort((a, b) => a.v - b.v), tot = d3.sum(s, (d) => d.w);
    let acc = 0;
    for (const d of s) { acc += d.w; if (acc >= tot * p) return d.v; }
    return s.length ? s[s.length - 1].v : 0;
  }
  const wMedian = (vals) => wQuantile(vals, 0.5);

  function kde(vals, grid, bw) {
    const tot = d3.sum(vals, (d) => d.w) || 1, k = 1 / (bw * Math.sqrt(2 * Math.PI) * tot);
    return grid.map((x) => {
      let s = 0;
      for (const d of vals) { const u = (x - d.v) / bw; if (u > -4 && u < 4) s += d.w * Math.exp(-0.5 * u * u); }
      return s * k;
    });
  }

  function ridges(box, groups, o) {
    const W = Math.max(280, box.clientWidth), phone = W < 520;
    const step = phone ? 30 : 38, rise = step * 2.1, n = groups.length;
    const lo = o.min || 0, grid = d3.range(121).map((i) => lo + ((o.max - lo) * i) / 120);
    groups.forEach((g) => {
      // mirror the values at the lower edge so the curve doesn't leak below it
      const mirror = o.reflect ? g.values.map((d) => ({ v: 2 * lo - d.v, w: d.w })) : [];
      g.dens = kde([...g.values, ...mirror], grid, o.bw).map((d) => d * (o.reflect ? 2 : 1));
      g.med = wMedian(g.values);
      g.mean = d3.sum(g.values, (d) => d.v * d.w) / (d3.sum(g.values, (d) => d.w) || 1);
      g.tot = d3.sum(g.values, (d) => d.w);
    });
    const peak = d3.max(groups, (g) => d3.max(g.dens)) || 1;
    const tmp = d3.select(box).append('svg');
    const lw = Math.min(phone ? 92 : 130, Math.ceil(rh.measure(tmp, groups.map((g) => g.label)))) + 10;
    tmp.remove();
    const rw = phone ? (o.short ? 40 : 54) : 74, m = { t: rise - step + 8, r: rw, b: 26, l: lw };
    const h = m.t + n * step + m.b;
    const { svg, w, tip } = svgIn(box, h);
    svg.attr('class', 'rg');
    const x = d3.scaleLinear([lo, o.max], [m.l, w - m.r]);
    const yv = (d) => (d / peak) * rise;
    const base = (i) => m.t + (i + 1) * step;

    // axis and faint gridlines
    const ticks = o.tick ? d3.range(lo, o.max + 1, o.tick) : x.ticks(phone ? 4 : 7);
    svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'rg-grid').attr('x1', x).attr('x2', x).attr('y1', m.t - rise + step).attr('y2', h - m.b);
    rh.axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(ticks).tickFormat(o.axis).tickSize(0).tickPadding(8));
    svg.select('.domain').remove();

    const defs = svg.append('defs');
    const area = d3.area().x((d, j) => x(grid[j])).y1((d) => -yv(d)).y0(0).curve(d3.curveBasis);
    const line = d3.line().x((d, j) => x(grid[j])).y((d) => -yv(d)).curve(d3.curveBasis);
    const rows = svg.append('g').selectAll('g').data(groups).join('g').attr('class', 'rg-row').attr('transform', (g, i) => `translate(0,${base(i)})`);
    rows.each(function (g, i) {
      const gr = defs.append('linearGradient').attr('id', `${o.id}-g${i}`).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
      gr.append('stop').attr('offset', 0).style('stop-color', g.color).style('stop-opacity', 0.9);
      gr.append('stop').attr('offset', 1).style('stop-color', g.color).style('stop-opacity', 0.35);
      const r = d3.select(this);
      r.append('path').attr('class', 'rg-area').attr('d', area(g.dens)).attr('fill', `url(#${o.id}-g${i})`);
      r.append('path').attr('class', 'rg-line').attr('d', line(g.dens)).attr('stroke', g.color);
      r.append('line').attr('class', 'rg-base').attr('x1', m.l).attr('x2', w - m.r);
      // median marker
      const j = Math.max(0, Math.min(grid.length - 1, Math.round(((g.med - lo) / (o.max - lo)) * 120)));
      const mx = x(Math.min(o.max, g.med));
      r.append('line').attr('class', 'rg-med').attr('x1', mx).attr('x2', mx).attr('y1', 0).attr('y2', -yv(g.dens[j]));
      r.append('circle').attr('class', 'rg-dot').attr('cx', mx).attr('cy', -yv(g.dens[j])).attr('r', 2.5);
      // label, linked to its page, and the median on the right
      const t = r.append('text').attr('class', 'rg-lbl').attr('x', m.l - 10).attr('y', -4).text(g.label);
      linkPage(t.node(), g.kind, g.key);
      r.append('text').attr('class', 'rg-medtxt').attr('x', w - m.r + 8).attr('y', -4).text(phone && o.short ? o.short(g.med) : o.unit(g.med));
    });
    svg.append('text').attr('class', 'rg-head').attr('x', w - m.r + 8).attr('y', m.t - rise + step + 2).text('median');

    // hover a row: highlight it and say what share sits near the pointer
    rows.append('rect').attr('class', 'rg-hit').attr('x', m.l).attr('width', w - m.l - m.r).attr('y', -step).attr('height', step)
      .on('mousemove', (e, g) => {
        const v = x.invert(d3.pointer(e, svg.node())[0]), half = (o.max - lo) / 24;
        const near = d3.sum(g.values.filter((d) => d.v >= v - half && d.v < v + half), (d) => d.w) / (g.tot || 1);
        d3.select(e.currentTarget.parentNode).classed('on', true);
        svg.classed('hov', true);
        showTip(tip, box, e, (t) => tipLines(t, g.label, [
          [g.color, 'Median', o.unit(g.med)], [null, 'Average', o.unit(g.mean)],
          [null, o.what === 'days' ? 'Reading days' : 'Time', o.what === 'days' ? fmt(g.tot) : mins(g.tot)],
          [null, `${o.unit(Math.max(lo, v - half))} – ${o.unit(v + half)}`, Math.round(near * 100) + '% of ' + o.what],
        ]));
      })
      .on('mouseleave', (e) => { d3.select(e.currentTarget.parentNode).classed('on', false); svg.classed('hov', false); hideTip(tip); });
  }
})();
