// Page-level views from data/sessions.json (KOReader's page-by-page statistics; docs/api.md):
// when in the week you read and how long you sit, speed and time left per book, and the page
// by page course of each book. They cover only what that file has and say from when; nothing
// here is estimated from the daily log, and nothing here feeds it.
(() => {
  const { el, fmt, pDate, fDay, C, MARK, svgIn, axis, showTip, hideTip, tipLines, mins, plural, ref } = rh;
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hh = (h) => String(h % 24).padStart(2, '0') + ':00';
  // KOReader stops timing a page at 2 minutes by default, so a stay that long is "or more"
  const CAPPED_MINUTES = 1.9;

  // an object, or [] when there's no file or the viewer doesn't get it
  dash.file('sessions', 'data/sessions.json', { optional: true });

  dash.calc('sessions_overview', {
    inputs: ['sessions', 'books'], title: 'Sessions and time of day',
    description: 'From KOReader\'s page turns only: minutes by weekday and hour; and how many sessions, how many per day that had one, the median length and the longest.',
    fn: (file, books) => {
      const c = file?.coverage;
      if (!c?.since) return [];
      const titles = new Map(books.map((b) => [b.id, b.title]));
      const list = file.sessions || [];
      const lengths = list.map((s) => s.minutes).sort((a, b) => a - b), n = lengths.length;
      const days = new Set(list.map((s) => s.start.slice(0, 10))).size;
      const top = list.reduce((a, s) => (!a || s.minutes > a.minutes ? s : a), null);
      const grid = file.time_of_day || [];
      return [{
        since: c.since, until: c.until, sessions_since: c.sessions_since, gap: file.session_gap_minutes,
        grid, minutes: Math.round(grid.flat().reduce((s, v) => s + v, 0)),
        sessions: n, session_days: days,
        per_day: days ? Math.round((n / days) * 10) / 10 : null,
        median: n ? Math.round(((lengths[(n - 1) >> 1] + lengths[n >> 1]) / 2) * 10) / 10 : null,
        longest: top ? { minutes: top.minutes, date: top.start.slice(0, 10), book_id: top.book_id, title: titles.get(top.book_id) || top.book_id } : null,
      }];
    },
  });

  dash.calc('page_books', {
    inputs: ['sessions'], title: 'Page-level reading by book',
    description: 'For each book KOReader timed page by page: speed, time left, progress, pages read again and long stays on a page.',
    fn: (file) => (file?.books || []).map((b) => ({ ...b, recent_days: file.recent_days })),
  });

  const bookRow = (id) => {
    const r = dash.data('page_books');
    return r.status === 'ok' ? r.data.find((x) => x.book_id === id) : null;
  };

  const day = (s) => fDay(pDate(s));
  // every view says where its data starts
  const coverage = (since) => `Page-level data since ${day(since)}, from KOReader`;

  // ---------- speed and time left ----------
  const left = (m) => (m < 60 ? `~${Math.max(5, Math.round(m / 5) * 5)}\u00a0min left` : `~${fmt(Math.round(m / 60))}\u00a0h left`);
  const localToday = () => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  };
  // "by Friday", "by 29 Jan"; null with no date, or one already past (it's worked out at build time)
  function finishBy(finish) {
    if (!finish) return null;
    const today = localToday(), d = pDate(finish);
    // visitors may get only the week or month it falls in
    if (dash.dates) {
      const end = dash.dates === 'month' ? d3.utcMonth.offset(d, 1) : d3.utcDay.offset(d, 7);
      return end > today ? `around ${fDay(d)}` : null;
    }
    const n = d3.utcDay.count(today, d);
    if (n < 0) return null;
    if (n === 0) return 'today';
    if (n === 1) return 'by tomorrow';
    if (n < 7) return `by ${WEEKDAY[d.getUTCDay()]}`;
    return `by ${d3.utcFormat(d.getUTCFullYear() === today.getUTCFullYear() ? '%-d %b' : '%-d %b %Y')(d)}`;
  }
  const speed = (b) => `${fmt(b.minutes_per_page)} min a page · ${fmt(Math.round(b.pages_per_hour))} pages an hour`;

  // on the Overview's "On the go" card (the book page has the card below instead)
  rh.goFact((r, where) => {
    const b = where !== 'book' && bookRow(r.id);
    if (!b || b.minutes_per_page == null) return [];
    const by = b.eta && finishBy(b.eta.finish);
    const time = b.eta && left(b.eta.minutes_left) + (by ? ` · ${by} at your recent pace` : '');
    if (where === 'list') return time ? [{ k: '', v: `${left(b.eta.minutes_left)} by page speed (KOReader since ${day(b.since)})`, cls: 'pt', title: `${time}. ${speed(b)}. ${coverage(b.since)}.` }] : [];
    return [
      { k: 'Page speed', v: `${fmt(b.minutes_per_page)} min/page`, cls: 'pt', title: speed(b) },
      ...(time ? [{ k: 'By pages', v: left(b.eta.minutes_left) + (by ? ` · ${by}` : ''), cls: 'pt', title: by ? `${time}, from your page speed` : 'From your page speed' }] : []),
      { k: 'Pages from', v: `KOReader, ${day(b.since)}`, cls: 'pt', title: coverage(b.since) },
    ];
  });

  const stat = (value, label) => {
    const d = el('div');
    d.append(el('b', null, value), el('span', null, label));
    return d;
  };
  // a book card that shows only for books with page data
  function pageCard(o) {
    rh.bookCard({
      ...o, calc: 'page_books',
      draw(box, rows, parts, book) {
        const b = rows.find((x) => x.book_id === book.id);
        if (!b) return false;
        box.replaceChildren();
        box.style.minHeight = '0';
        parts.note.hidden = false;
        parts.note.textContent = `${coverage(b.since)}${b.until !== b.since ? `, to ${day(b.until)}` : ''}. Reading in other apps isn’t in it.`;
        return o.fill(box, b);
      },
    });
  }

  pageCard({
    id: 'bk-speed', title: 'Speed and time left', after: 'card-bk-eta',
    fill(box, b) {
      if (b.minutes_per_page == null) {
        box.append(el('p', 'pt-line', 'Too few timed pages yet to give a speed.'));
        return;
      }
      const e = b.eta;
      if (e) {
        const by = finishBy(e.finish), take = el('p', 'pt-take');
        take.append(el('b', null, left(e.minutes_left)));
        if (by) take.append(' · ', el('b', null, by), ' at your recent pace');
        box.append(take);
        box.append(el('p', 'pt-why', by
          ? `The date assumes your average over the ${b.recent_days} days before it was worked out: ${mins(e.minutes_per_day)} a day on this book in KOReader.`
          : e.finish ? 'The date estimated from your pace has passed, so none is shown.'
            : e.recent_minutes ? 'At your recent pace it’s too far off to name a date.'
              : `No reading of it in KOReader in the last ${b.recent_days} days, so there’s no finish date.`));
      }
      const stats = el('div', 'dy-sum pt-stats');
      stats.append(stat(fmt(b.minutes_per_page), 'minutes per page'), stat(fmt(Math.round(b.pages_per_hour)), 'pages per hour'), stat(mins(b.minutes), 'timed on its pages'));
      if (e) stats.append(stat(fmt(b.pages_left), `pages left of ${fmt(b.total_pages)}`));
      box.append(stats);
    },
  });

  // ---------- page by page ----------
  const stayed = (s) => (s.minutes >= CAPPED_MINUTES ? `${fmt(s.minutes)} min or more` : `${fmt(s.minutes)} min`);
  const pages = ([from, to]) => (from === to ? `p. ${from}` : `pp. ${from}–${to}`);

  pageCard({
    id: 'bk-pages', title: 'Page by page', after: 'card-bk-days',
    fill(box, b) {
      if (!b.total_pages) return false;
      const at = (page) => (page / b.total_pages) * 100;
      const parse = d3.utcParse('%Y-%m-%dT%H:%M'), pts = b.progress.map(([t, p]) => ({ t: parse(t), p }));
      if (pts.length > 1) curve(box, b, pts, at);
      else box.append(el('p', 'pt-line', pts.length ? 'Only one page turn so far: not enough for a curve.' : 'The page-by-page curve isn’t available here.'));
      marks(box, b);
    },
  });

  function curve(box, b, pts, at) {
    const legend = el('div', 'legend');
    const key = (cls, text) => {
      const s = el('span');
      s.append(el('i', 'pt-key ' + cls), text);
      return s;
    };
    legend.append(key('line', 'How far you were'));
    if (b.stalls.length) legend.append(key('stall', 'Long stay on a page'));
    if (b.reread.ranges.length) legend.append(key('again', 'Read again (right edge)'));
    const plot = el('div', 'pt-plot');
    box.append(legend, plot);

    const h = plot.clientWidth < 520 ? 200 : 240, { svg, w, tip } = svgIn(plot, h), m = { t: 8, r: 18, b: 24, l: 40 };
    const x = d3.scaleUtc(d3.extent(pts, (d) => d.t), [m.l, w - m.r]);
    const y = d3.scaleLinear([0, 100], [h - m.b, m.t]);
    const grid = svg.append('g').attr('transform', `translate(${m.l},0)`);
    axis(grid, d3.axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickFormat((v) => v + '%').tickSize(-(w - m.l - m.r)));
    grid.select('.domain').remove();
    // whole days only; a book read within a day or two gets clock times instead
    const [from, to] = x.domain(), span = (to - from) / 864e5, fit = Math.max(2, Math.floor(w / 90));
    const xa = d3.axisBottom(x).tickSizeOuter(0);
    if (span > 2) xa.ticks(span / fit <= 1 ? d3.utcDay : fit).tickFormat(d3.utcFormat(span > 300 ? '%b %y' : '%-d %b'));
    else xa.ticks(fit).tickFormat(d3.utcFormat(span < 1 ? '%H:%M' : '%-d %b %H:%M'));
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), xa);

    // level between page turns: nothing is read while the book is shut
    svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', C[0]).attr('stroke-width', MARK.line).attr('stroke-linejoin', 'round')
      .attr('d', d3.line((d) => x(d.t), (d) => y(d.p)).curve(d3.curveStepAfter)).call(rh.drawIn);

    // pages gone back to: ticks on a rail at the right, at their place in the book
    const rail = w - m.r + 6;
    svg.append('line').attr('class', 'pt-rail').attr('x1', rail + 4).attr('x2', rail + 4).attr('y1', y(100)).attr('y2', y(0));
    svg.append('g').selectAll('rect').data(b.reread.ranges).join('rect').attr('class', 'pt-again')
      .attr('x', rail).attr('width', 8).attr('rx', 1)
      .attr('y', (r) => y(at(r[1]))).attr('height', (r) => Math.max(2, y(at(r[0] - 1)) - y(at(r[1]))));

    // stalls: a ring where that page was read, found among that day's points
    const stalls = b.stalls.map((s) => {
      const p = at(s.page), same = pts.filter((d) => d3.utcFormat('%Y-%m-%d')(d.t) === s.date);
      const near = d3.least(same, (d) => Math.abs(d.p - p));
      const t = near ? near.t : new Date(Math.min(+to, Math.max(+from, +pDate(s.date) + 432e5)));
      return { ...s, cx: x(t), cy: y(p) };
    });
    svg.append('g').selectAll('circle').data(stalls).join('circle').attr('class', 'pt-stall')
      .attr('cx', (s) => s.cx).attr('cy', (s) => s.cy).attr('r', MARK.dot - 0.5);

    const focus = svg.append('circle').attr('class', 'ring').attr('r', MARK.dot).attr('fill', C[0]).style('display', 'none');
    const bisect = d3.bisector((d) => d.t).right;
    const hide = () => { hideTip(tip); focus.style('display', 'none'); };
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r + 18).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (e) => {
        const [mx, my] = d3.pointer(e);
        if (mx > w - m.r) {
          const r = d3.least(b.reread.ranges, (g) => Math.abs(y(at((g[0] + g[1]) / 2)) - my));
          focus.style('display', 'none');
          if (r) showTip(tip, plot, e, (t) => tipLines(t, pages(r), [[null, 'Read', `${r[2]} times`]]));
          return;
        }
        const stall = d3.least(stalls, (s) => Math.hypot(s.cx - mx, s.cy - my));
        if (stall && Math.hypot(stall.cx - mx, stall.cy - my) < 9) {
          focus.style('display', 'none');
          showTip(tip, plot, e, (t) => tipLines(t, day(stall.date), [[null, 'Page', fmt(stall.page)], [null, 'On it', stayed(stall)]]));
          return;
        }
        const d = pts[Math.max(0, bisect(pts, x.invert(mx)) - 1)];
        focus.style('display', null).attr('cx', x(d.t)).attr('cy', y(d.p));
        showTip(tip, plot, e, (t) => tipLines(t, d3.utcFormat('%a %-d %b %Y, %H:%M')(d.t), [
          [C[0], 'Progress', `${fmt(d.p)}%`], [null, 'Page', `${fmt(Math.round((d.p / 100) * b.total_pages))} of ${fmt(b.total_pages)}`]]));
      })
      .on('mouseleave', hide);

    plot.setAttribute('role', 'img');
    plot.setAttribute('aria-label', `Progress through the book from ${fmt(pts[0].p)}% on ${day(b.since)} to ${fmt(pts[pts.length - 1].p)}% on ${day(b.until)}`);
  }

  // the same marks in words, for the keyboard and for those who'd rather read them
  function marks(box, b) {
    const again = b.reread.pages, n = b.stalls.length;
    if (!again && !n) return;
    const d = el('details', 'pt-details');
    d.append(el('summary', null, [again && `${plural(again, 'page')} read again`, n && `${plural(n, 'long stay')} on a page`].filter(Boolean).join(' · ')));
    if (again) {
      const shown = b.reread.ranges.map((r) => pages(r) + (r[2] > 2 ? ` (${r[2]} times)` : ''));
      d.append(el('h3', null, 'Read again'), el('p', null, shown.join(', ')));
    }
    if (n) {
      const list = el('ul');
      b.stalls.forEach((s) => list.append(el('li', null, `p. ${s.page} · ${stayed(s)} · ${day(s.date)}`)));
      d.append(el('h3', null, n >= 20 ? 'The 20 longest stays' : 'Long stays'), list);
    }
    d.append(el('p', 'pt-why', `Page numbers are in the ${fmt(b.total_pages)}-page layout you last used.`));
    box.append(d);
  }

  // ---------- sessions and time of day ----------
  rh.card({
    tab: 'timeline', id: 'sessions', title: 'Sessions and time of day', calc: 'sessions_overview', after: 'card-week',
    hidden: () => { const r = rh.D('sessions_overview'); return r.status === 'ok' && !r.data.length; },
    draw(box, rows, parts) {
      const o = rows[0];
      if (!o) return;
      parts.note.hidden = false;
      parts.note.textContent = `${coverage(o.since)}, to ${day(o.until)}. Other reading isn’t in it, and isn’t estimated.`;
      box.replaceChildren();
      box.style.minHeight = '0';

      if (o.sessions) {
        const stats = el('div', 'dy-sum pt-stats');
        const longest = stat(mins(o.longest.minutes), 'longest: ');
        longest.lastChild.append(ref(o.longest, 'title'), `, ${day(o.longest.date)}`);
        stats.append(stat(fmt(o.per_day), 'sessions per day read in KOReader'), stat(mins(o.median), 'typical session (median)'), longest,
          stat(fmt(o.sessions), `${o.sessions === 1 ? 'session' : 'sessions'} over ${plural(o.session_days, 'day')}`));
        box.append(stats);
      }

      const plot = el('div', 'pt-plot');
      box.append(el('h3', 'pt-h', 'Minutes by weekday and hour'), plot);
      heat(plot, o);

      const foot = [o.sessions && `A session ends after ${o.gap} minutes without a page turn.`,
        o.sessions && o.sessions_since > o.since && `Session figures start ${day(o.sessions_since)}; the grid has everything.`].filter(Boolean);
      if (foot.length) box.append(el('p', 'pt-why', foot.join(' ')));
      table(box, o);
    },
  });

  function heat(plot, o) {
    const lab = 30, top = 4, ax = 18, w0 = Math.max(280, plot.clientWidth);
    const cw = (w0 - lab) / 24, ch = Math.max(16, Math.min(24, cw)), h = top + 7 * ch + ax;
    const { svg, tip } = svgIn(plot, h);
    const cells = o.grid.flatMap((row, d) => row.map((v, hour) => ({ d, hour, v })));
    const max = d3.quantile(cells.map((c) => c.v).filter((v) => v > 0).sort(d3.ascending), 0.95) || 1;
    const op = d3.scaleSqrt([0, max], [0.18, 1]).clamp(true);
    svg.append('g').selectAll('text').data(WD).join('text').attr('class', 'axl').attr('x', 0).attr('y', (n, i) => top + i * ch + ch / 2).attr('dy', '0.35em').text((n) => n);
    svg.append('g').selectAll('text').data(d3.range(0, 24, cw < 20 ? 6 : 3)).join('text').attr('class', 'axl')
      .attr('x', (hour) => lab + hour * cw).attr('y', h - 4).text((hour) => hh(hour));
    svg.append('g').selectAll('rect').data(cells).join('rect')
      .attr('x', (c) => lab + c.hour * cw + 1).attr('y', (c) => top + c.d * ch + 1)
      .attr('width', cw - MARK.gap).attr('height', ch - MARK.gap).attr('rx', 2)
      .attr('fill', (c) => (c.v ? C[0] : 'var(--cds-chart-grid)')).attr('fill-opacity', (c) => (c.v ? op(c.v) : 1))
      .on('mousemove', (e, c) => showTip(tip, plot, e, (t) => tipLines(t, `${WD[c.d]} ${hh(c.hour)}–${hh(c.hour + 1)}`, [[null, 'Read', c.v ? mins(c.v) : 'nothing']])))
      .on('mouseleave', () => hideTip(tip));
    const best = cells.reduce((a, c) => (c.v > a.v ? c : a), cells[0]);
    plot.setAttribute('role', 'img');
    plot.setAttribute('aria-label', `Minutes read by weekday and hour. Most: ${WD[best.d]} ${hh(best.hour)} to ${hh(best.hour + 1)}. The table below has every hour.`);
    const legend = el('div', 'hm-legend');
    legend.append('Less');
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const i = el('i');
      i.style.background = f ? C[0] : 'var(--cds-chart-grid)';
      if (f) i.style.opacity = op(f * max);
      legend.append(i);
    });
    legend.append('More');
    plot.append(legend);
  }

  // the grid as a table (hours with any reading), kept open across redraws
  let tableOpen = false;
  function table(box, o) {
    const d = el('details', 'pt-details'), t = el('table', 'pt-table'), head = el('tr');
    d.open = tableOpen;
    d.addEventListener('toggle', () => { tableOpen = d.open; });
    d.append(el('summary', null, 'The same as a table'));
    head.append(el('th', null, 'Hour'), ...WD.map((n) => el('th', 'n', n)));
    const thead = el('thead'), body = el('tbody');
    thead.append(head);
    d3.range(24).filter((hour) => o.grid.some((row) => row[hour])).forEach((hour) => {
      const tr = el('tr');
      tr.append(el('td', null, hh(hour)), ...o.grid.map((row) => el('td', 'n', row[hour] ? fmt(Math.round(row[hour])) : '·')));
      body.append(tr);
    });
    t.append(thead, body);
    d.append(el('p', 'pt-why', 'Minutes read in each hour.'), t);
    box.append(d);
  }
})();
