// Where in a book you highlighted most: a strip across the book (0–100%) on each book page.
(() => {
  const { el, fmt, plural, svgIn, showTip, hideTip, tipLines, axis, gColor } = rh;
  const BINS = 20; // 5% each

  const snippet = (s, n = 70) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

  rh.bookCard({
    id: 'bk-hl-density',
    title: 'Where you highlighted',
    calc: 'highlights',
    before: 'card-bk-log', // highlights.js loads after this file, so its card lands below
    wide: true,
    draw(box, rows, parts, book) {
      const mine = rows.filter((h) => h.book_id === book.id && h.progress != null);
      const marks = mine.filter((h) => h.kind !== 'bookmark');
      if (marks.length < 2) return false;

      const bins = Array.from({ length: BINS }, (_, i) => ({ i, from: (i * 100) / BINS, to: ((i + 1) * 100) / BINS, items: [] }));
      marks.forEach((h) => bins[Math.min(BINS - 1, Math.floor((h.progress / 100) * BINS))].items.push(h));
      let top = bins.reduce((a, b) => (b.items.length > a.items.length ? b : a));
      const max = top.items.length;
      if (max < 2 || bins.filter((b) => b.items.length === max).length > 1) top = null; // no clear peak
      const firstHalf = marks.filter((h) => h.progress < 50).length;
      parts.note.hidden = false;
      parts.note.textContent = `${plural(marks.length, 'highlight')} across the book` +
        (top ? `, most around ${fmt(top.from)}–${fmt(top.to)}% (${fmt(max)})` : '') +
        `; ${fmt(Math.round((firstHalf / marks.length) * 100))}% in the first half. Each tick is one highlight in its colour; click one to find it below.`;

      const h = 92, m = { t: 4, r: 8, b: 22, l: 8 }, tickH = 18;
      box.style.minHeight = h + 'px';
      const { svg, w, tip } = svgIn(box, h);
      const x = d3.scaleLinear([0, 100], [m.l, w - m.r]);
      const y = d3.scaleLinear([0, max], [h - m.b, m.t + tickH + 6]);
      const colour = gColor(book.genre);

      // the stretch of book behind it all
      svg.append('rect').attr('x', x(0)).attr('width', x(100) - x(0)).attr('y', m.t + tickH + 6).attr('height', h - m.b - m.t - tickH - 6)
        .attr('fill', 'var(--cds-chart-grid)').attr('opacity', 0.35).attr('rx', 3);
      const bw = x(100 / BINS) - x(0);
      svg.append('g').selectAll('rect').data(bins.filter((b) => b.items.length)).join('rect')
        .attr('x', (b) => x(b.from) + 1).attr('width', Math.max(1, bw - 2))
        .attr('y', (b) => y(b.items.length)).attr('height', (b) => y(0) - y(b.items.length))
        .attr('rx', 2).attr('fill', colour).attr('fill-opacity', (b) => (b === top ? 0.9 : 0.55));

      // one tick per highlight, note or bookmark
      const ticks = svg.append('g').selectAll('line').data(mine).join('line')
        .attr('x1', (d) => x(d.progress)).attr('x2', (d) => x(d.progress))
        .attr('y1', m.t).attr('y2', m.t + tickH)
        .attr('stroke', (d) => d.colour || 'var(--color-fg-muted)').attr('stroke-width', 3).attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', (d) => (d.kind === 'bookmark' ? '3 3' : null))
        .style('cursor', 'pointer');

      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`),
        d3.axisBottom(x).tickValues([0, 25, 50, 75, 100]).tickFormat((v) => v + '%').tickSizeOuter(0));
      svg.selectAll('.domain').remove();

      // hover: the 5% under the pointer, or the highlight under a tick
      const near = (e) => {
        const [px, py] = d3.pointer(e, svg.node());
        if (py <= m.t + tickH + 3) {
          const hit = mine.reduce((a, d) => (Math.abs(x(d.progress) - px) < Math.abs(x(a.progress) - px) ? d : a));
          if (Math.abs(x(hit.progress) - px) <= 6) return { hit };
        }
        const p = x.invert(px);
        return p >= 0 && p <= 100 ? { bin: bins[Math.min(BINS - 1, Math.floor((p / 100) * BINS))] } : {};
      };
      svg.append('rect').attr('x', 0).attr('y', 0).attr('width', w).attr('height', h - m.b).attr('fill', 'transparent')
        .on('mousemove', (e) => {
          const { hit, bin } = near(e);
          ticks.attr('stroke-width', (d) => (d === hit ? 5 : 3));
          svg.style('cursor', hit ? 'pointer' : null);
          if (hit) {
            showTip(tip, box, e, (t) => tipLines(t, `${fmt(Math.round(hit.progress))}%${hit.chapter != null ? ` · chapter ${hit.chapter}` : ''}`, [[hit.colour, '', snippet(hit.text)]]));
          } else if (bin) {
            showTip(tip, box, e, (t) => tipLines(t, `${fmt(bin.from)}–${fmt(bin.to)}%`,
              bin.items.length ? [[null, '', plural(bin.items.length, 'highlight')], ...bin.items.slice(0, 3).map((d) => [d.colour, '', snippet(d.text, 50)])] : [[null, '', 'nothing highlighted']]));
          } else hideTip(tip);
        })
        .on('mouseleave', () => { hideTip(tip); ticks.attr('stroke-width', 3); })
        .on('click', (e) => {
          const { hit, bin } = near(e);
          const target = hit || (bin && bin.items.slice().sort((a, b) => a.progress - b.progress)[0]);
          const li = target && document.getElementById('hl-' + target.id);
          if (!li) return;
          li.scrollIntoView({ behavior: 'smooth', block: 'center' });
          li.classList.remove('hl-flash'); void li.offsetWidth; li.classList.add('hl-flash');
        });
    },
  });
})();
