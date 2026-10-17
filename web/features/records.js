// personal records: Strava-style bests, each with its history of being broken
(() => {
  const { el, fmt, pDate, fDay, fShort } = rh;
  const RECENT_DAYS = 30;

  dash.calc('records', {
    inputs: ['reads', 'daily', 'as_of'], title: 'Personal records',
    description: 'Best day, week, month, streak, fastest 100k and 1M words and fastest book, with every time each was broken. "recent" means broken in the last 30 days.',
    fn: (reads, daily, as_of) => {
      const end = as_of[0].date, DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z');
      const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
      const monday = (s) => { const d = new Date(t(s)); return iso(t(s) - ((d.getUTCDay() + 6) % 7) * DAY); };
      const rows = daily.filter((d) => d.minutes > 0 || d.words > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      // walk items in date order adding each to its bucket (a day, a week…); whenever a
      // bucket's total beats the best so far, log it (a bucket still growing updates its entry)
      function progress(items, key, val, extra = () => ({})) {
        const sums = new Map(), hist = [];
        let best = 0;
        items.forEach((it) => {
          const k = key(it), v = (sums.get(k) || 0) + val(it);
          sums.set(k, v);
          if (v <= best) return;
          best = v;
          const e = { key: k, date: it.date, value: v, ...extra(it, k) };
          if (hist.length && hist[hist.length - 1].key === k) hist[hist.length - 1] = e; else hist.push(e);
        });
        return hist;
      }

      // one row per reading day, for streaks and word windows
      const days = [];
      rows.forEach((d) => {
        const last = days[days.length - 1];
        if (last && last.date === d.date) last.words += d.words || 0;
        else days.push({ date: d.date, words: d.words || 0 });
      });
      let start = null;
      days.forEach((d, i) => { if (!i || t(d.date) - t(days[i - 1].date) !== DAY) start = d.date; d.streak = start; });

      // fewest calendar days containing n words
      function fastest(n) {
        const hist = [];
        let s = 0, sum = 0, best = Infinity;
        days.forEach((d, e) => {
          sum += d.words;
          while (s < e && sum - days[s].words >= n) sum -= days[s++].words;
          if (sum < n) return;
          const span = (t(d.date) - t(days[s].date)) / DAY + 1;
          if (span < best) { best = span; hist.push({ key: d.date, date: d.date, value: span, start: days[s].date, end: d.date }); }
        });
        return hist;
      }

      // fastest finished read: words per minute over its plausible timed days (as the speed tab)
      const ok = (d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800;
      const byBook = new Map();
      rows.forEach((d) => { if (ok(d)) { if (!byBook.has(d.book_id)) byBook.set(d.book_id, []); byBook.get(d.book_id).push(d); } });
      const timed = reads.filter((r) => r.finished === true && r.end).sort((a, b) => (a.end < b.end ? -1 : 1)).map((r) => {
        const v = (byBook.get(r.book_id) || []).filter((d) => d.date >= r.start && d.date <= r.end);
        const m = v.reduce((a, d) => a + d.minutes, 0);
        return m >= 30 ? { ...r, date: r.end, wpm: v.reduce((a, d) => a + d.words, 0) / m } : null;
      }).filter(Boolean);
      const speedHist = [];
      timed.forEach((r) => {
        if (speedHist.length && r.wpm <= speedHist[speedHist.length - 1].value) return;
        speedHist.push({ key: r.read_id, date: r.date, value: r.wpm, book_id: r.book_id, title: r.title, start: r.start, end: r.end });
      });

      const fin = reads.filter((r) => r.finished === true && r.end).map((r) => ({ ...r, date: r.end })).sort((a, b) => (a.date < b.date ? -1 : 1));
      const toHours = (h) => h.map((e) => ({ ...e, value: Math.round(e.value / 6) / 10 }));
      const defs = [
        ['biggest_day', 'Biggest day', 'minutes', false, progress(rows, (d) => d.date, (d) => d.minutes || 0, (d) => ({ start: d.date, end: d.date }))],
        ['most_words_day', 'Most words in a day', 'words', false, progress(rows, (d) => d.date, (d) => d.words || 0, (d) => ({ start: d.date, end: d.date }))],
        ['longest_streak', 'Longest streak', 'days', false, progress(days, (d) => d.streak, () => 1, (d, k) => ({ start: k, end: d.date }))],
        ['fastest_100k', 'Fastest 100,000 words', 'days', true, fastest(1e5)],
        ['fastest_1m', 'Fastest million words', 'days', true, fastest(1e6)],
        ['best_week', 'Most hours in a week', 'hours', false, toHours(progress(rows, (d) => monday(d.date), (d) => d.minutes || 0, (d, k) => ({ start: k, end: iso(t(k) + 6 * DAY) })))],
        ['best_month', 'Most hours in a month', 'hours', false, toHours(progress(rows, (d) => d.date.slice(0, 7), (d) => d.minutes || 0, (d, k) => ({ start: k + '-01', end: d.date })))],
        ['most_books_month', 'Most books in a month', 'books', false, progress(fin, (r) => r.date.slice(0, 7), () => 1, (r, k) => ({ start: k + '-01', end: r.date }))],
        ['fastest_book', 'Fastest book', 'wpm', false, speedHist.map((e) => ({ ...e, value: Math.round(e.value) }))],
      ];
      return defs.filter((d) => d[4].length).map(([id, label, unit, lower_better, history]) => {
        const cur = history[history.length - 1], prev = history.length > 1 ? history[history.length - 2] : null;
        const days_ago = Math.round((t(end) - t(cur.date)) / DAY);
        return {
          id, label, unit, lower_better, value: cur.value, date: cur.date, start: cur.start, end: cur.end,
          book_id: cur.book_id || null, title: cur.title || null,
          prev_value: prev ? prev.value : null, prev_date: prev ? prev.date : null,
          times_broken: history.length - 1, days_ago, recent: !!prev && days_ago <= RECENT_DAYS,
          history: history.map(({ date, value }) => ({ date, value })),
        };
      });
    },
  });

  // value and unit for display; shared with other views through rh.recordText
  const fmtVal = (r, v = r.value) => {
    if (r.unit === 'minutes') return v >= 60 ? [`${Math.floor(v / 60)} h ${Math.round(v % 60)}`, 'min'] : [String(Math.round(v)), 'min'];
    if (r.unit === 'hours') return [String(v), 'h'];
    if (r.unit === 'days') return [fmt(v), v === 1 ? 'day' : 'days'];
    if (r.unit === 'books') return [fmt(v), v === 1 ? 'book' : 'books'];
    return [fmt(v), r.unit];
  };
  const recordText = (r, v) => fmtVal(r, v).join(' ');
  const when = (r) => {
    if (r.book_id) return 'finished ' + fDay(pDate(r.end));
    if (r.id === 'best_week') return 'week of ' + fDay(pDate(r.start));
    if (r.id === 'best_month' || r.id === 'most_books_month') return fShort(pDate(r.start));
    if (r.start && r.end && r.start !== r.end) return `${fDay(pDate(r.start))} – ${fDay(pDate(r.end))}`;
    return fDay(pDate(r.date));
  };
  rh.recordText = recordText;
  rh.recordWhen = when;

  // a step line of the record's progression, ending at the backup date
  function spark(box, r, asOf, tile) {
    const h = r.history;
    if (h.length < 2) return;
    const w = Math.max(80, tile.clientWidth - 26), ht = 26, ns = 'http://www.w3.org/2000/svg';
    const x = d3.scaleUtc([pDate(h[0].date), pDate(asOf)], [2, w - 4]);
    const ext = d3.extent(h, (e) => e.value), y = d3.scaleLinear(r.lower_better ? [ext[1], ext[0]] : ext, [ht - 3, 3]);
    const pts = h.map((e) => [x(pDate(e.date)), y(e.value)]).concat([[x(pDate(asOf)), y(h[h.length - 1].value)]]);
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${ht}`); svg.setAttribute('class', 'pr-spark'); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d3.line().curve(d3.curveStepAfter)(pts));
    svg.append(p);
    h.forEach((e, i) => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', x(pDate(e.date))); c.setAttribute('cy', y(e.value)); c.setAttribute('r', i === h.length - 1 ? 3 : 1.6);
      if (i === h.length - 1) c.setAttribute('class', 'last');
      svg.append(c);
    });
    box.append(svg);
  }

  rh.card({
    tab: 'overview', id: 'records', title: 'Personal records', calc: 'records', before: 'card-years',
    note: `Your bests so far, and how each has improved. A badge marks one broken in the last ${RECENT_DAYS} days of the backup.`,
    draw(box, rows) {
      box.classList.add('pr-chart');
      const asOf = (dash.data('as_of').data[0] || {}).date;
      if (!rows.length) { box.replaceChildren(el('div', 'dy-empty', 'No records yet.')); return; }
      const sorted = rows.slice().sort((a, b) => b.recent - a.recent);
      const later = [];
      box.replaceChildren(...sorted.map((r) => {
        const tile = el('div', 'pr' + (r.recent ? ' pr-new' : '')), top = el('div', 'pr-top');
        top.append(el('span', 'pr-lbl', r.label));
        if (r.recent) top.append(el('span', 'pr-badge', r.days_ago === 0 ? 'New record today' : 'New record'));
        const [v, u] = fmtVal(r), val = el('div', 'pr-val');
        val.append(v + ' ', el('small', null, u));
        tile.append(top, val);
        const sub = el('div', 'pr-sub');
        if (r.book_id) sub.append(rh.linkBook(el('span', 'lk', r.title), r.book_id), ' · ');
        const w = el('span', null, when(r));
        // a single day opens in the diary
        if (r.start === r.end) { w.setAttribute('data-day', r.start); w.className = 'lk'; }
        sub.append(w);
        tile.append(sub);
        const sp = el('div', 'pr-sp');
        tile.append(sp);
        later.push(() => spark(sp, r, asOf, tile));
        tile.append(el('div', 'pr-prev', r.prev_value != null ? `Beat ${recordText(r, r.prev_value)} from ${fShort(pDate(r.prev_date))}` + (r.times_broken > 1 ? ` · broken ${r.times_broken} times` : '') : 'First and only so far'));
        return tile;
      }));
      // sized once the tiles are laid out
      later.forEach((f) => f());
    },
  });
})();
