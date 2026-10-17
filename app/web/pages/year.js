// year page: #year/<YYYY> — a year in reading
(() => {
  const { D, el, fmt, pDate, iso, fDay, fShort, C, gColor, linkBook, linkPage, mins, pct, plural, span, speedFrom, avgWpm, vsAvg } = rh;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ok = (id) => (D(id).status === 'ok' ? D(id).data : null);
  const low = (g) => (/[A-Z]{2}/.test(g) ? g : g.toLowerCase());
  const hrs = (m) => { const h = m / 60; return h < 10 ? Math.round(h * 10) / 10 : Math.round(h); };

  // daily rows grouped by book, rebuilt only when the data changes
  let cacheSrc = null, byBook = new Map();
  function dailyByBook(daily) {
    if (daily !== cacheSrc) {
      cacheSrc = daily; byBook = new Map();
      daily.forEach((d) => { if (!byBook.has(d.book_id)) byBook.set(d.book_id, []); byBook.get(d.book_id).push(d); });
    }
    return byBook;
  }

  function kpi(lbl, val, sub, cls) {
    const k = el('div', 'rh-kpi'), v = el('div', 'val' + (val.length > 12 ? ' val-sm' : '') + (cls ? ' ' + cls : ''), val);
    k.append(el('div', 'lbl', lbl), v);
    if (sub) k.append(el('div', 'sub', sub));
    return k;
  }
  const cmpCls = (a, b) => (b == null || a === b ? '' : a > b ? 'up' : 'down');
  const card = (title, note, wide) => {
    const c = el('div', 'rh-card' + (wide ? ' wide' : ''));
    c.append(el('h2', null, title));
    if (note) c.append(el('p', 'note', note));
    return c;
  };
  function longestRun(dates) {
    let best = null, s = null, prev = null;
    dates.forEach((d) => {
      if (!prev || span(prev, d) !== 2) s = d;
      if (!best || span(s, d) > span(best[0], best[1])) best = [s, d];
      prev = d;
    });
    return best;
  }

  // a 12-month bar chart: each bar opens that month in the diary
  function monthChart(root, title, note, rows, color, unit) {
    const c = card(title, note), box = el('div', 'chart short yr-months');
    c.append(box); root.append(c);
    // drawn once every card is in the grid, so it's measured at its final width
    return () => drawMonths(box, rows, color, unit);
  }
  function drawMonths(box, rows, color, unit) {
    rh.vbars(box, rows, (r) => r.lbl, (r) => r.v, color, unit);
    const narrow = box.clientWidth < 420;
    d3.select(box).selectAll('svg > g > g:not(.tick)').each(function (d) {
      const g = d3.select(this);
      if (!d.v) g.select('text.lbl-in').text('');
      if (d.go) g.select('rect:last-of-type').attr('data-day', d.go);
    });
    if (narrow) d3.select(box).selectAll('.tick text').filter((s) => MONTHS.includes(s)).text((s) => s[0]);
  }

  function bookRow(r, meta, sub) {
    const li = linkBook(el('li'), r.book_id), t = el('div', 'ttl');
    li.append(rh.cover(r.book_id, r.title, r.genre, 'sm'));
    t.append(document.createTextNode((r.read_no > 1 ? '↻ ' : '') + r.title), el('small', null, sub));
    if (r.prog != null) { const pb = el('div', 'pbar'), i = el('i'); i.style.width = Math.min(100, r.prog) + '%'; i.style.background = gColor(r.genre); pb.append(i); t.append(pb); }
    li.append(t, el('div', 'meta', meta));
    return li;
  }
  function listBox(items) {
    const ul = el('ul', 'rh-list'); ul.append(...items);
    if (items.length <= 12) return ul;
    const box = el('div', 'tbl-box'); box.append(ul); return box;
  }

  function draw(id, root) {
    const books = ok('books');
    if (!books) { root.replaceChildren(el('div', 'dy-empty', 'Loading…')); return; }
    const reads = ok('reads') || [], daily = ok('daily') || [], asOfRow = (ok('as_of') || [])[0];
    const asOf = asOfRow ? asOfRow.date : null;
    const valid = /^\d{4}$/.test(String(id)), yr = valid ? +id : null, Y = String(id);
    rh.setTitle(valid ? Y : 'Year');

    // which years have anything at all
    const years = new Set();
    reads.forEach((r) => { if (r.start) years.add(+r.start.slice(0, 4)); if (r.end) years.add(+r.end.slice(0, 4)); });
    daily.forEach((d) => years.add(+d.date.slice(0, 4)));
    const ys = [...years].sort((a, b) => a - b);
    const prevY = valid ? ys.filter((y) => y < yr).pop() : null, nextY = valid ? ys.find((y) => y > yr) : null;

    // header
    const head = el('div', 'rh-card wide yr-head'), top = el('div', 'yr-top'), ttl = el('div');
    ttl.append(el('div', 'bk-title', valid ? Y : 'Year'), el('div', 'go-sub', 'Year in reading'));
    const nav = el('div', 'yr-nav');
    if (prevY != null) nav.append(linkPage(el('span', 'chip', '← ' + prevY), 'year', prevY));
    if (nextY != null) nav.append(linkPage(el('span', 'chip', nextY + ' →'), 'year', nextY));
    top.append(ttl, nav); head.append(top);
    const out = [head];

    if (!valid || !years.has(yr)) {
      out.push(el('div', 'dy-empty', `No reading recorded in ${valid ? Y : '“' + Y + '”'}.`));
      root.replaceChildren(...out); return;
    }

    const cur = asOf && +asOf.slice(0, 4) === yr, md = asOf ? asOf.slice(5) : '12-31';
    // compare like with like: in the current year, last year up to the same date
    const inPrev = (s) => s && +s.slice(0, 4) === yr - 1 && (!cur || s.slice(5) <= md);
    const inYr = (s) => s && +s.slice(0, 4) === yr;
    const prevHas = years.has(yr - 1);

    const fin = reads.filter((r) => r.finished === true && inYr(r.end)).sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
    const finPrev = reads.filter((r) => r.finished === true && inPrev(r.end)).length;
    const started = reads.filter((r) => inYr(r.start)).sort((a, b) => (a.start < b.start ? -1 : 1));
    const rereads = fin.filter((r) => r.read_no > 1);
    const days = daily.filter((d) => inYr(d.date)), daysPrev = prevHas ? daily.filter((d) => inPrev(d.date)) : [];
    const minutes = d3.sum(days, (d) => d.minutes || 0), minPrev = d3.sum(daysPrev, (d) => d.minutes || 0);
    const words = d3.sum(days, (d) => d.words || 0);
    const dates = [...new Set(days.map((d) => d.date))].sort();
    const firstLog = daily.length ? d3.min(daily, (d) => d.date) : null;
    const noLog = !minutes && !words;

    // genres of the books finished
    const gen = d3.rollups(fin, (v) => v.length, (r) => r.genre || 'Untagged').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    // takeaway
    const diff = fin.length - finPrev;
    let take = fin.length ? `${plural(fin.length, 'book')} finished${cur ? ' so far' : ''}` : `No books finished${cur ? ' yet' : ''}`;
    if (prevHas) take += `, ${diff === 0 ? 'level with' : fmt(Math.abs(diff)) + (diff > 0 ? ' more than' : ' fewer than')} ${cur ? 'this point in ' : ''}${yr - 1}`;
    if (gen.length && gen[0][1] > 1) take += `, mostly ${low(gen[0][0])}`;
    take += '.';
    if (minutes) take += ` ${fmt(Math.round(minutes / 60))} hours over ${plural(dates.length, 'day')}.`;
    head.append(el('p', 'rh-take', take));
    if (noLog && firstLog && Y < firstLog.slice(0, 4)) head.append(el('p', 'note yr-note', `Minutes and words are only logged from ${firstLog.slice(0, 4)}, so ${Y} shows the books you started and finished.`));
    else if (noLog) head.append(el('p', 'note yr-note', 'No minutes or words were logged this year, so it shows the books you started and finished.'));

    // headline figures
    const k = [];
    k.push(kpi(cur ? 'Finished so far' : 'Books finished', fmt(fin.length), prevHas ? `${fmt(finPrev)} ${cur ? 'by this point in' : 'in'} ${yr - 1}` : null, prevHas ? cmpCls(fin.length, finPrev) : ''));
    if (started.length) {
      const same = started.filter((r) => r.finished === true && inYr(r.end)).length;
      k.push(kpi('Reads started', fmt(started.length), cur ? (same ? `${fmt(same)} finished so far` : 'none finished yet') : `${fmt(same)} finished the same year`));
    }
    if (rereads.length) k.push(kpi('Re-reads', fmt(rereads.length), `of ${plural(fin.length, 'book')} finished`));
    if (minutes) k.push(kpi('Hours read', fmt(Math.round(minutes / 60)), prevHas && minPrev ? `${fmt(Math.round(minPrev / 60))} ${cur ? 'by this point in' : 'in'} ${yr - 1}` : `${fmt(Math.round(minutes / dates.length))} min per reading day`, prevHas && minPrev ? cmpCls(Math.round(minutes / 60), Math.round(minPrev / 60)) : ''));
    if (dates.length) {
      const total = cur ? span(Y + '-01-01', asOf) : span(Y + '-01-01', Y + '-12-31');
      k.push(kpi('Days read', fmt(dates.length), `of ${plural(total, 'day')} · ${Math.round(dates.length / total * 100)}%`));
      const run = longestRun(dates), n = span(run[0], run[1]);
      k.push(kpi('Longest streak', plural(n, 'day'), n > 1 ? `${fDay(pDate(run[0]))} – ${fDay(pDate(run[1]))}` : fDay(pDate(run[0]))));
    }
    if (words) k.push(kpi('Words read', fmt(words), dates.length ? `about ${fmt(Math.round(words / dates.length))} per reading day` : null));
    const sy = ok('speed_year') || [], sp = sy.find((r) => r.year === yr), spPrev = sy.find((r) => r.year === yr - 1);
    if (sp) {
      const avg = avgWpm();
      const sub = spPrev ? `${fmt(spPrev.wpm)} wpm in ${yr - 1}` : avg ? (Math.abs(sp.wpm / avg - 1) < 0.005 ? 'your average' : `${vsAvg(sp.wpm / avg - 1)} than average`) : null;
      k.push(kpi('Speed', `${fmt(sp.wpm)} wpm`, sub, spPrev ? cmpCls(sp.wpm, spPrev.wpm) : ''));
    }
    const tot = (ok('day_totals') || []).filter((d) => inYr(d.date) && d.minutes > 0);
    if (tot.length) {
      const big = tot.reduce((a, d) => (d.minutes > a.minutes ? d : a)), bk = kpi('Biggest day', mins(big.minutes), fDay(pDate(big.date)));
      bk.setAttribute('data-day', big.date); bk.tabIndex = 0; bk.title = 'Open in the diary';
      k.push(bk);
    }
    const kp = el('div', 'rh-kpis yr-kpis'); kp.append(...k); out.push(kp);
    root.replaceChildren(...out);

    // month by month (charts need to be in the DOM before drawing)
    const grid1 = el('div', 'rh-grid'); root.append(grid1);
    const mMin = d3.rollup(days, (v) => d3.sum(v, (d) => d.minutes || 0), (d) => +d.date.slice(5, 7));
    const mFin = d3.rollup(fin, (v) => v.length, (r) => +r.end.slice(5, 7));
    const monthRows = (fn) => MONTHS.map((lbl, i) => ({ lbl, v: fn(i + 1), go: Y + '-' + String(i + 1).padStart(2, '0') + '-01' }))
      .map((r) => ((cur && r.go > asOf) || (firstLog && r.go.slice(0, 7) < firstLog.slice(0, 7)) ? { ...r, go: null } : r));
    const later = [];
    if (minutes) later.push(monthChart(grid1, 'Hours per month', 'Time spent reading each month. Click a month to open it in the diary.', monthRows((m) => hrs(mMin.get(m) || 0)), C[0], 'Hours'));
    if (fin.length) later.push(monthChart(grid1, 'Books finished per month', noLog ? 'Reads that ended each month.' : 'Reads that ended each month, re-reads included. Click a month to open it in the diary.', monthRows((m) => mFin.get(m) || 0).map((r) => (noLog ? { ...r, go: null } : r)), C[2], 'Finished'));
    later.splice(0).forEach((f) => f());
    if (!grid1.children.length) grid1.remove();

    // the books
    const grid2 = el('div', 'rh-grid'); root.append(grid2);
    if (fin.length) {
      const c = card(cur ? 'Finished so far' : 'Books finished', `In the order you finished them. ↻ marks a re-read.`);
      c.append(listBox(fin.map((r) => bookRow(r, fDay(pDate(r.end)) + (r.hours ? ` · ${fmt(r.hours)} h` : ''), r.author || ''))));
      grid2.append(c);
    }
    const open = started.filter((r) => !(r.finished === true && inYr(r.end)));
    if (open.length) {
      const c = card('Started, not finished', `Reads begun in ${Y} that ${cur ? 'aren’t finished yet' : 'weren’t finished by the end of the year'}.`);
      c.append(listBox(open.map((r) => {
        const later = r.finished === true ? `finished ${fShort(pDate(r.end))}` : r.progress != null ? `got to ${pct(r.progress)}` : '';
        return bookRow({ ...r, prog: r.finished === true ? null : r.progress }, 'started ' + d3.utcFormat('%-d %b')(pDate(r.start)), [r.author, later].filter(Boolean).join(' · '));
      })));
      grid2.append(c);
    }
    if (!grid2.children.length) grid2.remove();

    // genres and authors
    if (fin.length) {
      const grid3 = el('div', 'rh-grid'); root.append(grid3);
      const gc = card('Genre mix', `Books finished in ${Y} by genre.`), gb = el('div', 'chart short');
      gc.append(gb); grid3.append(gc);
      later.push(() => rh.hbars(gb, gen.map(([genre, n]) => ({ genre, n })), { label: (r) => r.genre, value: (r) => r.n, color: (r) => gColor(r.genre),
        tipFn: (t, d) => rh.tipLines(t, d.genre, [[null, 'Books finished', d.n], [null, 'Share', Math.round(d.n / fin.length * 100) + '%']]), link: (d) => ['genre', d.genre] }));
      const au = d3.rollups(fin.filter((r) => r.author), (v) => ({ n: v.length, h: d3.sum(v, (r) => r.hours || 0), genre: d3.greatest(d3.rollups(v, (x) => x.length, (r) => r.genre), (x) => x[1])[0] }), (r) => r.author)
        .map(([author, o]) => ({ author, ...o })).sort((a, b) => b.n - a.n || b.h - a.h || a.author.localeCompare(b.author));
      if (au.length) {
        const top = au.slice(0, 8);
        const ac = card('Top authors', au.length > top.length ? `The ${top.length} authors you finished most books by, of ${fmt(au.length)}.` : `Books finished in ${Y} by author.`), ab = el('div', 'chart short');
        ac.append(ab); grid3.append(ac);
        later.push(() => rh.hbars(ab, top, { label: (r) => r.author, value: (r) => r.n, color: (r) => gColor(r.genre),
          tipFn: (t, d) => rh.tipLines(t, d.author, [[null, 'Books finished', d.n], [null, 'Hours', d.h ? fmt(Math.round(d.h)) : '—']]), link: (d) => ['author', d.author] }));
      }
      later.splice(0).forEach((f) => f());
    }

    // highlights among the books finished
    if (fin.length > 1) {
      const bb = dailyByBook(daily), avg = avgWpm();
      const rows = fin.map((r) => {
        const s = speedFrom((bb.get(r.book_id) || []).filter((d) => d.date >= r.start && d.date <= r.end));
        return { r, wpm: s ? s.wpm : null, days: span(r.start, r.end) };
      });
      const timed = rows.filter((x) => x.wpm != null), h = [];
      const hl = (lbl, x, sub) => { const n = kpi(lbl, x.r.title, sub); n.querySelector('.val').classList.add('val-sm'); linkBook(n, x.r.book_id); h.push(n); };
      if (timed.length > 1) {
        const f = d3.greatest(timed, (x) => x.wpm), s = d3.least(timed, (x) => x.wpm);
        hl('Fastest read', f, `${fmt(Math.round(f.wpm))} wpm` + (avg ? ` · ${vsAvg(f.wpm / avg - 1)}` : ''));
        hl('Slowest read', s, `${fmt(Math.round(s.wpm))} wpm` + (avg ? ` · ${vsAvg(s.wpm / avg - 1)}` : ''));
      }
      const withH = rows.filter((x) => x.r.hours);
      if (withH.length) { const l = d3.greatest(withH, (x) => x.r.hours); hl('Longest read', l, `${fmt(l.r.hours)} h over ${plural(l.r.days_read || l.days, 'day')}`); }
      const q = d3.least(rows, (x) => x.days); hl('Quickest finish', q, `${plural(q.days, 'day')}, start to finish`);
      const c = card('Highlights', 'Among the books finished this year. Speed needs at least 30 minutes of timed reading.', true);
      const kp2 = el('div', 'rh-kpis'); kp2.append(...h); c.append(kp2);
      root.append(c);
    }
  }

  rh.register('year', { draw });
})();
