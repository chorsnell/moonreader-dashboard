// series page: #series/<name> — how you read your way through one series
(() => {
  const { D, el, fmt, pDate, fDay, fShort, C, gColor, svgIn, showTip, hideTip, tipLines, axis, legend, hbars, cover,
    linkBook, linkPage, setTitle, pct, plural, span, speedFrom, avgWpm, vsAvg, STATUS } = rh;
  const ok = (id) => { const r = D(id); return r.status === 'ok' ? r.data : null; };
  const byOrder = (a, b) => (a.series_no ?? 1e9) - (b.series_no ?? 1e9) || a.title.localeCompare(b.title);
  const no = (b) => (b.series_no != null ? '#' + b.series_no + ' ' : '');
  const dur = (d) => (d < 60 ? plural(d, 'day') : d < 730 ? plural(Math.round(d / 30.44), 'month') : `${(d / 365.25).toFixed(1).replace(/\.0$/, '')} years`);
  const hrs = (h) => (h ? (h >= 10 ? fmt(Math.round(h)) : String(Math.round(h * 10) / 10)) + ' h' : '—');
  const READ = { done: [C[0], 'Finished'], now: [C[1], 'Reading now'], stop: ['var(--cds-chart-muted)', 'Not finished'] };

  function kpi(lbl, val, sub, bookId) {
    const k = el('div', 'rh-kpi');
    k.append(el('div', 'lbl', lbl), el('div', 'val' + (val.length > 12 ? ' val-sm' : ''), val));
    if (sub) k.append(el('div', 'sub', sub));
    if (bookId) linkBook(k, bookId);
    return k;
  }
  function card(title, note, wide) {
    const c = el('div', 'rh-card' + (wide ? ' wide' : ''));
    c.append(el('h2', null, title));
    if (note) c.append(el('p', 'note', note));
    return c;
  }

  function draw(name, root) {
    const books = ok('books');
    if (!books) { root.replaceChildren(el('div', 'dy-empty', 'Loading…')); return; }
    const ser = books.filter((b) => b.series === name).sort(byOrder);
    if (!ser.length) {
      setTitle('Series');
      const c = el('div', 'rh-card wide');
      c.append(el('div', 'dy-empty', `No series called “${name}” in your library.`));
      root.replaceChildren(c);
      return;
    }
    setTitle(name);
    const ids = new Set(ser.map((b) => b.id)), meta = new Map(ser.map((b) => [b.id, b]));
    const reads = (ok('reads') || []).filter((r) => ids.has(r.book_id));
    const daily = (ok('daily') || []).filter((d) => ids.has(d.book_id));
    const active = new Map((ok('timeline') || []).filter((r) => ids.has(r.book_id)).map((r) => [r.read_id, r.active]));
    const readsOf = (id) => reads.filter((r) => r.book_id === id).sort((a, b) => a.read_no - b.read_no);
    const doneEver = (b) => b.status === 'finished' || reads.some((r) => r.book_id === b.id && r.finished === true);
    const daysOf = new Map(); daily.forEach((d) => { if (!daysOf.has(d.book_id)) daysOf.set(d.book_id, []); daysOf.get(d.book_id).push(d); });
    const avg = avgWpm();

    // per book: reads, speed, first finish
    const rows = ser.map((b) => {
      const rs = readsOf(b.id), fin = rs.filter((r) => r.finished === true);
      const latest = rs[rs.length - 1];
      const lastFin = fin[fin.length - 1];
      const status = b.status === 'in_progress' && fin.length ? 'Re-reading' : STATUS[b.status] || b.status;
      return { b, rs, fin, latest, lastFin, status, done: doneEver(b), spd: speedFrom(daysOf.get(b.id) || []) };
    });
    const nDone = rows.filter((r) => r.done).length;
    const reading = rows.filter((r) => r.b.status === 'in_progress');

    // ---------- header ----------
    const head = el('div', 'rh-card wide se-head'), info = el('div', 'go-info');
    info.append(el('div', 'bk-title', name));
    const sub = el('div', 'go-sub'), authors = [...new Set(ser.map((b) => b.author).filter(Boolean))];
    authors.forEach((a, i) => { if (i) sub.append(', '); sub.append(linkPage(el('span', 'lk', a), 'author', a)); });
    if (authors.length) sub.append(' · ');
    const maxNo = d3.max(ser, (b) => b.series_no);
    sub.append(`${plural(ser.length, 'book')} in your library` + (maxNo > ser.length ? `, numbered up to #${maxNo}` : ''));
    info.append(sub);
    const chips = el('div', 'bk-chips');
    chips.append(el('span', 'chip' + (nDone === ser.length ? ' ok' : ''), nDone === ser.length ? 'All finished' : reading.length ? 'In progress' : nDone ? 'Part read' : 'Not started'));
    const genres = [...new Set(ser.map((b) => b.genre).filter(Boolean))], subs = [...new Set(ser.map((b) => b.subgenre).filter(Boolean))];
    genres.forEach((g) => { const c = linkPage(el('span', 'chip', g), 'genre', g); c.style.color = gColor(g); chips.append(c); });
    subs.forEach((g) => { const b = ser.find((x) => x.subgenre === g), c = linkPage(el('span', 'chip', g), 'subgenre', g); c.style.color = gColor(b.genre); chips.append(c); });
    info.append(chips);
    const covers = el('div', 'se-covers');
    rows.forEach(({ b, done }) => {
      const c = linkBook(cover(b.id, b.title, b.genre, ser.length <= 8 ? 'lg' : ''), b.id);
      c.title = no(b) + b.title;
      const f = el('figure', 'se-cv' + (done ? '' : b.status === 'in_progress' ? ' now' : ' todo'));
      f.append(c, el('figcaption', null, b.series_no != null ? '#' + b.series_no : '·'));
      covers.append(f);
    });
    // one segment per book, filled to how far you got
    const prog = el('div', 'go-prog se-prog'), strip = el('div', 'se-strip');
    rows.forEach(({ b, done }) => {
      const s = linkBook(el('div', 'pbar'), b.id), f = el('i');
      s.title = `${no(b)}${b.title}: ${done && b.status !== 'in_progress' ? 'finished' : pct(b.progress ?? 0)}`;
      f.style.width = (done ? 100 : Math.min(100, b.progress || 0)) + '%'; f.style.background = gColor(b.genre);
      s.append(f); strip.append(s);
    });
    prog.append(el('b', null, `${fmt(nDone)} of ${fmt(ser.length)}`), el('span', 'se-prog-l', 'finished'), strip);
    info.append(prog);
    head.append(info, covers);

    // ---------- headline figures ----------
    const k = [];
    const hours = d3.sum(ser, (b) => b.hours || 0), words = d3.sum(ser, (b) => b.words || 0);
    k.push(kpi('Finished', `${fmt(nDone)} of ${fmt(ser.length)}`, reading.length ? `reading ${reading.map(({ b }) => no(b).trim() || b.title).join(', ')} now` : nDone === ser.length ? 'the whole series' : null));
    if (hours) k.push(kpi('Time spent', hrs(hours), `about ${hrs(hours / ser.length)} a book`));
    if (words) k.push(kpi('Words read', fmt(words), reads.length > ser.length ? 'counting re-reads' : null));
    const spd = speedFrom(daily);
    if (spd) k.push(kpi('Speed', `${fmt(Math.round(spd.wpm))} wpm`, avg ? vsAvg(spd.wpm / avg - 1) : null));
    const chrono = reads.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
    const first = chrono[0], last = reads.slice().sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    if (first) k.push(kpi('Started', fDay(pDate(first.start)), no(meta.get(first.book_id)) + first.title, first.book_id));
    if (last) k.push(kpi('Latest', fDay(pDate(last.end)), no(meta.get(last.book_id)) + last.title, last.book_id));
    const fins = reads.filter((r) => r.finished === true).sort((a, b) => (a.end < b.end ? -1 : 1)), lastF = fins[fins.length - 1];
    if (first && lastF && fins.length > 1) k.push(kpi(nDone === ser.length ? 'Start to finish' : 'First start to latest finish', dur(span(first.start, lastF.end)), `${fShort(pDate(first.start))} – ${fShort(pDate(lastF.end))}`));
    // gaps: from finishing one book to starting the next new one
    const firsts = chrono.filter((r) => r.read_no === 1), gaps = [];
    for (let i = 1; i < firsts.length; i++) {
      const prev = firsts.slice(0, i).filter((r) => r.finished === true).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
      if (prev && prev.end <= firsts[i].start) gaps.push({ d: span(prev.end, firsts[i].start) - 1, r: firsts[i], prev });
    }
    if (gaps.length) {
      const long = gaps.reduce((a, g) => (g.d > a.d ? g : a));
      k.push(kpi('Gap between books', dur(Math.round(d3.mean(gaps, (g) => g.d))), gaps.length > 1 ? `on average; longest ${dur(long.d)} before ${no(meta.get(long.r.book_id)).trim()}` : `before ${no(meta.get(gaps[0].r.book_id)) + gaps[0].r.title}`));
    }
    const next = rows.find((r) => !r.done);
    if (next) {
      const nb = next.b, missing = ser[0].series_no != null && nb.series_no != null
        ? d3.range(1, nb.series_no).filter((n) => !ser.some((b) => b.series_no === n)) : [];
      const reading1 = nb.status === 'in_progress';
      k.push(kpi(reading1 ? 'Reading now' : 'Up next', no(nb) + nb.title,
        (reading1 ? `${pct(nb.progress)} through` : nb.status === 'not_started' ? 'not started yet' : nb.progress ? `stopped at ${pct(nb.progress)}` : null) +
        (missing.length ? ` · ${missing.map((n) => '#' + n).join(', ')} not in your library` : ''), nb.id));
    }
    const kpis = el('div', 'rh-kpis se-kpis'); kpis.append(...k);

    // ---------- timeline ----------
    const tl = card('Reading through the series', 'Every read of every book, in series order. A bar runs from the first to the last day of a read, solid on the days you opened it. ↻ marks a re-read. Click a bar to open the book.', true);
    const leg = el('div', 'legend'), tlBox = el('div', 'chart se-tl');
    tl.append(leg, tlBox);

    // ---------- books ----------
    const bc = card('The books', 'In series order, with every read rolled up. Click a book to open it.', true);
    const box = el('div', 'tbl-box'), tbl = el('table', 'bk-tbl se-tbl'), thead = el('thead'), htr = el('tr'), tbody = el('tbody');
    [['#', 'n'], ['Book'], ['Started', 'hide-sm'], ['Last read'], ['Hours', 'n'], ['WPM', 'n hide-sm'], ['Reads', 'n hide-sm']]
      .forEach(([t, c]) => htr.append(el('th', c || null, t)));
    thead.append(htr); tbl.append(thead, tbody); box.append(tbl); bc.append(box);
    tbody.append(...rows.map(({ b, rs, fin, status, done, spd: s }) => {
      const tr = linkBook(el('tr'), b.id), tt = el('div', 'tt'), t = el('div', 'se-ttl');
      t.append(el('span', null, b.title), el('small', null, status + (b.progress != null && !(done && b.status === 'finished') ? ' · ' + pct(b.progress) : '')));
      const pb = el('div', 'pbar'), i = el('i'); i.style.width = (b.status === 'finished' ? 100 : Math.min(100, b.progress || 0)) + '%'; i.style.background = gColor(b.genre); pb.append(i); t.append(pb);
      tt.append(cover(b.id, b.title, b.genre, 'sm'), t);
      const td = el('td', 'se-book'); td.append(tt);
      const lastDay = rs.length ? rs[rs.length - 1].end : b.last_read;
      const lastTd = el('td', null, lastDay ? fDay(pDate(lastDay)) : '—');
      if (fin.length && fin[fin.length - 1].end === lastDay) lastTd.append(el('small', null, ' finished'));
      tr.append(el('td', 'n', b.series_no != null ? String(b.series_no) : '—'), td,
        el('td', 'hide-sm', rs.length ? fDay(pDate(rs[0].start)) : b.first_read ? fDay(pDate(b.first_read)) : '—'), lastTd,
        el('td', 'n', hrs(b.hours)), el('td', 'n hide-sm', s ? fmt(Math.round(s.wpm)) : '—'), el('td', 'n hide-sm', fmt(Math.max(rs.length, b.times_read || 0))));
      return tr;
    }));

    // ---------- hours and speed per book ----------
    const hRows = rows.filter((r) => r.b.hours > 0), sRows = rows.filter((r) => r.spd);
    const grid = el('div', 'rh-grid'), hBox = el('div', 'chart short'), sBox = el('div', 'chart short');
    if (hRows.length > 1) { const c = card('Hours per book', 'Time spent on each book, across every read.'); c.append(hBox); grid.append(c); }
    if (sRows.length > 1) {
      const c = card('Speed per book', `Words per minute on each book, from days with timed reading.${avg ? ` Your average is ${fmt(avg)} wpm.` : ''}`);
      c.append(sBox); grid.append(c);
    }

    root.replaceChildren(...[head, kpis, reads.length ? tl : null, bc, grid.children.length ? grid : null].filter(Boolean));

    if (reads.length) drawTimeline(tlBox, leg, rows, active);
    const lbl = (r) => no(r.b) + r.b.title;
    const tipBook = (t, r) => tipLines(t, lbl(r), [[null, 'Hours', hrs(r.b.hours)], [null, 'Speed', r.spd ? `${fmt(Math.round(r.spd.wpm))} wpm` : '—'],
      ...(r.spd && avg ? [[null, '', vsAvg(r.spd.wpm / avg - 1)]] : []), [null, 'Status', r.status]]);
    if (hRows.length > 1) hbars(hBox, hRows, { label: lbl, value: (r) => Math.round(r.b.hours * 10) / 10, color: (r) => gColor(r.b.genre), tipFn: tipBook, link: (r) => ['book', r.b.id] });
    if (sRows.length > 1) hbars(sBox, sRows, { label: lbl, value: (r) => Math.round(r.spd.wpm), color: (r) => gColor(r.b.genre), tipFn: tipBook, link: (r) => ['book', r.b.id] });
  }

  // one bar per read, in series order, across the dates
  function drawTimeline(box, leg, rows, active) {
    const data = [];
    rows.forEach(({ b, rs }) => rs.forEach((r, i) => {
      const kind = r.finished === true ? 'done' : i === rs.length - 1 && b.status === 'in_progress' ? 'now' : 'stop';
      data.push({ ...r, b, kind, first: i === 0, active: active.get(r.read_id) });
    }));
    // what came before each read, by date, for the tooltip
    const chrono = data.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
    chrono.forEach((r, i) => { const p = chrono.slice(0, i).filter((x) => x.end <= r.start).sort((a, b) => (a.end < b.end ? 1 : -1))[0]; if (p) r.prev = p; });
    const kinds = Object.keys(READ).filter((k) => data.some((d) => d.kind === k));
    legend(leg, kinds.map((k) => READ[k]));

    const rh = 24, m = { t: 22, r: 8, b: 4, l: 8 }, h = m.t + data.length * rh + m.b;
    box.style.minHeight = h + 'px';
    const { svg, w, tip } = svgIn(box, h);
    const lo = pDate(d3.min(data, (d) => d.start)), hi = d3.utcDay.offset(pDate(d3.max(data, (d) => d.end)), 1);
    const days = d3.utcDay.count(lo, hi), pad = Math.max(1, Math.round(days * 0.02));
    const x = d3.scaleUtc([d3.utcDay.offset(lo, -pad), d3.utcDay.offset(hi, pad)], [m.l, w - m.r]);
    const x0 = (s) => x(pDate(s)), x1 = (e) => x(d3.utcDay.offset(pDate(e), 1));
    const years = days / 365;
    const ax = d3.axisTop(x).tickSize(-(h - m.t));
    if (years > 2.5) ax.ticks(d3.utcYear.every(Math.max(1, Math.ceil(years / Math.max(2, Math.floor(w / 70)))))).tickFormat(d3.utcFormat('%Y'));
    else ax.ticks(Math.max(2, Math.floor(w / 90))).tickFormat(d3.utcFormat(days <= 120 ? '%-d %b' : '%b %y'));
    axis(svg.append('g').attr('transform', `translate(0,${m.t - 4})`), ax);
    svg.select('.domain').remove();
    // a faint line between books
    svg.append('g').selectAll('line').data(data.filter((d, i) => i && d.first)).join('line')
      .attr('x1', 0).attr('x2', w).attr('y1', (d) => m.t + data.indexOf(d) * rh).attr('y2', (d) => m.t + data.indexOf(d) * rh)
      .attr('stroke', 'var(--cds-chart-grid)');
    const g = svg.append('g').selectAll('g').data(data).join('g').attr('transform', (d, i) => `translate(0,${m.t + i * rh})`);
    const col = (d) => READ[d.kind][0], bw = (d) => Math.max(4, x1(d.end) - x0(d.start));
    g.append('rect').attr('x', (d) => x0(d.start)).attr('y', 4).attr('height', rh - 8).attr('rx', 3).attr('width', bw)
      .attr('fill', col).attr('fill-opacity', (d) => (d.active && d.active.length ? 0.22 : 1));
    g.each(function (d) {
      if (!d.active || !d.active.length) return;
      d3.select(this).selectAll('rect.run').data(d.active).join('rect').attr('class', 'run')
        .attr('x', ([s]) => x0(s)).attr('y', 4).attr('height', rh - 8).attr('rx', 1.5)
        .attr('width', ([s, e]) => Math.max(1.5, x1(e) - x0(s))).attr('fill', col(d));
    });
    g.append('text').attr('class', 'axl').attr('y', rh / 2).attr('dy', '0.35em')
      .each(function (d) {
        const t = d3.select(this).text((d.read_no > 1 ? '↻ ' : '') + (d.b.series_no != null ? '#' + d.b.series_no + ' ' : '') + d.title);
        const xs = x0(d.start), xe = xs + bw(d) + 5, len = this.getComputedTextLength();
        if (xe + len < w) t.attr('x', xe); else if (xs - 5 - len > 0) t.attr('x', xs - 5).attr('text-anchor', 'end'); else t.attr('x', 4).style('fill', 'var(--color-fg)');
      });
    g.append('rect').attr('width', w).attr('height', rh).attr('fill', 'transparent').each(function (d) { linkBook(this, d.book_id); })
      .on('mousemove', (e, d) => showTip(tip, box, e, (t) => {
        const opened = d.active ? d3.sum(d.active, ([a, b]) => span(a, b)) : d.days_read;
        const lines = [[col(d), READ[d.kind][1], d.read_no > 1 ? `read ${d.read_no}` : ''], [null, 'From', fDay(pDate(d.start))], [null, 'To', fDay(pDate(d.end))],
          [null, 'Opened on', `${fmt(opened)} of ${plural(span(d.start, d.end), 'day')}`]];
        if (d.hours) lines.push([null, 'Hours', String(d.hours)]);
        lines.push([null, 'Reached', pct(d.progress)]);
        if (d.prev) lines.push([null, 'Started', `${dur(span(d.prev.end, d.start) - 1)} after ${d.prev.book_id === d.book_id ? 'the last read' : (d.prev.b.series_no != null ? '#' + d.prev.b.series_no : d.prev.title)}`]);
        tipLines(t, (d.b.series_no != null ? '#' + d.b.series_no + ' ' : '') + d.title, lines);
      }))
      .on('mouseleave', () => hideTip(tip));
  }

  rh.register('series', { draw });
})();
