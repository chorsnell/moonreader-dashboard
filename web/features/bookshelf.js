// The Bookshelf: every read a spine on a shelf, one shelf per year.
(() => {
  const { fmt, pDate, fDay, gColor, svgIn, showTip, hideTip, tipLines, legend, links, linkPage } = rh;
  const ord = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  const big = d3.format('.2~s');

  dash.calc('bookshelf', {
    inputs: ['reads', 'books'],
    title: 'Bookshelf',
    description: 'Every read, by the year it ended, with the book\'s estimated length in words.',
    fn: (reads, books) => {
      const byId = new Map(books.map((b) => [b.id, b]));
      const last = d3.max(reads, (r) => r.end);
      const recent = last ? d3.utcFormat('%Y-%m-%d')(d3.utcDay.offset(pDate(last), -30)) : '';
      return reads
        .map((r) => {
          const b = byId.get(r.book_id) || {};
          // words is what was read: split it over re-reads, scale up books left part-way
          const n = Math.max(1, b.times_read || 1), p = b.progress;
          const length = b.status === 'finished' || p == null || p >= 99 ? (b.words || 0) / n : (b.words || 0) * 100 / Math.max(5, p);
          return {
            read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre,
            read_no: r.read_no, start: r.start, end: r.end, hours: r.hours || 0, progress: r.progress,
            finished: r.finished === true, current: !r.finished && b.status === 'in_progress' && b.last_read === r.end && r.end >= recent,
            words: Math.round(length), year: +r.end.slice(0, 4),
          };
        })
        .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
    },
  });

  rh.tab('bookshelf', 'Bookshelf', { after: 'overview' });

  rh.card({
    tab: 'bookshelf',
    id: 'bookshelf',
    title: 'Your bookshelf',
    note: 'Every book you read, shelved by the year you finished it. Spine width is the book\'s length in words, height the hours you spent, colour its genre. Striped spines are re-reads; books left unfinished lean over. Click a spine to open the book.',
    calc: 'bookshelf',
    chartClass: 'bs-chart',
    draw(box, rows, parts) {
      if (!parts.legend) {
        parts.legend = rh.el('div', 'legend bs-legend');
        parts.box.before(parts.legend);
      }
      const genres = rh.genres().filter((g) => rows.some((r) => r.genre === g));
      legend(parts.legend, genres.map((g) => [gColor(g), g]), 'genre');
      const key = rh.el('span', 'bs-key');
      key.innerHTML = '<i class="bs-k-re"></i>re-read <i class="bs-k-lean"></i>unfinished';
      parts.legend.append(key);
      if (!rows.length) { box.replaceChildren(rh.el('div', 'fail', 'Nothing read yet')); return; }
      drawShelves(box, rows);
    },
  });

  function drawShelves(box, rows) {
    const years = d3.groups(rows, (r) => r.year).sort((a, b) => b[0] - a[0]);
    const W = Math.max(280, box.clientWidth), phone = W < 520;
    const maxH = phone ? 118 : 158, minH = Math.round(maxH * 0.58), head = 34, plank = 9, under = 30;
    const maxHours = d3.max(rows, (r) => r.hours) || 1;
    const hOf = (r) => Math.round(minH + (maxH - minH) * Math.sqrt(Math.min(1, r.hours / maxHours)));
    const TILT = 9, sin = Math.sin((TILT * Math.PI) / 180), gap = phone ? 1 : 1.5, pad = phone ? 6 : 14, minW = phone ? 4 : 6;
    const lean = (r) => (!r.finished ? Math.ceil(hOf(r) * sin) + 2 : 0);
    // one words-to-pixels scale for every shelf, so a fuller year looks fuller; a gentle
    // power keeps a 500k-word doorstop from swallowing a shelf
    const len = (r) => Math.pow(Math.max(1, r.words), 0.6);
    const avail = W - 2 * pad;
    let k = d3.min(years, ([, rs]) => (avail - rs.length * gap - d3.sum(rs, lean)) / Math.max(1, d3.sum(rs, len)));
    for (let i = 0; i < 3; i++) {
      // narrow books are held at minW; give the rest what's left
      k = d3.min(years, ([, rs]) => {
        const thin = rs.filter((r) => len(r) * k < minW);
        return (avail - rs.length * gap - d3.sum(rs, lean) - thin.length * minW) / Math.max(1, d3.sum(rs, (r) => (len(r) * k < minW ? 0 : len(r))));
      });
    }
    const wOf = (r) => Math.max(minW, len(r) * k);
    const rowH = head + maxH + 10 + plank + under;
    const { svg, tip } = svgIn(box, years.length * rowH);
    svg.attr('class', 'bs');

    const defs = svg.append('defs');
    const sheen = defs.append('linearGradient').attr('id', 'bs-sheen');
    [[0, '#fff', 0.1], [0.12, '#fff', 0.3], [0.3, '#fff', 0.06], [0.7, '#000', 0], [1, '#000', 0.3]].forEach(([o, c, a]) =>
      sheen.append('stop').attr('offset', o).attr('stop-color', c).attr('stop-opacity', a));
    const shade = defs.append('linearGradient').attr('id', 'bs-under').attr('x2', 0).attr('y2', 1);
    shade.append('stop').attr('offset', 0).attr('stop-color', '#000').attr('stop-opacity', 0.16);
    shade.append('stop').attr('offset', 1).attr('stop-color', '#000').attr('stop-opacity', 0);
    const hatch = defs.append('pattern').attr('id', 'bs-hatch').attr('width', 7).attr('height', 7)
      .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
    hatch.append('rect').attr('width', 3).attr('height', 7).attr('fill', '#fff').attr('fill-opacity', 0.28);

    years.forEach(([year, rs], yi) => {
      const g = svg.append('g').attr('transform', `translate(0,${yi * rowH})`);
      const base = head + maxH + 10;
      // shelf heading: year (links to the year page) and totals
      const ht = g.append('text').attr('class', 'bs-year').attr('x', pad).attr('y', 22);
      linkPage(ht.append('tspan').text(year).node(), 'year', year);
      const done = rs.filter((r) => r.finished).length;
      ht.append('tspan').attr('class', 'bs-sum').attr('dx', 10)
        .text(`${done} finished${rs.length > done ? ` · ${rs.length - done} unfinished` : ''} · ${fmt(Math.round(d3.sum(rs, (r) => r.hours)))} h · ${big(d3.sum(rs, (r) => r.words)).replace('G', 'B')} words`);
      // the back of the case and the plank
      g.append('rect').attr('class', 'bs-back').attr('x', 0).attr('y', head).attr('width', W).attr('height', base - head).attr('rx', 6);
      g.append('rect').attr('x', 0).attr('y', base + plank).attr('width', W).attr('height', under - 8).attr('fill', 'url(#bs-under)');
      g.append('rect').attr('class', 'bs-plank').attr('x', -2).attr('y', base).attr('width', W + 4).attr('height', plank).attr('rx', 2);
      g.append('rect').attr('class', 'bs-edge').attr('x', -2).attr('y', base).attr('width', W + 4).attr('height', 2).attr('rx', 1);

      let x = pad;
      const spines = rs.map((r) => {
        const w = wOf(r), h = hOf(r), s = { r, w, h, x };
        x += w + gap + lean(r);
        return s;
      });
      const sp = g.append('g').selectAll('g').data(spines).join('g').attr('class', 'bs-spine')
        .attr('transform', (s) => `translate(${s.x},${base})` + (s.r.finished ? '' : ` rotate(${TILT},${s.w},0)`))
        .call(links, 'book', (s) => s.r.book_id)
        .on('mousemove', (e, s) => showTip(tip, box, e, (t) => tipLines(t, s.r.title, tipRows(s.r))))
        .on('mouseleave', () => hideTip(tip));
      const body = sp.append('g').attr('class', 'bs-body');
      body.append('rect').attr('y', (s) => -s.h).attr('width', (s) => s.w).attr('height', (s) => s.h).attr('rx', (s) => Math.min(2, s.w / 4)).attr('fill', (s) => gColor(s.r.genre));
      body.filter((s) => s.r.read_no > 1).append('rect').attr('y', (s) => -s.h).attr('width', (s) => s.w).attr('height', (s) => s.h).attr('fill', 'url(#bs-hatch)');
      body.append('rect').attr('y', (s) => -s.h).attr('width', (s) => s.w).attr('height', (s) => s.h).attr('rx', (s) => Math.min(2, s.w / 4)).attr('fill', 'url(#bs-sheen)');
      // gilt bands top and bottom
      body.filter((s) => s.w >= 8).each(function (s) {
        const b = d3.select(this);
        [-s.h + 7, -s.h + 11, -13].forEach((y, i) => b.append('rect').attr('class', 'bs-band').attr('x', 1).attr('y', y).attr('width', s.w - 2).attr('height', i === 1 ? 1 : 1.6));
      });
      // a ribbon on the one you're reading now
      body.filter((s) => s.r.current).append('path').attr('class', 'bs-ribbon')
        .attr('d', (s) => { const t = Math.max(3, Math.min(5, s.w * 0.3)), x0 = s.w * 0.6 - t / 2; return `M${x0},${-s.h + 1}v-11l${t / 2},3l${t / 2},-3v11z`; });
      // the title down the spine, where it fits
      body.filter((s) => s.w >= 13).each(function (s) {
        const fs = Math.min(phone ? 10 : 11.5, s.w * 0.62), room = s.h - 34;
        const t = d3.select(this).append('text').attr('class', 'bs-title').attr('font-size', fs)
          .attr('transform', `translate(${s.w / 2},${-s.h + 17}) rotate(90)`).attr('dy', '0.35em').text(s.r.title);
        let txt = s.r.title;
        while (txt.length > 1 && t.node().getComputedTextLength() > room) { txt = txt.slice(0, -1).trimEnd(); t.text(txt + '…'); }
      });
    });
  }

  function tipRows(r) {
    const out = [[gColor(r.genre), r.genre, '']];
    if (r.author) out.push([null, 'Author', r.author]);
    out.push([null, 'Length', `~${big(r.words)} words`]);
    out.push([null, 'Read', `${fDay(pDate(r.start))} – ${fDay(pDate(r.end))}`]);
    out.push([null, 'Time', `${fmt(r.hours)} h`]);
    if (r.read_no > 1) out.push([null, 'Re-read', `${ord(r.read_no)} time`]);
    if (!r.finished) out.push([null, r.current ? 'Reading now' : 'Left at', r.progress != null ? r.progress + '%' : '—']);
    return out;
  }
})();
