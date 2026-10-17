// year-end forecast with a ghost of last year to race, and how long an author's or
// series' unfinished books would take at your pace
(() => {
  const { el, fmt, pDate, fDay, plural } = rh;
  const DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z'), iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  dash.calc('forecast', {
    inputs: ['reads', 'daily', 'as_of'], title: 'Year-end forecast',
    description: 'This year so far, last year by the same date (the ghost), and a projection to 31 December at the pace of the last 365 days, with a rough 80% band from how much your 30-day pace varies.',
    fn: (reads, daily, as_of) => {
      if (!as_of[0]?.date) return []; // no books yet
      const end = as_of[0].date, Y = +end.slice(0, 4), first = Y + '-01-01', last = Y + '-12-31';
      const left = (t(last) - t(end)) / DAY;
      const fin = reads.filter((r) => r.finished === true && r.end);
      const logStart = daily.reduce((m, d) => (d.date < m ? d.date : m), end);
      const metrics = [
        ['books', 'Books finished', fin.map((r) => [r.end, 1])],
        ['hours', 'Hours read', daily.filter((d) => d.minutes).map((d) => [d.date, d.minutes / 60])],
        ['words', 'Words read', daily.filter((d) => d.words).map((d) => [d.date, d.words])],
      ];
      return metrics.map(([metric, label, items]) => {
        const by = new Map();
        items.forEach(([d, v]) => by.set(d, (by.get(d) || 0) + v));
        const sumTo = (a, b) => { let s = 0; by.forEach((v, d) => { if (d >= a && d <= b) s += v; }); return s; };
        // pace: the last 365 days (or since the log began, for books the reads), per day
        const from = metric === 'books' ? iso(t(end) - 364 * DAY) : [iso(t(end) - 364 * DAY), logStart].sort()[1];
        const span = (t(end) - t(from)) / DAY + 1, rate = sumTo(from, end) / span;
        // how much a 30-day stretch varies, over the last two years
        const wins = [];
        for (let e = t(end); e - 29 * DAY >= Math.max(t(end) - 729 * DAY, t(metric === 'books' ? '0000-01-01' : logStart)); e -= DAY) wins.push(sumTo(iso(e - 29 * DAY), iso(e)) / 30);
        wins.sort((a, b) => a - b);
        const q = (p) => wins[Math.min(wins.length - 1, Math.floor(p * wins.length))];
        const spread = wins.length >= 30 ? (q(0.9) - q(0.1)) / 2 : null;
        // cumulative this year and last year, day by day (last year matched by month and day)
        const ytd = sumTo(first, end), ghostYtd = sumTo(Y - 1 + '-01-01', Y - 1 + end.slice(4)), ghostTotal = sumTo(Y - 1 + '-01-01', Y - 1 + '-12-31');
        const prevDays = [...by.entries()].filter(([d]) => d.startsWith(String(Y - 1))).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const curDays = [...by.entries()].filter(([d]) => d.startsWith(String(Y))).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const series = [];
        let cur = 0, ghost = 0, ci = 0, gi = 0;
        for (let ms = t(first); ms <= t(last); ms += DAY) {
          const d = iso(ms), md = d.slice(5);
          while (ci < curDays.length && curDays[ci][0] <= d) cur += curDays[ci++][1];
          while (gi < prevDays.length && prevDays[gi][0].slice(5) <= md) ghost += prevDays[gi++][1];
          const row = { date: d, cur: d <= end ? cur : null, ghost };
          if (d >= end) {
            const k = (ms - t(end)) / DAY, mid = ytd + k * rate;
            const w = spread == null ? 0 : k * spread * Math.sqrt(30 / Math.max(k, 30));
            Object.assign(row, { proj: mid, lo: Math.max(ytd, mid - w), hi: mid + w });
          }
          series.push(row);
        }
        const tail = series[series.length - 1];
        return {
          metric, label, year: Y, as_of: end, days_left: left, ytd, ghost_ytd: ghostYtd, ghost_total: ghostTotal,
          has_ghost: prevDays.length > 0, rate_per_day: rate, proj: tail.proj, lo: tail.lo, hi: tail.hi, banded: spread != null, series,
        };
      });
    },
  });

  dash.calc('unfinished', {
    inputs: ['books', 'daily', 'as_of'], title: 'Unfinished books',
    description: 'Books not finished (in progress or not started) with an estimate of the words left, plus your minutes per day over the last 365 days. A book’s length is estimated from what you have read of it, or the median length of the books you have finished.',
    fn: (books, daily, as_of) => {
      const end = as_of[0].date;
      const lengths = books.filter((b) => b.status === 'finished' && b.words > 0 && b.times_read > 0).map((b) => b.words / b.times_read).sort((a, b) => a - b);
      const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : null;
      const mins = daily.filter((d) => t(end) - t(d.date) < 365 * DAY).reduce((a, d) => a + (d.minutes || 0), 0);
      return books.filter((b) => b.status === 'in_progress' || b.status === 'not_started').map((b) => {
        const p = b.status === 'in_progress' ? b.progress || 0 : 0;
        const done = (b.times_read > 1 ? b.times_read - 1 : 0) + p / 100;
        const measured = b.words > 0 && p >= 5;
        const length = measured ? b.words / done : median;
        return {
          id: b.id, title: b.title, author: b.author, series: b.series, series_no: b.series_no, status: b.status, progress: p,
          length: length && Math.round(length), words_left: length && Math.round(length * (1 - p / 100)), estimated: !measured,
          mins_per_day: Math.round(mins / 365 * 10) / 10,
        };
      });
    },
  });

  // ---------- the race chart ----------
  const show = { books: (v) => fmt(Math.round(v)), hours: (v) => fmt(Math.round(v)), words: (v) => (!v ? '0' : v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : fmt(Math.round(v / 1000)) + 'k') };
  const unit = { books: ['book', 'books'], hours: ['hour', 'hours'], words: ['word', 'words'] };
  const nUnit = (m, v) => `${show[m](v)} ${m === 'words' ? 'words' : unit[m][Math.round(v) === 1 ? 0 : 1]}`;
  let metric = 'books';

  function headline(f) {
    const m = f.metric, box = el('p', 'fc-take');
    const proj = Math.round(f.proj), lo = Math.round(f.lo), hi = Math.round(f.hi);
    if (f.days_left <= 0) box.append(`${nUnit(m, f.ytd)} in ${f.year}.`);
    else {
      box.append('On track for about ', el('b', null, nUnit(m, f.proj)));
      if (f.banded && hi > lo) box.append(` (likely ${show[m](lo)}–${show[m](hi)})`);
      box.append(` by 31 December.`);
    }
    if (f.has_ghost) {
      const d = f.ytd - f.ghost_ytd, same = m === 'books' ? Math.round(d) === 0 : Math.abs(d) < f.ghost_ytd * 0.01;
      const lead = same ? ` Level with ${f.year - 1} at this point` : ` ${nUnit(m, Math.abs(d))} ${d > 0 ? 'ahead of' : 'behind'} ${f.year - 1}'s ghost`;
      box.append(lead + `, which finished on ${nUnit(m, f.ghost_total)}.`);
      if (f.ytd > f.ghost_total) box.append(` You’ve already passed its whole year.`);
      else if (f.days_left > 0) {
        const beat = f.proj > f.ghost_total;
        box.append(beat ? ' At this pace you’ll beat it' : ` To catch it you’d need ${show[m]((f.ghost_total - f.ytd) / f.days_left * (m === 'hours' ? 60 : 1))}${m === 'hours' ? ' minutes' : m === 'books' ? ' books' : ' words'} a day`);
        if (beat) {
          const pass = f.series.find((r) => r.proj != null && r.proj > f.ghost_total);
          box.append(pass ? ` around ${fDay(pDate(pass.date))}.` : '.');
        } else box.append('.');
      }
    }
    return box;
  }

  function race(box, f) {
    const h = 260, { svg, w, tip } = rh.svgIn(box, h), m = { t: 12, r: 12, b: 24, l: 44 };
    const s = f.series, x = d3.scaleUtc([pDate(s[0].date), pDate(s[s.length - 1].date)], [m.l, w - m.r]);
    const top = d3.max(s, (r) => Math.max(r.ghost, r.hi ?? 0, r.cur ?? 0)) || 1;
    const y = d3.scaleLinear([0, top], [h - m.b, m.t]).nice();
    rh.axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickFormat(show[f.metric]).tickSize(-(w - m.l - m.r)));
    svg.select('.domain').remove();
    rh.axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(w < 500 ? 4 : 12).tickFormat(d3.utcFormat(w < 500 ? '%b' : '%b')).tickSizeOuter(0));
    const X = (r) => x(pDate(r.date));
    const fut = s.filter((r) => r.proj != null);
    if (f.banded && fut.length > 1) svg.append('path').attr('class', 'fc-band').attr('d', d3.area().x(X).y0((r) => y(r.lo)).y1((r) => y(r.hi))(fut));
    if (f.has_ghost) svg.append('path').attr('class', 'fc-ghost').attr('d', d3.line().x(X).y((r) => y(r.ghost)).curve(d3.curveStepAfter)(s));
    if (fut.length > 1) svg.append('path').attr('class', 'fc-proj').attr('d', d3.line().x(X).y((r) => y(r.proj))(fut));
    const past = s.filter((r) => r.cur != null);
    const curPath = svg.append('path').attr('class', 'fc-cur').attr('d', d3.line().x(X).y((r) => y(r.cur)).curve(d3.curveStepAfter)(past));
    const now = past[past.length - 1];
    if (now) {
      svg.append('circle').attr('class', 'fc-now').attr('cx', X(now)).attr('cy', y(now.cur)).attr('r', 4);
      if (f.has_ghost) svg.append('circle').attr('class', 'fc-ghost-dot').attr('cx', X(now)).attr('cy', y(now.ghost)).attr('r', 3.5);
    }
    // draw the year so far in, once, unless motion is reduced
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !box.dataset.drawn) {
      const len = curPath.node().getTotalLength();
      curPath.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len).transition().duration(1200).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0).on('end', () => curPath.attr('stroke-dasharray', null));
    }
    box.dataset.drawn = '1';
    // hover: the day's numbers
    const guide = svg.append('line').attr('class', 'fc-guide').attr('y1', m.t).attr('y2', h - m.b).style('display', 'none');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (e) => {
        const d = iso(+x.invert(d3.pointer(e)[0])), r = s.find((z) => z.date === d) || s[s.length - 1];
        guide.attr('x1', X(r)).attr('x2', X(r)).style('display', null);
        const lines = [];
        if (r.cur != null) lines.push(['var(--series-1)', String(f.year), show[f.metric](r.cur)]);
        if (r.proj != null && r.date > f.as_of) lines.push(['var(--series-1)', 'Projected', show[f.metric](r.proj) + (f.banded ? ` (${show[f.metric](r.lo)}–${show[f.metric](r.hi)})` : '')]);
        if (f.has_ghost) lines.push(['var(--cds-chart-muted)', String(f.year - 1), show[f.metric](r.ghost)]);
        rh.showTip(tip, box, e, (tp) => rh.tipLines(tp, fDay(pDate(r.date)), lines));
      })
      .on('mouseleave', () => { guide.style('display', 'none'); rh.hideTip(tip); });
  }

  function legend(f) {
    const lg = el('div', 'legend fc-legend');
    const item = (cls, txt) => { const s = el('span'); s.append(el('i', 'fc-key ' + cls), txt); return s; };
    lg.append(item('k-cur', String(f.year)), item('k-proj', f.banded ? 'Projection and likely range' : 'Projection'));
    if (f.has_ghost) lg.append(item('k-ghost', `${f.year - 1} (the ghost)`));
    return lg;
  }

  // the card body; also used on the current year's page
  function drawForecast(box, rows, sel) {
    const f = rows.find((r) => r.metric === metric) || rows[0];
    if (sel) sel.value = f.metric;
    const chart = el('div', 'chart fc-chart');
    box.replaceChildren(headline(f), legend(f), chart);
    race(chart, f);
  }
  function picker(onChange) {
    const sel = el('select', 'rng-sel');
    sel.setAttribute('aria-label', 'Measure');
    [['books', 'Books'], ['hours', 'Hours'], ['words', 'Words']].forEach(([v, n]) => { const o = el('option', null, n); o.value = v; sel.append(o); });
    sel.addEventListener('change', () => { metric = sel.value; onChange(); });
    return sel;
  }

  let overviewSel = null;
  rh.card({
    tab: 'overview', id: 'forecast', title: 'Year-end forecast', calc: 'forecast', before: 'card-years',
    note: 'This year so far against last year, and where you’re heading at the pace of your last 365 days. The band is a rough 80% range, from how much a month’s reading varies.',
    draw(box, rows, parts) {
      if (!overviewSel) { overviewSel = picker(() => rh.redraw()); parts.head.append(overviewSel); }
      parts.h.textContent = `Year-end forecast for ${rows[0].year}`;
      drawForecast(box, rows, overviewSel);
    },
  });

  // the current year's page gets the same race
  rh.extend('year', (id, root) => {
    const r = dash.data('forecast');
    if (r.status !== 'ok' || !r.data.length || String(r.data[0].year) !== String(id) || r.data[0].days_left <= 0) return;
    const c = el('div', 'rh-card wide'), head = el('div', 'card-head'), box = el('div');
    const sel = picker(() => drawForecast(box, r.data, sel));
    head.append(el('h2', null, 'Forecast and ghost'), sel);
    c.append(head, el('p', 'note', `Where ${id} is heading at the pace of your last 365 days, against ${id - 1}.`), box);
    const kp = root.querySelector('.yr-kpis');
    if (kp) kp.after(c); else root.append(c);
    drawForecast(box, r.data, sel);
  });

  // ---------- time left on an author or series ----------
  function timeLeft(root, books, what) {
    const u = dash.data('unfinished'), wpm = rh.avgWpm();
    if (u.status !== 'ok' || !wpm) return;
    const left = u.data.filter(books).filter((b) => b.words_left);
    if (!left.length) return;
    const words = d3.sum(left, (b) => b.words_left), minutes = words / wpm, perDay = left[0].mins_per_day;
    const asOf = dash.data('as_of').data[0].date;
    const c = el('div', 'rh-card wide fc-left'), k = el('div', 'rh-kpis');
    const kpi = (lbl, val, sub) => { const n = el('div', 'rh-kpi'); n.append(el('div', 'lbl', lbl), el('div', 'val', val)); if (sub) n.append(el('div', 'sub', sub)); return n; };
    k.append(kpi('Left to read', plural(left.length, 'book'), `about ${fmt(Math.round(words / 1000) * 1000)} words`));
    k.append(kpi('At your speed', minutes >= 90 ? `${fmt(Math.round(minutes / 60))} h` : `${Math.round(minutes)} min`, `${fmt(wpm)} words a minute`));
    if (perDay > 0) {
      const days = Math.ceil(minutes / perDay);
      k.append(kpi('At your pace', plural(days, 'day'), `${fmt(perDay)} min a day → ${fDay(new Date(t(asOf) + days * DAY))}`));
    }
    c.append(el('h2', null, `Time left on ${what}`));
    c.append(el('p', 'note', 'The unfinished books in your library, at your average reading speed and the minutes a day you’ve read over the last year, if you read nothing else.' + (left.some((b) => b.estimated) ? ' Books marked ≈ haven’t been read enough to measure, so they’re taken as your typical book length.' : '')), k);
    const ul = el('ul', 'rh-list fc-list');
    left.sort((a, b) => (a.series_no ?? 0) - (b.series_no ?? 0) || b.progress - a.progress).forEach((b) => {
      const li = rh.linkBook(el('li'), b.id), ttl = el('div', 'ttl');
      ttl.append(document.createTextNode((b.series_no != null ? `#${b.series_no} ` : '') + b.title));
      ttl.append(el('small', null, b.status === 'in_progress' ? `${Math.round(b.progress)}% read` : 'not started'));
      li.append(ttl, el('div', 'meta', `${b.estimated ? '≈ ' : ''}${fmt(Math.round(b.words_left / wpm / 60 * 10) / 10)} h`));
      ul.append(li);
    });
    c.append(ul);
    root.append(c);
  }
  rh.extend('author', (name, root) => timeLeft(root, (b) => b.author === name, name));
  rh.extend('series', (name, root) => timeLeft(root, (b) => b.series === name, 'the series'));
})();
