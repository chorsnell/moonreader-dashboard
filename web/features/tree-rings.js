// Tree rings: one ring per year, one spoke per day, length = minutes read.
(() => {
  const { fmt, pDate, fDay, gColor, showTip, hideTip, tipLines, legend, linkPage, mins } = rh;
  const TAU = Math.PI * 2;

  dash.calc('tree_rings', {
    inputs: ['daily'],
    title: 'Tree rings',
    description: 'Minutes read on each day, the books read and the genre read most that day.',
    fn: (daily) => {
      const m = new Map();
      daily.forEach((d) => {
        if (!(d.minutes > 0)) return;
        let r = m.get(d.date);
        if (!r) m.set(d.date, (r = { date: d.date, year: +d.date.slice(0, 4), minutes: 0, books: [] }));
        r.minutes += d.minutes;
        r.books.push({ book_id: d.book_id, title: d.title, genre: d.genre, minutes: d.minutes });
      });
      return [...m.values()]
        .map((r) => {
          r.books.sort((a, b) => b.minutes - a.minutes);
          return { ...r, minutes: Math.round(r.minutes), genre: r.books[0].genre };
        })
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  });

  rh.card({
    tab: 'timeline',
    id: 'tree-rings',
    title: 'Tree rings',
    note: 'One ring per year, growing outward from your first year like a tree trunk. Each spoke is a day: the longer it is, the more you read, coloured by the genre you read most that day. Busy years make thick, solid rings; slumps leave them thin and patchy.',
    calc: 'tree_rings',
    after: 'card-heat',
    chartClass: 'tr-wrap',
    draw(box, rows) {
      box.replaceChildren();
      if (!rows.length) { box.append(rh.el('div', 'fail', 'No reading days yet')); return; }
      const plot = rh.el('div', 'tr-plot'), side = rh.el('div', 'tr-side');
      box.append(plot, side);
      draw(plot, rows);
      drawSide(side, rows);
    },
  });

  const doy = (d) => d3.utcDay.count(d3.utcYear(d), d);
  const daysIn = (y) => d3.utcDay.count(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1)));

  function draw(plot, rows) {
    const years = d3.range(rows[0].year, rows[rows.length - 1].year + 1), n = years.length;
    const S = Math.min(640, Math.max(280, plot.clientWidth)), phone = S < 420;
    const out = phone ? 16 : 24, R = S / 2 - out, r0 = R * (n > 6 ? 0.14 : 0.22);
    const band = (R - r0) / n, padR = Math.min(2, band * 0.08);
    const GAP = phone ? 0.2 : 0.16;
    const ang = (y, i) => GAP / 2 + ((i + 0.5) / daysIn(y)) * (TAU - GAP);
    const top = d3.quantile(rows.map((r) => r.minutes).sort(d3.ascending), 0.99) || 1;
    const len = (m) => Math.max(1.2, (band - 2 * padR) * Math.sqrt(Math.min(1, m / top)));
    const ringIn = (y) => r0 + years.indexOf(y) * band + padR;

    const svg = d3.select(plot).append('svg').attr('class', 'tr').attr('viewBox', `${-S / 2} ${-S / 2} ${S} ${S}`).attr('width', '100%').attr('height', S).style('max-width', S + 'px');
    const tip = d3.select(plot).append('div').attr('class', 'tip');

    // the trunk: alternating ring bands and a line at each year; this year's ring has only
    // grown as far as the latest day
    const last = rows[rows.length - 1].date, lastY = +last.slice(0, 4);
    const grown = ang(lastY, doy(pDate(last))) + (TAU - GAP) / daysIn(lastY) / 2;
    svg.append('g').selectAll('path').data(years).join('path')
      .attr('class', (y, i) => 'tr-band' + (i % 2 ? ' odd' : ''))
      .attr('d', (y) => d3.arc()({ innerRadius: ringIn(y) - padR, outerRadius: ringIn(y) - padR + band, startAngle: 0, endAngle: y === lastY ? grown : TAU }));
    svg.append('g').selectAll('circle').data(years).join('circle').attr('class', 'tr-ring').attr('r', (y) => ringIn(y) - padR);

    // months: a faint guide and a label round the outside
    const months = d3.range(12);
    const mAng = (m) => { const y = 2001, d = new Date(Date.UTC(y, m, 1)); return GAP / 2 + (doy(d) / daysIn(y)) * (TAU - GAP); };
    const pt = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];
    svg.append('g').selectAll('line').data(months).join('line').attr('class', 'tr-guide')
      .attr('x1', (m) => pt(mAng(m), r0)[0]).attr('y1', (m) => pt(mAng(m), r0)[1])
      .attr('x2', (m) => pt(mAng(m), R)[0]).attr('y2', (m) => pt(mAng(m), R)[1]);
    const mName = (m) => d3.utcFormat('%b')(new Date(Date.UTC(2001, m, 1)));
    svg.append('g').selectAll('text').data(months).join('text').attr('class', 'tr-month')
      .attr('transform', (m) => { const [x, y] = pt(mAng(m) + (TAU - GAP) / 24, R + out * 0.55); return `translate(${x},${y})`; })
      .attr('dy', '0.35em').text((m) => (phone ? mName(m).slice(0, 1) : mName(m)));

    // the days
    const wedge = d3.arc();
    svg.append('g').selectAll('path').data(rows).join('path').attr('class', 'tr-day')
      .attr('fill', (d) => gColor(d.genre))
      .attr('d', (d) => {
        const dt = pDate(d.date), a = ang(d.year, doy(dt)), half = ((TAU - GAP) / daysIn(d.year)) * 0.42, ri = ringIn(d.year);
        return wedge({ innerRadius: ri, outerRadius: ri + len(d.minutes), startAngle: a - half, endAngle: a + half });
      });

    // year labels in the gap at the top
    const fs = Math.max(8, Math.min(11, band * 0.36));
    svg.append('g').selectAll('text').data(years).join('text').attr('class', 'tr-year').attr('font-size', fs)
      .attr('transform', (y) => `translate(0,${-(ringIn(y) - padR + band / 2)}) rotate(-90)`).attr('dy', '0.35em')
      .each(function (y) { linkPage(this, 'year', y); })
      .text((y) => (band < 30 ? "'" + String(y).slice(2) : y));

    // centre: total hours
    const hours = Math.round(d3.sum(rows, (r) => r.minutes) / 60);
    const c = svg.append('g').attr('class', 'tr-centre');
    c.append('text').attr('class', 'tr-total').attr('font-size', Math.min(26, r0 * 0.5)).attr('dy', '0.1em').text(fmt(hours));
    c.append('text').attr('class', 'tr-unit').attr('dy', Math.min(26, r0 * 0.5) * 0.9 + 'px').text('hours');

    // hover: find the day under the pointer from its angle and radius
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const hl = svg.append('path').attr('class', 'tr-hl');
    const at = (e) => {
      const [x, y] = d3.pointer(e, svg.node()), r = Math.hypot(x, y);
      let a = Math.atan2(x, -y); if (a < 0) a += TAU;
      const yi = Math.floor((r - r0) / band);
      if (yi < 0 || yi >= n || a < GAP / 2 || a > TAU - GAP / 2) return null;
      const yr = years[yi], i = Math.min(daysIn(yr) - 1, Math.floor(((a - GAP / 2) / (TAU - GAP)) * daysIn(yr)));
      const date = rh.iso(d3.utcDay.offset(new Date(Date.UTC(yr, 0, 1)), i));
      return { yr, i, date, row: byDate.get(date) };
    };
    svg.on('mousemove', (e) => {
      const p = at(e);
      if (!p) { hl.attr('d', null); hideTip(tip); return; }
      const half = ((TAU - GAP) / daysIn(p.yr)) * 0.5, a = ang(p.yr, p.i), ri = ringIn(p.yr);
      hl.attr('d', wedge({ innerRadius: ri - padR, outerRadius: ri - padR + band, startAngle: a - half, endAngle: a + half }));
      svg.style('cursor', p.row ? 'pointer' : null);
      showTip(tip, plot, e, (t) => {
        if (!p.row) { tipLines(t, fDay(pDate(p.date)), [[null, '', 'No reading']]); return; }
        tipLines(t, `${fDay(pDate(p.date))} · ${mins(p.row.minutes)}`, p.row.books.slice(0, 5).map((b) => [gColor(b.genre), b.title, mins(b.minutes)]));
        if (p.row.books.length > 5) t.append('div').attr('class', 't').text(`and ${p.row.books.length - 5} more`);
      });
    }).on('mouseleave', () => { hl.attr('d', null); hideTip(tip); })
      .on('click', (e) => { const p = at(e); if (p && p.row) { hideTip(tip); rh.openDiary(p.date); } });
  }

  function drawSide(side, rows) {
    const genres = rh.genres().filter((g) => rows.some((r) => r.genre === g));
    const leg = rh.el('div', 'legend tr-legend');
    legend(leg, genres.map((g) => [gColor(g), g]), 'genre');
    const list = rh.el('ul', 'tr-years');
    const per = d3.rollups(rows, (v) => ({ hours: d3.sum(v, (r) => r.minutes) / 60, days: v.length, best: d3.greatest(v, (r) => r.minutes) }), (r) => r.year).sort((a, b) => b[0] - a[0]);
    const most = d3.max(per, ([, s]) => s.hours) || 1;
    per.forEach(([y, s]) => {
      const li = rh.el('li');
      const yr = linkPage(rh.el('span', 'tr-y lk', String(y)), 'year', y);
      const bar = rh.el('span', 'tr-bar'), fill = rh.el('i');
      fill.style.width = (s.hours / most) * 100 + '%'; bar.append(fill);
      const meta = rh.el('span', 'tr-meta', `${fmt(Math.round(s.hours))} h · ${s.days} days`);
      const best = rh.el('small', null, `Biggest day ${fDay(pDate(s.best.date))}, ${mins(s.best.minutes)}`);
      li.append(yr, meta, bar, best);
      list.append(li);
    });
    side.append(leg, list);
  }
})();
