// The finishing sprint: how fast you get through each tenth of a book, against your usual
// pace for that book, by genre. Do you sag in the middle and sprint the last 20%?
(() => {
  const { el, fmt, gColor, svgIn, axis, showTip, hideTip, tipLines, legend } = rh;
  const STEPS = 10, MIN_DAYS = 5, MIN_READS = 3;

  dash.calc('finishing_sprint', {
    inputs: ['reads', 'daily'], title: 'The finishing sprint',
    description: 'For finished reads opened on 5+ days: the share of reading days spent in each tenth of the book, as a pace against that read\'s average (1 = usual pace, 2 = twice as fast), for all books and per genre (3+ reads).',
    fn: (reads, daily) => {
      // readDays (calcs.js): each read's logged days, in date order
      const days = readDays(reads, daily), per = [];
      reads.filter((r) => r.finished === true).forEach((r) => {
        const ds = days.get(r.read_id).filter((d) => d.progress != null);
        if (ds.length < MIN_DAYS) return;
        // each day's share of each tenth: the part of that tenth it covered, spread evenly over the day
        const spent = Array(STEPS).fill(0);
        // the day you finish usually stops part way, so it counts as the part of a usual day it was
        const usual = d3.median(ds, (d) => d.minutes || 0) || 1;
        let prev = 0, total = 0;
        ds.forEach((d, j) => {
          const wt = j === ds.length - 1 && d.minutes ? Math.min(1, d.minutes / usual) : 1;
          total += wt;
          const p0 = Math.min(prev, d.progress), p1 = Math.min(100, Math.max(prev, d.progress));
          if (p1 - p0 < 0.01) spent[Math.min(STEPS - 1, Math.floor(p1 / (100 / STEPS)))] += wt;
          else for (let i = 0; i < STEPS; i++) {
            const lo = (i * 100) / STEPS, hi = lo + 100 / STEPS, o = Math.min(hi, p1) - Math.max(lo, p0);
            if (o > 0) spent[i] += (wt * o) / (p1 - p0);
          }
          prev = d.progress;
        });
        per.push({ genre: r.genre, share: spent.map((v) => v / total) });
      });
      const out = [];
      const add = (group, genre, v) => {
        if (v.length < (genre ? MIN_READS : 1)) return;
        for (let i = 0; i < STEPS; i++) {
          const share = d3.mean(v, (x) => x.share[i]);
          out.push({ key: `${group}|${i}`, group, genre, step: i, from: (i * 100) / STEPS, to: ((i + 1) * 100) / STEPS,
            share: Math.round(share * 1000) / 1000, pace: share ? Math.round((1 / STEPS / share) * 100) / 100 : null, reads: v.length });
        }
      };
      add('all', null, per);
      d3.groups(per, (x) => x.genre).sort((a, b) => b[1].length - a[1].length).forEach(([g, v]) => add('genre', g, v));
      return out;
    },
  });

  const fx = (v) => (v == null ? '—' : `${v.toFixed(2)}×`);
  rh.card({
    tab: 'speed', id: 'sprint', title: 'The finishing sprint', after: 'card-speed-books', calc: 'finishing_sprint',
    note: 'How fast you move through each tenth of a book, against your usual pace for that book: above 1× you got through it in fewer reading days than usual. Finished books opened on 5+ days; point at a genre to pick out its line.',
    draw(box, rows) {
      box.replaceChildren();
      const all = rows.filter((r) => r.group === 'all');
      if (!all.length) { box.style.minHeight = '80px'; box.append(el('div', 'dy-empty', 'Not enough finished books read over several days yet.')); return; }
      const genres = d3.groups(rows.filter((r) => r.group === 'genre'), (r) => r.genre);

      // the takeaway: the last fifth against the middle
      const avg = (from, to) => d3.mean(all.filter((r) => r.from >= from && r.to <= to), (r) => r.pace);
      const end = avg(80, 100), mid = avg(30, 70), low = all.slice(1, -1).reduce((a, r) => (r.pace < a.pace ? r : a));
      const take = el('p', 'sp-take');
      take.append(end > 1.1 ? `You sprint the last 20%: ${end.toFixed(1)}× your usual pace for the book.` : end < 0.9 ? `You slow down for the last 20%: ${end.toFixed(1)}× your usual pace.` : 'You keep an even pace to the end.');
      if (mid < 0.95) take.append(` The middle drags a little (${mid.toFixed(2)}× from 30–70%), slowest at ${low.from}–${low.to}%.`);
      take.append(` From ${fmt(all[0].reads)} books.`);
      box.append(take);

      const lg = el('div', 'legend');
      box.append(lg);
      const items = [['var(--color-fg)', 'All books'], ...genres.map(([g]) => [gColor(g), g])];
      legend(lg, items, 'genre');
      rh.link(lg.firstChild, 'genre', null); // 'All books' isn't a genre

      const plot = el('div', 'sp-plot');
      box.append(plot);
      const h = 280, m = { t: 18, r: 12, b: 28, l: 36 };
      const { svg, w, tip } = svgIn(plot, h);
      const x = d3.scaleLinear([0, 100], [m.l, w - m.r]);
      const ext = d3.extent(rows, (r) => r.pace);
      const y = d3.scaleLinear([Math.min(0.6, ext[0]), Math.max(1.6, ext[1])], [h - m.b, m.t]).nice();
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickFormat((v) => v + '×').tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(d3.range(0, 101, w < 500 ? 20 : 10)).tickFormat((v) => v + '%').tickSizeOuter(0));
      svg.append('text').attr('class', 'axl').attr('x', w - m.r).attr('y', h - m.b - 6).attr('text-anchor', 'end').text('how far into the book');
      svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(1)).attr('y2', y(1)).attr('stroke', 'var(--cds-chart-reference, var(--color-fg-muted))').attr('stroke-dasharray', '4 3');
      svg.append('text').attr('class', 'axl').attr('x', m.l + 4).attr('y', y(1) - 5).text('usual pace');
      // the last fifth, shaded
      svg.insert('rect', ':first-child').attr('x', x(80)).attr('width', x(100) - x(80)).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'var(--cds-chart-grid)').attr('opacity', 0.6);
      const mid_ = (r) => x((r.from + r.to) / 2);
      const line = d3.line(mid_, (r) => y(r.pace)).curve(d3.curveMonotoneX);
      const paths = genres.map(([g, v]) => svg.append('path').datum(v).attr('fill', 'none').attr('stroke', gColor(g)).attr('stroke-width', 1.5).attr('stroke-opacity', 0.6).attr('d', line));
      // point at a genre in the legend to pick out its line
      [...lg.children].slice(1).forEach((s, i) => {
        s.addEventListener('mouseenter', () => paths.forEach((p, j) => p.attr('stroke-opacity', j === i ? 1 : 0.12).attr('stroke-width', j === i ? 2.5 : 1.5)));
        s.addEventListener('mouseleave', () => paths.forEach((p) => p.attr('stroke-opacity', 0.6).attr('stroke-width', 1.5)));
      });
      svg.append('path').datum(all).attr('fill', 'none').attr('stroke', 'var(--color-fg)').attr('stroke-width', 2.5).attr('d', line);
      svg.append('g').selectAll('circle').data(all).join('circle').attr('cx', mid_).attr('cy', (r) => y(r.pace)).attr('r', 3.5).attr('fill', 'var(--color-fg)')
        .attr('stroke', 'var(--color-panel)').attr('stroke-width', 2);
      const hl = svg.append('line').attr('y1', m.t).attr('y2', h - m.b).attr('stroke', 'var(--cds-chart-axis)').style('display', 'none');
      svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
        .on('mousemove', (e) => {
          const i = Math.max(0, Math.min(STEPS - 1, Math.floor(x.invert(d3.pointer(e)[0]) / (100 / STEPS)))), a = all[i];
          hl.style('display', null).attr('x1', mid_(a)).attr('x2', mid_(a));
          showTip(tip, plot, e, (t) => tipLines(t, `${a.from}–${a.to}% of the book`, [['var(--color-fg)', 'All books', fx(a.pace)],
            ...genres.map(([g, v]) => [gColor(g), g, fx(v[i].pace)])]));
        })
        .on('mouseleave', () => { hl.style('display', 'none'); hideTip(tip); });
    },
  });
})();
