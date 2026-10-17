// author page: #author/<name>, everything about how you've read one author
(() => {
  const { D, el, fmt, pDate, fDay, fShort, C, gColor, svgIn, measure, showTip, hideTip, tipLines, axis, vbars, cover,
    linkBook, linkPage, ref, setTitle, mins, pct, date, plural, speedFrom, avgWpm, vsAvg, STATUS } = rh;
  const ok = (id) => { const r = D(id); return r.status === 'ok' ? r.data : null; };
  const yr = (s) => +s.slice(0, 4);
  const hrs = (h) => (h >= 10 ? fmt(Math.round(h)) : fmt(Math.round(h * 10) / 10));
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function kpi(lbl, val, sub) {
    const k = el('div', 'rh-kpi'), v = el('div', 'val' + (String(val.textContent ?? val).length > 12 ? ' val-sm' : ''));
    v.append(val);
    k.append(el('div', 'lbl', lbl), v);
    if (sub) k.append(el('div', 'sub', sub));
    return k;
  }
  function card(title, note, wide) {
    const c = el('div', 'rh-card' + (wide ? ' wide' : ''));
    c.append(el('h2', null, title));
    if (note) c.append(el('p', 'note', note));
    return c;
  }
  function pbar(p, color) {
    const b = el('div', 'pbar'), i = el('i');
    i.style.width = Math.min(100, p || 0) + '%'; i.style.background = color; b.append(i);
    return b;
  }

  rh.register('author', {
    draw(name, root) {
      setTitle(name);
      const all = ok('books');
      if (!all) { root.replaceChildren(el('div', 'dy-empty', 'Loading…')); return; }
      const books = all.filter((b) => b.author === name);
      if (!books.length) {
        const c = el('div', 'rh-card wide');
        c.append(el('div', 'bk-title', name), el('div', 'dy-empty', `No books by ${name} in your library.`));
        root.replaceChildren(c); return;
      }
      const ids = new Set(books.map((b) => b.id));
      const reads = (ok('reads') || []).filter((r) => ids.has(r.book_id)).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      const daily = (ok('daily') || []).filter((d) => ids.has(d.book_id));
      const byBook = d3.group(daily, (d) => d.book_id);
      const firstOf = (b) => b.first_read || (reads.find((r) => r.book_id === b.id) || {}).start || null;
      books.sort((a, b) => { const x = firstOf(a), y = firstOf(b); return x === y ? a.title.localeCompare(b.title) : !x ? 1 : !y ? -1 : x < y ? -1 : 1; });

      // hours per year: timed days where logged, otherwise the read's own hours in the year it ended
      const perYear = new Map(), add = (y, h) => perYear.set(y, (perYear.get(y) || 0) + h);
      daily.forEach((d) => { if (d.minutes > 0) add(yr(d.date), d.minutes / 60); });
      reads.forEach((r) => {
        if (!r.hours) return;
        const timed = (byBook.get(r.book_id) || []).some((d) => d.minutes > 0 && d.date >= r.start && d.date <= r.end);
        if (!timed) add(yr(r.end || r.start), r.hours);
      });
      let hours = d3.sum([...perYear.values()]);
      if (!hours) hours = d3.sum(books, (b) => b.hours || 0);

      const fin = books.filter((b) => b.status === 'finished');
      const rereads = reads.length ? reads.filter((r) => r.read_no > 1).length : d3.sum(books, (b) => Math.max(0, (b.times_read || 0) - 1));
      const started = books.map(firstOf).filter(Boolean).sort();
      const genreHours = d3.rollups(books, (v) => d3.sum(v, (b) => b.hours || 0) + v.length * 1e-3, (b) => b.genre).filter(([g]) => g).sort((a, b) => b[1] - a[1]);
      const mainGenre = genreHours.length ? genreHours[0][0] : null;

      // ---------- header ----------
      const head = el('div', 'rh-card wide'), info = el('div', 'go-info');
      info.append(el('div', 'bk-title', name));
      const bits = [plural(books.length, 'book'), `${fmt(fin.length)} finished`];
      if (hours >= 1) bits.push(`${hrs(hours)} hours`);
      info.append(el('div', 'go-sub', bits.join(', ') + (started.length ? ` since ${yr(started[0])}` : '') + '.'));
      const chips = el('div', 'bk-chips');
      genreHours.forEach(([g]) => { const c = linkPage(el('span', 'chip', g), 'genre', g); c.style.color = gColor(g); chips.append(c); });
      [...new Set(books.map((b) => b.series).filter(Boolean))].forEach((s) => chips.append(linkPage(el('span', 'chip', s), 'series', s)));
      if (chips.childNodes.length) info.append(chips);
      const covers = el('div', 'au-covers');
      books.slice(0, 8).forEach((b) => { const c = linkBook(cover(b.id, b.title, b.genre, ''), b.id); c.title = b.title; covers.append(c); });
      if (books.length > 8) covers.append(el('span', 'au-more', `+${fmt(books.length - 8)}`));
      info.append(covers);
      head.append(info);

      // ---------- headline figures ----------
      const k = [], avg = avgWpm(), spd = speedFrom(daily);
      const inProg = books.filter((b) => b.status === 'in_progress').length;
      k.push(kpi('Books in library', fmt(books.length), [fin.length ? `${fmt(fin.length)} finished` : 'none finished yet', inProg ? `${fmt(inProg)} in progress` : null].filter(Boolean).join(' · ')));
      if (rereads) k.push(kpi('Re-reads', fmt(rereads), `${plural(reads.length || books.length, 'read')} in all`));
      if (hours >= 0.05) k.push(kpi('Time spent', `${hrs(hours)} h`, fin.length + inProg > 1 ? `about ${hrs(hours / (fin.length + inProg))} h per book read` : null));
      const words = d3.sum(books, (b) => b.words || 0);
      if (words) k.push(kpi('Words read', fmt(words), null));
      if (spd) {
        const gs = (ok('group_speed') || []).filter((r) => r.kind === 'author'), rank = gs.findIndex((r) => r.name === name);
        k.push(kpi('Speed', `${fmt(Math.round(spd.wpm))} wpm`, [avg ? vsAvg(spd.wpm / avg - 1) : null, rank >= 0 ? `#${rank + 1} fastest of ${fmt(gs.length)} authors` : null].filter(Boolean).join(' · ')));
      }
      if (reads.length) {
        const f = reads[0], l = reads.reduce((a, r) => ((r.end || r.start) > (a.end || a.start) ? r : a));
        const tf = books.find((b) => b.id === f.book_id), tl = books.find((b) => b.id === l.book_id);
        const kf = kpi('First read', fDay(pDate(f.start)), tf ? tf.title : null);
        const kl = kpi('Most recent', fDay(pDate(l.end || l.start)), tl ? tl.title : null);
        linkBook(kf, f.book_id); linkBook(kl, l.book_id);
        k.push(kf, kl);
      } else if (started.length) k.push(kpi('First read', date(started[0])));
      if (mainGenre) k.push(kpi('Main genre', linkPage(el('span', 'lk', mainGenre), 'genre', mainGenre), genreHours.length > 1 ? `of ${plural(genreHours.length, 'genre')}` : null));
      const kpis = el('div', 'rh-kpis au-kpis'); kpis.append(...k);

      // ---------- cards ----------
      const nodes = [head, kpis], later = [];
      const years = [...perYear.keys()].sort((a, b) => a - b);
      const grid = el('div', 'rh-grid');
      if (years.length >= 2 || (years.length === 1 && reads.length > 1)) {
        const rows = d3.range(years[0], years[years.length - 1] + 1).map((y) => ({ year: y, h: Math.round((perYear.get(y) || 0) * 10) / 10 }));
        const best = rows.reduce((a, r) => (r.h > a.h ? r : a));
        const c = card('Hours per year', `Time spent reading ${name} each year. Most was ${best.year}, with ${hrs(best.h)} hours. Click a year to open it.`);
        const ch = el('div', 'chart'); ch.style.minHeight = '220px'; c.append(ch); grid.append(c);
        later.push(() => vbars(ch, rows, (r) => r.year, (r) => r.h, gColor(mainGenre), 'Hours', (r) => ['year', r.year]));
      }
      const bs = (ok('book_speed') || []).filter((r) => ids.has(r.book_id));
      if (bs.length >= 2 && spd) {
        const aw = Math.round(spd.wpm);
        const c = card('Speed per book', `Words per minute for each book with 2+ timed hours, against your ${fmt(aw)} wpm average for ${name}${avg ? ` (${fmt(avg)} wpm across everything)` : ''}.`);
        const ch = el('div', 'chart'); c.append(ch); grid.append(c);
        later.push(() => speedDots(ch, bs, aw));
      }
      if (grid.childNodes.length) nodes.push(grid);

      if (reads.length) {
        const c = card('Every read', 'Each bar is one read, from the day you started to the last day you opened it. Faded bars weren’t finished. Click one to open the book.', true);
        const ch = el('div', 'chart'); c.append(ch); nodes.push(c);
        later.push(() => timeline(ch, books, reads));
      }

      // the books, in the order you first read them
      const list = el('ul', 'rh-list');
      books.forEach((b) => {
        const li = linkBook(el('li'), b.id), t = el('div', 'ttl'), sm = el('small');
        li.append(cover(b.id, b.title, b.genre));
        sm.append(STATUS[b.status] || b.status || '');
        if (b.times_read > 1) sm.append(` · read ${b.times_read} times`);
        if (b.series) sm.append(' · ', ref(b, 'series', b.series + (b.series_no != null ? ' #' + b.series_no : '')));
        t.append(document.createTextNode(b.title), sm);
        if (b.progress != null) t.append(pbar(b.progress, gColor(b.genre)));
        const s = speedFrom(byBook.get(b.id) || []), meta = el('div', 'meta au-meta');
        const first = firstOf(b);
        meta.append(el('div', null, first ? fShort(pDate(first)) : 'not opened'));
        const m = [b.hours ? `${hrs(b.hours)} h` : null, s ? `${fmt(Math.round(s.wpm))} wpm` : null].filter(Boolean).join(' · ');
        if (m) meta.append(el('div', null, m));
        if (b.progress != null && b.status !== 'finished') meta.append(el('div', null, pct(b.progress)));
        li.append(t, meta);
        list.append(li);
      });
      const bc = card('Their books', (books.length > 1 ? `${plural(books.length, 'book')}, in the order you first opened them. ` : '') + 'Hours and speed cover every read.');
      bc.append(list);

      const series = d3.groups(books.filter((b) => b.series), (b) => b.series);
      if (series.length) {
        const g2 = el('div', 'rh-grid'), sc = card('Series', `${plural(series.length, 'series')} by ${name} in your library.`), ul = el('ul', 'rh-list');
        series.forEach(([s, v]) => {
          v.sort((a, b) => (a.series_no ?? 1e9) - (b.series_no ?? 1e9));
          const li = linkPage(el('li'), 'series', s), t = el('div', 'ttl'), f = v.filter((b) => b.status === 'finished').length;
          t.append(document.createTextNode(s), el('small', null, `${fmt(f)} of ${fmt(v.length)} finished`), pbar(f / v.length * 100, gColor(v[0].genre)));
          const cv = el('div', 'au-stack'); v.slice(0, 4).forEach((b) => cv.append(cover(b.id, b.title, b.genre, 'sm')));
          li.append(cv, t, el('div', 'meta', `${hrs(d3.sum(v, (b) => b.hours || 0))} h`));
          ul.append(li);
        });
        sc.append(ul);
        g2.append(bc, sc); nodes.push(g2);
      } else { bc.classList.add('wide'); nodes.push(bc); }

      root.replaceChildren(...nodes);
      later.forEach((f) => f());
    },
  });

  // dots for each book's speed, with a line from the author's average
  function speedDots(box, rows, avg) {
    const rh_ = 26, m = { t: 20, r: 44, b: 6 }, h = m.t + rows.length * rh_ + m.b;
    box.style.minHeight = h + 'px';
    const { svg, w, tip } = svgIn(box, h);
    const lab = Math.min(w * 0.42, measure(svg, rows.map((r) => short(r.title, 26))) + 12);
    const ext = d3.extent(rows.map((r) => r.wpm).concat([avg]));
    const x = d3.scaleLinear([ext[0] - 8, ext[1] + 8], [lab, w - m.r]);
    svg.append('line').attr('x1', x(avg)).attr('x2', x(avg)).attr('y1', m.t - 4).attr('y2', h - m.b).attr('stroke', 'var(--color-fg-muted)').attr('stroke-dasharray', '4 3');
    svg.append('text').attr('class', 'axl').attr('x', x(avg)).attr('y', m.t - 8).attr('text-anchor', 'middle').text(`avg ${avg}`);
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${m.t + i * rh_ + rh_ / 2})`);
    g.append('text').attr('class', 'axl').attr('x', lab - 10).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => short(d.title, 26));
    g.append('line').attr('x1', x(avg)).attr('x2', (d) => x(d.wpm)).attr('stroke', (d) => gColor(d.genre)).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-opacity', 0.6);
    g.append('circle').attr('cx', (d) => x(d.wpm)).attr('r', 5.5).attr('fill', (d) => gColor(d.genre));
    const leftOf = (d) => d.wpm < avg && x(d.wpm) - lab > 40;
    g.append('text').attr('class', 'lbl-in').attr('x', (d) => (leftOf(d) ? x(d.wpm) - 10 : d.wpm < avg ? x(avg) + 8 : x(d.wpm) + 10)).attr('dy', '0.35em')
      .attr('text-anchor', (d) => (leftOf(d) ? 'end' : 'start')).text((d) => d.wpm);
    g.append('rect').attr('y', -rh_ / 2).attr('width', w).attr('height', rh_).attr('fill', 'transparent').each(function (d) { linkBook(this, d.book_id); })
      .on('mousemove', (e, d) => showTip(tip, box, e, (t) => tipLines(t, d.title, [[gColor(d.genre), 'Speed', `${d.wpm} wpm`], [null, `vs ${fmt(avg)} avg`, vsAvg(d.wpm / avg - 1)], [null, 'Timed', `${fmt(d.hours)} h over ${plural(d.days, 'day')}`]])))
      .on('mouseleave', () => hideTip(tip));
  }

  // one row per book, a bar per read across time
  function timeline(box, books, reads) {
    const rowsB = books.filter((b) => reads.some((r) => r.book_id === b.id)), byB = d3.group(reads, (r) => r.book_id);
    const rh_ = 22, m = { t: 4, r: 8, b: 24 }, h = m.t + rowsB.length * rh_ + m.b;
    box.style.minHeight = h + 'px';
    const { svg, w, tip } = svgIn(box, h);
    const lab = Math.min(w * 0.38, measure(svg, rowsB.map((b) => short(b.title, 28))) + 12);
    const lo = d3.min(reads, (r) => pDate(r.start)), hi = d3.utcDay.offset(d3.max(reads, (r) => pDate(r.end || r.start)), 1);
    const x = d3.scaleUtc([lo, hi], [lab, w - m.r]).nice();
    const ny = d3.utcYear.count(x.domain()[0], x.domain()[1]);
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`),
      d3.axisBottom(x).ticks(Math.max(2, Math.min(ny > 1 ? ny : 6, Math.floor((w - lab) / 70)))).tickFormat(ny > 1 ? d3.utcFormat('%Y') : d3.utcFormat('%b %y')).tickSize(-(h - m.t - m.b)).tickSizeOuter(0));
    svg.selectAll('.domain').remove();
    const g = svg.append('g').selectAll('g').data(rowsB).join('g').attr('transform', (d, i) => `translate(0,${m.t + i * rh_})`);
    g.append('text').attr('class', 'axl').attr('x', lab - 10).attr('y', rh_ / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => short(d.title, 28));
    g.append('rect').attr('x', 0).attr('width', w).attr('height', rh_).attr('fill', 'transparent').each(function (d) { linkBook(this, d.id); });
    g.selectAll('rect.rd').data((b) => byB.get(b.id).map((r) => ({ r, b }))).join('rect').attr('class', 'rd')
      .attr('x', (d) => x(pDate(d.r.start))).attr('y', 4).attr('height', rh_ - 8).attr('rx', 3)
      .attr('width', (d) => Math.max(4, x(d3.utcDay.offset(pDate(d.r.end || d.r.start), 1)) - x(pDate(d.r.start))))
      .attr('fill', (d) => gColor(d.b.genre)).attr('fill-opacity', (d) => (d.r.finished ? 1 : 0.4))
      .each(function (d) { linkBook(this, d.b.id); })
      .on('mousemove', (e, d) => showTip(tip, box, e, (t) => tipLines(t, d.b.title + (d.r.read_no > 1 ? ` · read ${d.r.read_no}` : ''), [
        [null, 'From', date(d.r.start)], [null, 'To', date(d.r.end)], [null, 'Read on', plural(d.r.days_read || 0, 'day')],
        [null, 'Time', d.r.hours ? mins(d.r.hours * 60) : '—'], [null, 'Got to', d.r.finished ? 'Finished' : pct(d.r.progress)]])))
      .on('mouseleave', () => hideTip(tip));
  }
})();
