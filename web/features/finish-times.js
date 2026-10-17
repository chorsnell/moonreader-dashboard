// Length against time to finish: every finished read as a dot on log scales, coloured by
// genre, with a line for how long a book that length usually takes you and the reads
// furthest from it labelled.
(() => {
  const { el, fmt, gColor, svgIn, axis, showTip, hideTip, tipLines, legend, links, pDate, fDay, mins } = rh;
  const LABELS = 6;   // label at most this many outliers...
  const OUTLIER = 2;  // ...that took at least this many times longer or shorter than the line

  dash.calc('finish_times', {
    inputs: ['reads', 'daily', 'books'], title: 'Length against time to finish',
    description: 'Every finished read with the words logged during it (or the book\'s words for a single read with none logged), the days from start to finish, minutes and speed; and how many times longer or shorter it took than the log-log fit across all reads.',
    fn: (reads, daily, books) => {
      const days = readDays(reads, daily), meta = new Map(books.map((b) => [b.id, b]));
      const out = reads.filter((r) => r.finished === true).map((r) => {
        const ds = days.get(r.read_id), b = meta.get(r.book_id) || {};
        let words = d3.sum(ds, (d) => d.words || 0);
        if (!words && b.times_read === 1) words = b.words || 0;
        const span = Math.round((Date.parse(r.end) - Date.parse(r.start)) / 864e5) + 1;
        const ok = ds.filter((d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800), m = d3.sum(ok, (d) => d.minutes);
        return { read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre, read_no: r.read_no, start: r.start, end: r.end,
          words, days: span, days_read: r.days_read, minutes: Math.round(d3.sum(ds, (d) => d.minutes || 0)), wpm: m >= 30 ? Math.round(d3.sum(ok, (d) => d.words) / m) : null };
      }).filter((r) => r.words >= 1000);
      // least squares on log10(days) = a + b·log10(words)
      if (out.length >= 3) {
        const lx = out.map((r) => Math.log10(r.words)), ly = out.map((r) => Math.log10(r.days)), mx = d3.mean(lx), my = d3.mean(ly);
        const sxx = d3.sum(lx, (v) => (v - mx) ** 2), b = sxx ? d3.sum(lx, (v, i) => (v - mx) * (ly[i] - my)) / sxx : 0, a = my - b * mx;
        out.forEach((r, i) => { r.expected_days = Math.round(10 ** (a + b * lx[i]) * 10) / 10; r.vs_expected = Math.round((10 ** (ly[i] - a - b * lx[i])) * 100) / 100; r.fit_a = a; r.fit_b = b; });
      }
      return out.sort((x, y) => x.words - y.words);
    },
  });

  const times = (v) => (v >= 1 ? `${v.toFixed(1)}× longer` : `${(1 / v).toFixed(1)}× quicker`);
  rh.card({
    tab: 'speed', id: 'finish-times', title: 'Length against time to finish', after: 'card-speed-books', calc: 'finish_times',
    note: 'Every finished read: its words along the bottom and the days from start to finish up the side, both on log scales. The dashed line is how long a book that length usually takes you; labelled reads are furthest from it. Bigger dots took more hours.',
    draw(box, rows) {
      box.replaceChildren();
      if (rows.length < 3) { box.style.minHeight = '80px'; box.append(el('div', 'dy-empty', 'Not enough finished books with words logged yet.')); return; }
      const genres = [...new Set(rows.map((r) => r.genre))].sort((a, b) => (rh.genres().indexOf(a) + 1 || 99) - (rh.genres().indexOf(b) + 1 || 99));
      const slow = rows.filter((r) => r.vs_expected >= OUTLIER).length, fast = rows.filter((r) => r.vs_expected <= 1 / OUTLIER).length;
      const b = rows[0].fit_b;
      const take = el('p', 'ft-take');
      take.append(`Twice the length takes you about ${(2 ** b).toFixed(1)}× as many days. ` +
        (slow || fast ? `${fmt(slow)} ${slow === 1 ? 'read' : 'reads'} took over twice as long as ${slow === 1 ? 'its' : 'their'} length suggests; ${fmt(fast)} took under half.` : 'Every read was within a factor of two of the line.'));
      box.append(take);
      const lg = el('div', 'legend');
      legend(lg, genres.map((g) => [gColor(g), g]), 'genre');
      box.append(lg);

      const plot = el('div', 'ft-plot');
      box.append(plot);
      const h = Math.min(420, Math.max(300, plot.clientWidth * 0.5)), m = { t: 16, r: 16, b: 34, l: 44 };
      const { svg, w, tip } = svgIn(plot, h);
      const xe = d3.extent(rows, (r) => r.words), ye = d3.extent(rows, (r) => r.days);
      const x = d3.scaleLog([xe[0] / 1.2, xe[1] * 1.2], [m.l, w - m.r]), y = d3.scaleLog([Math.max(0.8, ye[0] / 1.3), ye[1] * 1.3], [h - m.b, m.t]);
      const kfmt = (v) => (v >= 1e6 ? v / 1e6 + 'M' : v >= 1000 ? v / 1000 + 'k' : String(v));
      const nice = (s, cand) => cand.filter((v) => v >= s.domain()[0] && v <= s.domain()[1]);
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).tickValues(nice(y, [1, 2, 3, 5, 7, 10, 14, 20, 30, 50, 70, 100, 150, 200, 365, 500, 1000])).tickFormat(String).tickSize(-(w - m.l - m.r)));
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(nice(x, w < 500 ? [1e4, 3e4, 1e5, 3e5, 1e6] : [5e3, 1e4, 2e4, 3e4, 5e4, 1e5, 2e5, 3e5, 5e5, 1e6])).tickFormat(kfmt).tickSize(-(h - m.t - m.b)));
      svg.selectAll('.domain').remove();
      svg.append('text').attr('class', 'axl').attr('x', m.l + 4).attr('y', m.t + 10).text('days to finish');
      svg.append('text').attr('class', 'axl').attr('x', w - m.r).attr('y', h - m.b - 6).attr('text-anchor', 'end').text('words');
      // the usual time for a book that length
      const fy = (wd) => 10 ** (rows[0].fit_a + b * Math.log10(wd));
      const [x0, x1] = x.domain();
      svg.append('line').attr('x1', x(x0)).attr('x2', x(x1)).attr('y1', y(fy(x0))).attr('y2', y(fy(x1)))
        .attr('stroke', 'var(--cds-chart-reference, var(--color-fg-muted))').attr('stroke-dasharray', '4 3');
      const r = d3.scaleSqrt([0, d3.max(rows, (d) => d.minutes) || 1], [3, w < 500 ? 7 : 10]);
      const dots = svg.append('g').selectAll('circle').data(rows.slice().sort((p, q) => q.minutes - p.minutes)).join('circle')
        .attr('cx', (d) => x(d.words)).attr('cy', (d) => y(d.days)).attr('r', (d) => r(d.minutes))
        .attr('fill', (d) => gColor(d.genre)).attr('fill-opacity', 0.8).attr('stroke', 'var(--color-panel)').attr('stroke-width', 1.5)
        .style('cursor', 'pointer').call(links, 'book', (d) => d.book_id);
      dots.on('mousemove', (e, d) => showTip(tip, plot, e, (t) => tipLines(t, (d.read_no > 1 ? '↻ ' : '') + d.title, [
        [gColor(d.genre), '', d.genre], [null, 'Words', fmt(d.words)], [null, 'Start to finish', `${fmt(d.days)} days (read on ${fmt(d.days_read)})`],
        [null, 'Time', d.minutes ? mins(d.minutes) : '—'], [null, 'Speed', d.wpm ? `${d.wpm} wpm` : '—'],
        [null, 'Against the line', d.vs_expected ? times(d.vs_expected) : '—'], [null, 'Finished', fDay(pDate(d.end))]])))
        .on('mouseleave', () => hideTip(tip));
      // label the reads furthest from the line, skipping any that would overlap one already placed
      const far = rows.filter((d) => d.vs_expected >= OUTLIER || d.vs_expected <= 1 / OUTLIER)
        .sort((p, q) => Math.abs(Math.log(q.vs_expected)) - Math.abs(Math.log(p.vs_expected))).slice(0, w < 500 ? 3 : LABELS);
      const placed = [];
      far.forEach((d) => {
        const cx = x(d.words), cy = y(d.days), right = cx < w * 0.7, s = d.title.length > 24 ? d.title.slice(0, 23) + '…' : d.title;
        const t = svg.append('text').attr('class', 'lbl-in ft-lbl').attr('x', cx + (right ? 1 : -1) * (r(d.minutes) + 4)).attr('y', cy).attr('dy', '0.35em')
          .attr('text-anchor', right ? 'start' : 'end').text(s);
        const bb = t.node().getBBox();
        if (placed.some((p) => bb.x < p.x + p.width && p.x < bb.x + bb.width && bb.y < p.y + p.height && p.y < bb.y + bb.height)) { t.remove(); return; }
        placed.push(bb);
        rh.linkBook(t.node(), d.book_id);
      });
    },
  });
})();
