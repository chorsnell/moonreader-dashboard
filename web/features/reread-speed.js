// Re-read speed: words per minute on the first read of a book against each later read.
(() => {
  const { el, fmt, gColor, svgIn, showTip, hideTip, tipLines, links, pDate, fShort, mins } = rh;
  const MIN_MINUTES = 30; // a read needs this much timed reading to have a speed

  dash.calc('reread_speed', {
    inputs: ['reads', 'daily'], title: 'Re-read speed',
    description: 'Every read of a book read more than once, with its words per minute (30+ timed minutes; days under 40 or over 800 wpm left out) and how it compares with the first read.',
    fn: (reads, daily) => {
      const days = readDays(reads, daily);
      const ok = (d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800;
      const out = [];
      d3.groups(reads.filter((r) => r.times_read > 1), (r) => r.book_id).forEach(([, rs]) => {
        rs.sort((a, b) => a.read_no - b.read_no);
        const sp = rs.map((r) => { const v = days.get(r.read_id).filter(ok), m = d3.sum(v, (d) => d.minutes); return m >= MIN_MINUTES ? { wpm: d3.sum(v, (d) => d.words) / m, m } : null; });
        const first = sp[0];
        rs.forEach((r, i) => out.push({ read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre, read_no: r.read_no,
          start: r.start, end: r.end, finished: r.finished === true, minutes: sp[i] ? Math.round(sp[i].m) : null, wpm: sp[i] ? Math.round(sp[i].wpm) : null,
          vs_first: i && sp[i] && first ? Math.round((sp[i].wpm / first.wpm - 1) * 1000) / 1000 : null }));
      });
      return out;
    },
  });

  const vs = (v) => (Math.abs(v) < 0.005 ? 'same as the first read' : `${Math.round(Math.abs(v) * 100)}% ${v > 0 ? 'faster' : 'slower'}`);
  rh.card({
    tab: 'speed', id: 'reread-speed', title: 'Re-reads: faster the second time?', before: 'card-speed', calc: 'reread_speed', chartClass: 'rr-box',
    note: 'Words per minute on the first read of each book you’ve read more than once (hollow dot), and on each read after it (filled). Reads with under 30 minutes timed have no speed.',
    draw(box, rows) {
      box.replaceChildren();
      const books = d3.groups(rows, (r) => r.book_id).map(([id, rs]) => ({ id, rs, first: rs[0], later: rs.slice(1).filter((r) => r.wpm) }))
        .filter((b) => b.first.wpm && b.later.length);
      if (!books.length) {
        box.style.minHeight = '80px';
        box.append(el('div', 'dy-empty', rows.length ? 'No book read more than once has a timed first and later read yet.' : 'You haven’t re-read a book yet.'));
        return;
      }
      box.style.minHeight = '';
      const changes = books.flatMap((b) => b.later.map((r) => r.vs_first)), faster = changes.filter((v) => v > 0.005).length;
      const mean = d3.mean(changes);
      const take = el('p', 'rr-take');
      take.append(`Re-reads are ${Math.abs(mean) < 0.005 ? 'no faster than' : `${Math.round(Math.abs(mean) * 100)}% ${mean > 0 ? 'faster' : 'slower'} than`} first reads on average: ` +
        `${fmt(faster)} of ${fmt(changes.length)} re-read${changes.length === 1 ? ' was' : 's were'} faster.`);
      box.append(take);
      books.sort((a, b) => d3.max(b.later, (r) => r.vs_first) - d3.max(a.later, (r) => r.vs_first));

      const plot = el('div', 'rr-plot');
      box.append(plot);
      const rh_ = 30, m = { t: 22, r: 50, b: 8 }, h = m.t + books.length * rh_ + m.b;
      const { svg, w, tip } = svgIn(plot, h);
      const short = (s) => (s.length > 28 ? s.slice(0, 27) + '…' : s);
      const probe = svg.append('text').attr('class', 'axl');
      const lab = Math.min(w * 0.42, d3.max(books, (b) => (probe.text(short(b.first.title)), probe.node().getComputedTextLength())) + 12);
      probe.remove();
      const all = books.flatMap((b) => [b.first, ...b.later].map((r) => r.wpm));
      const x = d3.scaleLinear([d3.min(all) - 15, d3.max(all) + 15], [lab, w - m.r]).nice();
      svg.append('g').attr('transform', `translate(0,${m.t - 6})`).call((g) => {
        g.selectAll('text').data(x.ticks(w < 500 ? 3 : 6)).join('text').attr('class', 'axl').attr('x', (v) => x(v)).attr('text-anchor', 'middle').text((v) => v);
      });
      svg.append('g').selectAll('line').data(x.ticks(w < 500 ? 3 : 6)).join('line').attr('x1', (v) => x(v)).attr('x2', (v) => x(v)).attr('y1', m.t).attr('y2', h - m.b).attr('stroke', 'var(--cds-chart-grid)');
      svg.append('text').attr('class', 'axl').attr('x', w - m.r + 6).attr('y', m.t - 6).text('wpm');
      const g = svg.append('g').selectAll('g').data(books).join('g').attr('transform', (b, i) => `translate(0,${m.t + i * rh_ + rh_ / 2})`).call(links, 'book', (b) => b.id);
      g.append('text').attr('class', 'axl').attr('x', lab - 10).attr('dy', '0.35em').attr('text-anchor', 'end').text((b) => short(b.first.title));
      g.each(function (b) {
        const s = d3.select(this), c = gColor(b.first.genre), last = b.later[b.later.length - 1];
        s.append('line').attr('x1', x(b.first.wpm)).attr('x2', x(last.wpm)).attr('stroke', c).attr('stroke-width', 2).attr('stroke-opacity', 0.5);
        s.append('circle').attr('cx', x(b.first.wpm)).attr('r', 5).attr('fill', 'var(--color-panel)').attr('stroke', c).attr('stroke-width', 2);
        b.later.forEach((r) => s.append('circle').attr('cx', x(r.wpm)).attr('r', 5.5).attr('fill', c).attr('stroke', 'var(--color-panel)').attr('stroke-width', 1.5));
        const right = last.wpm >= b.first.wpm;
        s.append('text').attr('class', 'lbl-in').attr('x', x(right ? last.wpm : b.first.wpm) + 10).attr('dy', '0.35em')
          .text(`${last.vs_first > 0 ? '+' : last.vs_first < 0 ? '−' : ''}${Math.round(Math.abs(last.vs_first) * 100)}%`);
      });
      g.append('rect').attr('x', 0).attr('y', -rh_ / 2).attr('width', w).attr('height', rh_).attr('fill', 'transparent').style('cursor', 'pointer')
        .on('mousemove', (e, b) => showTip(tip, plot, e, (t) => tipLines(t, b.first.title, [[gColor(b.first.genre), '', b.first.genre],
          ...b.rs.map((r) => [null, `Read ${r.read_no} · ${fShort(pDate(r.start))}`, r.wpm ? `${r.wpm} wpm${r.vs_first != null ? ` (${vs(r.vs_first)})` : ''} · ${mins(r.minutes)}` : 'not timed'])])))
        .on('mouseleave', () => hideTip(tip));
    },
  });
})();
