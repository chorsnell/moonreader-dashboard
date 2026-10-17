// Where you give up: the share of books that get past each point, overall and by genre.
(() => {
  const { el, fmt, gColor, svgIn, axis, showTip, hideTip, tipLines, legend, links, pDate, fShort } = rh;
  const MIN_READS = 3, STILL_READING = 60, MARKS = [10, 25, 50, 75, 90];

  dash.calc('survival', {
    inputs: ['reads', 'as_of'], title: 'Where you give up',
    description: 'First reads, finished or given up (not opened for 60+ days), and how far each got; with the share of them getting past each 1% of the book, overall and per genre (3+ reads). Books still on the go are left out.',
    fn: (reads, as_of) => {
      const today = Date.parse(as_of[0].date + 'T00:00:00Z');
      const out = [];
      reads.filter((r) => r.read_no === 1).forEach((r) => {
        const done = r.finished === true, idle = (today - Date.parse(r.end + 'T00:00:00Z')) / 864e5;
        if (!done && idle <= STILL_READING) return; // still on the go: we don't know yet
        out.push({ read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre,
          reached: done ? 100 : Math.max(0, Math.min(100, r.progress ?? 0)), finished: done, last: r.end });
      });
      return out.sort((a, b) => a.reached - b.reached);
    },
  });

  // share of reads reaching at least p, for p = 0..100
  const curve = (v) => d3.range(0, 101).map((p) => ({ p, s: v.filter((r) => r.reached >= p || r.finished).length / v.length }));
  const pc = (v) => `${Math.round(v * 100)}%`;

  rh.card({
    tab: 'library', id: 'survival', title: 'Where you give up', calc: 'survival',
    note: 'The share of books you start that get past each point. A steep drop is where books lose you. First reads only; books still on the go are left out. Ticks along the bottom are the books you gave up on.',
    draw(box, rows) {
      box.replaceChildren();
      if (rows.length < 2) { box.style.minHeight = '80px'; box.append(el('div', 'dy-empty', 'Not enough books started yet.')); return; }
      const all = curve(rows), quit = rows.filter((r) => !r.finished);
      const genres = d3.groups(rows, (r) => r.genre).filter(([, v]) => v.length >= MIN_READS).sort((a, b) => b[1].length - a[1].length)
        .map(([g, v]) => [g, v, curve(v)]);

      // headline: how many make it, and where most are lost
      const take = el('p', 'sv-take'), fin = rows.filter((r) => r.finished).length;
      take.append(`You finish ${pc(fin / rows.length)} of the books you start (${fmt(fin)} of ${fmt(rows.length)}).`);
      if (quit.length) {
        const band = d3.rollups(quit, (v) => v.length, (r) => (r.reached < 10 ? '0–10%' : r.reached < 25 ? '10–25%' : r.reached < 50 ? '25–50%' : '50–100%')).sort((a, b) => b[1] - a[1])[0];
        take.append(` Most you give up on go in the ${band[0]} stretch (${fmt(band[1])} of ${fmt(quit.length)}).`);
        const worst = genres.slice().sort((a, b) => a[2][100].s - b[2][100].s)[0];
        if (worst && worst[2][100].s < 1) take.append(' ', rh.ref({ genre: worst[0] }, 'genre'), ` loses you most: ${pc(1 - worst[2][100].s)} unfinished.`);
      }
      box.append(take);

      const lg = el('div', 'legend');
      box.append(lg);
      legend(lg, [['var(--color-fg)', 'All books'], ...genres.map(([g]) => [gColor(g), g])], 'genre');
      rh.link(lg.firstChild, 'genre', null); // 'All books' isn't a genre

      const plot = el('div', 'sv-plot');
      box.append(plot);
      const h = 300, m = { t: 22, r: 14, b: 44, l: 40 };
      const { svg, w, tip } = svgIn(plot, h);
      const x = d3.scaleLinear([0, 100], [m.l, w - m.r]), lo = d3.min([all, ...genres.map((g) => g[2])], (c) => c[100].s);
      // zoomed to the lowest curve, so small drops show; the axis says where it starts
      const y = d3.scaleLinear([Math.max(0, Math.floor((lo - 0.05) * 5) / 5), 1], [h - m.b - 26, m.t]);
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')).tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(w < 500 ? [0, 25, 50, 75, 100] : [0, ...MARKS, 100]).tickFormat((v) => v + '%').tickSizeOuter(0));
      svg.append('text').attr('class', 'axl').attr('x', w - m.r).attr('y', h - 4).attr('text-anchor', 'end').text('how far into the book');
      const line = d3.line((d) => x(d.p), (d) => y(d.s)).curve(d3.curveStepAfter);
      const paths = genres.map(([g, , c]) => svg.append('path').datum(c).attr('fill', 'none').attr('stroke', gColor(g)).attr('stroke-width', 1.5).attr('stroke-opacity', 0.6).attr('d', line));
      [...lg.children].slice(1).forEach((s, i) => {
        s.addEventListener('mouseenter', () => paths.forEach((p, j) => p.attr('stroke-opacity', j === i ? 1 : 0.12).attr('stroke-width', j === i ? 2.5 : 1.5)));
        s.addEventListener('mouseleave', () => paths.forEach((p) => p.attr('stroke-opacity', 0.6).attr('stroke-width', 1.5)));
      });
      svg.append('path').datum(all).attr('fill', 'none').attr('stroke', 'var(--color-fg)').attr('stroke-width', 2.5).attr('d', line);
      // the marks: share still going at 10%, 25%, 50%...
      const mk = svg.append('g').selectAll('g').data(MARKS).join('g').attr('transform', (p) => `translate(${x(p)},${y(all[p].s)})`);
      mk.append('circle').attr('r', 3.5).attr('fill', 'var(--color-fg)').attr('stroke', 'var(--color-panel)').attr('stroke-width', 2);
      mk.append('text').attr('class', 'lbl-in').attr('y', -8).attr('text-anchor', 'middle').text((p) => pc(all[p].s));

      // where each book you gave up on stopped
      const ry = h - m.b - 10;
      const rug = svg.append('g').selectAll('line').data(quit).join('line').attr('x1', (r) => x(r.reached)).attr('x2', (r) => x(r.reached))
        .attr('y1', ry - 6).attr('y2', ry + 6).attr('stroke', (r) => gColor(r.genre)).attr('stroke-width', 3).attr('stroke-linecap', 'round');
      svg.append('g').selectAll('rect').data(quit).join('rect').attr('x', (r) => x(r.reached) - 6).attr('y', ry - 9).attr('width', 12).attr('height', 18)
        .attr('fill', 'transparent').style('cursor', 'pointer').call(links, 'book', (r) => r.book_id)
        .on('mousemove', (e, r) => showTip(tip, plot, e, (t) => tipLines(t, r.title, [[gColor(r.genre), '', r.genre], [null, 'Gave up at', `${Math.round(r.reached)}%`], [null, 'Last opened', fShort(pDate(r.last))]])))
        .on('mouseleave', () => hideTip(tip));
      rug.lower();

      // hover the curve: the share still going at that point
      const hl = svg.append('line').attr('y1', m.t).attr('y2', h - m.b - 26).attr('stroke', 'var(--cds-chart-axis)').style('display', 'none');
      svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.b - 26 - m.t).attr('fill', 'transparent')
        .on('mousemove', (e) => {
          const p = Math.max(0, Math.min(100, Math.round(x.invert(d3.pointer(e)[0]))));
          hl.style('display', null).attr('x1', x(p)).attr('x2', x(p));
          showTip(tip, plot, e, (t) => tipLines(t, `Past ${p}% of the book`, [['var(--color-fg)', 'All books', `${pc(all[p].s)} of ${fmt(rows.length)}`],
            ...genres.map(([g, v, c]) => [gColor(g), g, `${pc(c[p].s)} of ${fmt(v.length)}`])]));
        })
        .on('mouseleave', () => { hl.style('display', 'none'); hideTip(tip); });
    },
  });
})();
