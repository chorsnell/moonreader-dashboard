// TV & film: a tab built from the media files (Netflix, Plex through Tautulli), and a page for
// each show (#show/<id>) and film (#film/<id>). A season is treated as a book and its show as the
// series, so several book calcs are reused as they are (dash.reuse); see docs/media-verticals.md.
(() => {
  const { el, fmt, pDate, fDay, fShort, C, svgIn, showTip, hideTip, tipLines, axis, legend, ref, link, plural, barPath, grow, setTitle, mins } = rh;
  const FILES = ['media_items', 'media_runs', 'media_daily', 'media_sessions', 'media_parts', 'media_meta'];
  FILES.forEach((f) => dash.file(f, `data/${f}.json`, { optional: true }));

  const arr = (x) => (Array.isArray(x) ? x : []);
  const isScreen = (m) => m.media === 'tv' || m.media === 'film';
  const DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z');
  const daysBetween = (a, b) => Math.round((t(b) - t(a)) / DAY);
  const hrs = (h) => (h >= 10 ? fmt(Math.round(h)) : String(Math.round(h * 10) / 10));
  // what a row links to: its show, or the film itself
  const linkFields = (m) => (m.media === 'tv' ? { show: m.series, show_id: m.series_id } : { film: m.title, film_id: m.id });

  // ---------- media rows in the shape of book rows ----------
  const asBook = (m) => ({ ...m, ...linkFields(m), author: m.creator, first_read: m.first, last_read: m.last, times_read: m.times, words: m.units, genre: m.genre || 'Untagged', subgenre: m.subgenre || 'Untagged' });
  const asRead = (r) => ({ ...r, read_id: r.run_id, book_id: r.item_id, author: r.creator, read_no: r.run_no, times_read: r.times, days_read: r.days, words: r.units, genre: r.genre || 'Untagged' });
  const asDay = (d) => ({ ...d, book_id: d.item_id, author: d.creator, words: d.units, genre: d.genre || 'Untagged' });

  dash.calc('tv_books', { inputs: ['media_items'], title: 'Seasons and films', description: 'Every TV season and film, shaped like books.', fn: (rows) => arr(rows).filter(isScreen).map(asBook) });
  dash.calc('tv_reads', { inputs: ['media_runs'], title: 'Watch-throughs', description: 'Every watch-through of a season, and every viewing of a film.', fn: (rows) => arr(rows).filter(isScreen).map(asRead) });
  dash.calc('tv_daily', { inputs: ['media_daily'], title: 'Watching per day', description: 'Minutes watched per season or film per day.', fn: (rows) => arr(rows).filter(isScreen).map(asDay) });
  dash.reuse('tv_as_of', 'as_of', ['tv_daily']);
  dash.reuse('tv_per_month', 'per_month', ['tv_daily']);
  dash.reuse('tv_genre_month', 'genre_month', ['tv_daily']);
  dash.reuse('tv_current', 'current', ['tv_books', 'tv_as_of', 'tv_reads']);
  dash.reuse('tv_stalled', 'stalled', ['tv_books', 'tv_as_of']);

  dash.calc('tv_kpis', {
    inputs: ['tv_books', 'tv_daily', 'tv_as_of'], title: 'Watching at a glance',
    description: 'Hours watched this year and by the same date last year, seasons and films finished, episodes, and minutes a day over the last 365 days.',
    fn: (items, daily, asOf) => {
      const end = asOf[0] && asOf[0].date;
      if (!end) return [];
      const Y = +end.slice(0, 4), md = end.slice(5), from365 = new Date(t(end) - 364 * DAY).toISOString().slice(0, 10);
      const sum = (f) => daily.filter(f).reduce((s, d) => s + d.minutes, 0);
      const days365 = new Set(daily.filter((d) => d.date >= from365 && d.minutes > 0).map((d) => d.date)).size;
      return [{
        year: Y,
        hours_ytd: sum((d) => d.date.startsWith(Y + '-')) / 60,
        hours_prev_ytd: sum((d) => d.date.startsWith(Y - 1 + '-') && d.date.slice(5) <= md) / 60,
        hours_all: sum(() => true) / 60,
        seasons: items.filter((m) => m.media === 'tv' && m.status === 'finished').length,
        shows: new Set(items.filter((m) => m.media === 'tv').map((m) => m.series_id)).size,
        films: items.filter((m) => m.media === 'film' && m.status === 'finished').length,
        episodes: items.reduce((s, m) => s + (m.media === 'tv' ? m.units || 0 : 0), 0),
        mins_365: sum((d) => d.date >= from365) / 365,
        days_365: days365,
      }];
    },
  });

  dash.calc('tv_shows', {
    inputs: ['tv_books', 'tv_as_of'], title: 'Shows and seasons',
    description: 'Each show with its seasons in order: finished, on the go, or dropped (no episode for 60 days).',
    fn: (items, asOf) => {
      const end = asOf[0] && asOf[0].date, by = new Map();
      items.filter((m) => m.media === 'tv').forEach((m) => {
        const s = by.get(m.series_id) || { show: m.series, show_id: m.series_id, genre: m.genre, creator: m.creator, seasons: [], hours: 0, last: '' };
        s.seasons.push(m); s.hours += m.hours; if (m.last > s.last) s.last = m.last;
        by.set(m.series_id, s);
      });
      return [...by.values()].map((s) => {
        s.seasons.sort((a, b) => a.series_no - b.series_no);
        s.seasons = s.seasons.map((m) => ({ ...m, state: seasonState(m, end) }));
        return s;
      }).sort((a, b) => (a.last < b.last ? 1 : -1));
    },
  });
  // finished, watching (an episode in the last 60 days) or dropped
  function seasonState(m, end) {
    if (m.status === 'finished') return 'done';
    return end && m.last && daysBetween(m.last, end) > 60 ? 'dropped' : 'now';
  }
  const STATE = { done: [C[0], 'Finished'], now: [C[1], 'Watching'], dropped: ['var(--cds-chart-muted)', 'Dropped'] };

  dash.calc('tv_binge', {
    inputs: ['tv_books', 'tv_daily'], title: 'Binge fingerprints',
    description: 'For each season with two or more episodes: the episodes finished on each day since you started it, episodes per watching day, and how many days it took.',
    fn: (items, daily) => {
      const byItem = new Map();
      daily.forEach((d) => { if (!byItem.has(d.item_id)) byItem.set(d.item_id, []); byItem.get(d.item_id).push(d); });
      return items.filter((m) => m.media === 'tv' && m.units >= 2).map((m) => {
        const days = (byItem.get(m.id) || []).filter((d) => d.minutes > 0);
        const first = days.length ? days[0].date : m.first;
        const points = days.map((d) => ({ date: d.date, offset: daysBetween(first, d.date), eps: d.units, minutes: d.minutes }));
        const watchDays = points.length;
        return { id: m.id, title: m.title, show: m.series, show_id: m.series_id, season: m.series_no, genre: m.genre, status: m.status, first, last: m.last,
          episodes: m.units, units_total: m.units_total, points, watch_days: watchDays, span: points.length ? points[points.length - 1].offset + 1 : 0, rate: watchDays ? m.units / watchDays : 0 };
      }).sort((a, b) => (a.first < b.first ? 1 : -1));
    },
  });

  dash.calc('tv_clock', {
    inputs: ['media_sessions'], title: 'When you watch',
    description: 'Minutes watched in each hour of each weekday (your browser’s time zone), over every sitting.',
    fn: (sessions) => {
      const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
      arr(sessions).filter(isScreen).forEach((s) => {
        let from = Date.parse(s.start);
        const to = from + s.minutes * 60000;
        while (from < to) {
          const d = new Date(from), next = Math.min(to, new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime());
          grid[(d.getDay() + 6) % 7][d.getHours()] += (next - from) / 60000;
          from = next;
        }
      });
      return grid.flatMap((row, day) => row.map((minutes, hour) => ({ day, hour, minutes: Math.round(minutes) })));
    },
  });

  // which source a subscription pays for, by its name
  const sourceOf = (service) => (/netflix/i.test(service) ? 'netflix' : /plex/i.test(service) ? 'tautulli' : null);
  dash.calc('tv_cost', {
    inputs: ['media_sessions', 'media_meta', 'tv_as_of'], title: 'Cost per hour watched',
    description: 'For each streaming subscription (set on the admin page) and year: what it cost, the hours watched on that service, and the cost per hour. Months with less than an hour watched are counted as idle.',
    fn: (sessions, meta, asOf) => {
      const subs = (meta && !Array.isArray(meta) && arr(meta.subscriptions)) || [];
      const end = asOf[0] && asOf[0].date;
      if (!subs.length || !end) return [];
      const hours = new Map(); // source|month -> hours
      arr(sessions).filter(isScreen).forEach((s) => { const k = s.source + '|' + s.date.slice(0, 7); hours.set(k, (hours.get(k) || 0) + s.minutes / 60); });
      const out = new Map();
      subs.forEach((sub) => {
        const src = sourceOf(sub.service), last = sub.to && sub.to < end.slice(0, 7) ? sub.to : end.slice(0, 7);
        for (let [y, m] = sub.from.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= last; m === 12 ? ((m = 1), y++) : m++) {
          const month = `${y}-${String(m).padStart(2, '0')}`;
          const h = src ? hours.get(src + '|' + month) || 0 : [...hours].filter(([k]) => k.endsWith('|' + month)).reduce((s, [, v]) => s + v, 0);
          const k = sub.service + '|' + y + '|' + sub.currency;
          const r = out.get(k) || { service: sub.service, year: y, currency: sub.currency, months: 0, cost: 0, hours: 0, idle: 0 };
          r.months++; r.cost += sub.monthly; r.hours += h; if (h < 1) r.idle++;
          out.set(k, r);
        }
      });
      return [...out.values()].map((r) => ({ ...r, cost: Math.round(r.cost * 100) / 100, hours: Math.round(r.hours * 10) / 10, per_hour: r.hours >= 0.1 ? Math.round((r.cost / r.hours) * 100) / 100 : null }))
        .sort((a, b) => a.service.localeCompare(b.service) || a.year - b.year);
    },
  });

  // ---------- drawing helpers ----------
  // TV genres get their own colours, by hours watched (book genres keep theirs)
  let tvOrder = [], orderOf = null;
  function genreOrder() {
    const r = dash.data('tv_books');
    if (r.status === 'ok' && r.data !== orderOf) {
      orderOf = r.data;
      const h = new Map();
      r.data.forEach((m) => h.set(m.genre, (h.get(m.genre) || 0) + m.hours));
      tvOrder = [...h].filter(([g]) => g !== 'Untagged').sort((a, b) => b[1] - a[1]).map(([g]) => g);
    }
    return tvOrder;
  }
  const tvColor = (g) => { const i = genreOrder().indexOf(g); return i >= 0 && i < C.length ? C[i] : 'var(--cds-chart-muted)'; };
  const money = (v, cur) => { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(v); } catch (e) { return `${v.toFixed(2)} ${cur}`; } };
  const itemsById = () => new Map(arr(dash.data('tv_books').data).map((m) => [m.id, m]));
  const ok = (id) => { const r = dash.data(id); return r.status === 'ok' ? r.data : null; };

  // a poster, or a made-up one: the title on a tile in the genre's colour
  function poster(m, size) {
    const box = rh.cover(m.id, m.title, null, size);
    box.classList.add('tvp');
    box.style.setProperty('--cv', tvColor(m.genre));
    if (box.classList.contains('blank') && size === 'lg') box.replaceChildren(el('b', null, m.media === 'tv' ? m.series : m.title), el('small', null, m.media === 'tv' ? `Season ${m.series_no}` : m.year ? String(m.year) : ''));
    return box;
  }
  // a season or film in a list: poster, title linked to its show or film, a note, progress
  function itemRow(m, meta, note, prog) {
    const li = el('li'), a = el('div', 'ttl');
    link(li, m.media === 'tv' ? 'show' : 'film', m.media === 'tv' ? m.series_id : m.id);
    a.append(document.createTextNode(m.media === 'tv' ? m.series : m.title));
    const sub = el('small');
    sub.append(m.media === 'tv' ? `Season ${m.series_no}` : m.year ? String(m.year) : 'Film');
    if (note) sub.append(' · ', note);
    a.append(sub);
    if (prog != null) { const p = el('div', 'pbar'), i = el('i'); i.style.width = Math.min(100, prog) + '%'; i.style.background = C[0]; p.append(i); a.append(p); }
    li.append(poster(m), a, el('div', 'meta', meta || ''));
    return li;
  }
  const notFound = (text) => { const c = el('div', 'rh-card wide'); c.append(el('div', 'dy-empty', text)); return c; };
  const empty = (box, text) => box.replaceChildren(el('div', 'dy-empty', text));
  function kpi(lbl, val, sub) {
    const k = el('div', 'rh-kpi');
    k.append(el('div', 'lbl', lbl), el('div', 'val', val));
    if (sub) k.append(el('div', 'sub', sub));
    return k;
  }

  // one season's binge: a dot per watching day, sized by episodes finished that day
  function bingeStrip(svg, row, x, y, r, tip, box) {
    const g = svg.append('g').attr('transform', `translate(0,${y})`);
    g.append('line').attr('class', 'tv-rail').attr('x1', x(0)).attr('x2', x(Math.max(0, row.span - 1))).attr('y1', 0).attr('y2', 0);
    g.selectAll('circle').data(row.points).join('circle').attr('class', 'ring')
      .attr('cx', (d) => x(d.offset)).attr('cy', 0).attr('fill', row.status === 'finished' ? C[0] : 'var(--cds-chart-muted)')
      .call(grow, 'r', 0, (d) => (d.eps ? r(d.eps) : 2))
      .on('mousemove', (e, d) => showTip(tip, box, e, (tp) => tipLines(tp, `${row.show}, season ${row.season}`, [[null, fDay(pDate(d.date)), d.eps ? plural(d.eps, 'episode') : 'part of one'], [null, 'Watched', mins(d.minutes)]])))
      .on('mouseleave', () => hideTip(tip));
    return g;
  }

  // ---------- the tab ----------
  // the tab appears once there's TV or film to show; with no books at all it opens first
  let tabMade = false;
  function makeTab(first) {
    if (!tabMade) { tabMade = true; rh.tab('tv', 'TV & film', { after: 'library' }); }
    if (location.hash === '#tv' || (first && ['', '#overview'].includes(location.hash))) rh.show('tv');
  }
  window.addEventListener('dash:config', (e) => {
    const c = e.detail || {};
    if (c.has_media) makeTab(c.has_books === false);
  });
  dash.onData(() => {
    const items = ok('tv_books'), books = ok('books');
    const has = !!(items && items.length);
    if (has && !tabMade) makeTab(books && !books.length);
    const b = document.getElementById('tab-tv');
    if (b) b.hidden = !has && dash.data('tv_books').status !== 'loading';
  });

  rh.card({
    tab: 'tv', id: 'tv-kpis', chartClass: 'tv-auto', title: 'Watching', calc: 'tv_kpis',
    note: 'From your Netflix and Plex history. A season counts like a book: finished when you’ve seen nearly every episode.',
    draw(box, rows) {
      const k = rows[0];
      if (!k) return empty(box, 'Nothing watched yet.');
      const grid = el('div', 'rh-kpis');
      grid.append(
        kpi(`Hours watched in ${k.year}`, hrs(k.hours_ytd), `${hrs(k.hours_prev_ytd)} by this date last year`),
        kpi('Minutes a day, last 365 days', fmt(Math.round(k.mins_365)), `watched on ${fmt(k.days_365)} of 365 days`),
        kpi('Seasons finished', fmt(k.seasons), `of ${plural(k.shows, 'show')}; ${plural(k.episodes, 'episode')} in all`),
        kpi('Films watched', fmt(k.films), `${fmt(Math.round(k.hours_all))} hours of TV and film in total`));
      box.replaceChildren(grid);
    },
  });

  rh.card({
    tab: 'tv', id: 'tv-now', chartClass: 'tv-auto', title: 'On screen now', wide: false, calc: 'tv_current',
    note: 'Seasons and films you watched in the last 30 days and haven’t finished.',
    draw(box, rows) {
      const by = itemsById(), ul = el('ul', 'rh-list');
      rows.slice(0, 8).forEach((r) => { const m = by.get(r.id); if (m) ul.append(itemRow(m, 'last ' + d3.utcFormat('%-d %b')(pDate(r.last_read)), m.units_total ? `${m.units} of ${plural(m.units_total, 'episode')}` : null, r.progress)); });
      if (!ul.children.length) return empty(box, 'Nothing on the go right now.');
      box.replaceChildren(ul);
    },
  });

  rh.card({
    tab: 'tv', id: 'tv-dropped', chartClass: 'tv-auto', title: 'Dropped mid-season', wide: false, calc: 'tv_stalled',
    note: 'Seasons you got between 5% and 95% through, then left for 60 days or more.',
    draw(box, rows) {
      const by = itemsById(), ul = el('ul', 'rh-list');
      rows.forEach((r) => { const m = by.get(r.id); if (m) ul.append(itemRow(m, fShort(pDate(r.last_read)), m.units_total ? `stopped after ${m.units} of ${m.units_total}` : null, r.progress)); });
      if (!ul.children.length) return empty(box, 'You finish what you start.');
      box.replaceChildren(ul);
    },
  });

  rh.card({
    tab: 'tv', id: 'tv-seasons', chartClass: 'tv-auto', title: 'Season completion', calc: 'tv_shows',
    note: 'Each show, season by season: how far through each one you got. Finished seasons are full; dropped ones are greyed out.',
    draw(box, shows) {
      if (!shows.length) return empty(box, 'No shows yet.');
      const leg = el('div', 'legend');
      legend(leg, Object.values(STATE));
      const list = el('div', 'tv-shows');
      shows.forEach((s) => {
        const row = link(el('div', 'tv-show'), 'show', s.show_id), name = el('div', 'tv-show-name');
        name.append(ref(s, 'show'), el('small', null, `${plural(s.seasons.length, 'season')} · ${hrs(s.hours)} h`));
        const seasons = el('div', 'tv-seasons');
        s.seasons.forEach((m) => {
          const cell = el('div', 'tv-season tv-' + m.state), fill = el('i');
          fill.style.width = Math.min(100, m.progress ?? (m.status === 'finished' ? 100 : 0)) + '%';
          fill.style.background = STATE[m.state][0];
          cell.append(fill, el('span', null, 'S' + m.series_no));
          cell.title = `Season ${m.series_no}: ${STATE[m.state][1].toLowerCase()}` + (m.units_total ? `, ${m.units} of ${m.units_total} episodes` : '') + `, ${hrs(m.hours)} h`;
          seasons.append(cell);
        });
        row.append(name, seasons);
        list.append(row);
      });
      box.replaceChildren(leg, list);
    },
  });

  rh.card({
    tab: 'tv', id: 'tv-binge', chartClass: 'tv-auto', title: 'Binge fingerprints', calc: 'tv_binge',
    note: 'Every season from the day you started it: one dot per day you watched, bigger for more episodes. Tight clusters are binges; long rails are a show savoured week by week.',
    draw(box, rows) {
      if (!rows.length) return empty(box, 'No seasons with two or more episodes yet.');
      const show = rows.slice(0, 14);
      const maxSpan = Math.min(120, d3.max(show, (r) => r.span) || 1);
      const rowH = 30, narrow = box.clientWidth < 500, m = { t: 22, r: narrow ? 58 : 92, l: Math.min(190, box.clientWidth * 0.38) }, h = m.t + show.length * rowH + 4;
      const { svg, w, tip } = svgIn(box, h);
      const x = d3.scaleLinear([0, maxSpan], [m.l + 12, w - m.r]).clamp(true);
      const r = d3.scaleSqrt([0, d3.max(show, (s) => d3.max(s.points, (p) => p.eps)) || 1], [0, Math.min(11, rowH / 2 - 2)]);
      axis(svg.append('g').attr('transform', `translate(0,${m.t - 8})`), d3.axisTop(x).ticks(Math.min(Math.floor((w - m.l - m.r) / 80), 6, maxSpan)).tickFormat((d) => (d ? `day ${d + 1}` : 'start')).tickSize(0));
      svg.selectAll('.domain').remove();
      show.forEach((row, i) => {
        const y = m.t + i * rowH + rowH / 2;
        const label = svg.append('text').attr('class', 'axl').attr('x', m.l - 10).attr('y', y).attr('dy', '0.35em').attr('text-anchor', 'end')
          .text(`${row.show.length > (narrow ? 15 : 22) ? row.show.slice(0, narrow ? 14 : 21) + '…' : row.show} S${row.season}`);
        link(label.node(), 'show', row.show_id);
        bingeStrip(svg, row, x, y, r, tip, box);
        svg.append('text').attr('class', 'axl').attr('x', w - m.r + 8).attr('y', y).attr('dy', '0.35em')
          .text(`${row.rate >= 1.95 ? Math.round(row.rate * 10) / 10 + '/day' : plural(row.span, 'day')}`);
      });
    },
  });

  rh.card({
    tab: 'tv', id: 'tv-clock', chartClass: 'tv-auto', title: 'When you watch', wide: false, calc: 'tv_clock',
    note: 'Minutes watched by weekday and hour, over every sitting. Darker is more.',
    draw(box, cells) {
      const max = d3.max(cells, (c) => c.minutes) || 0;
      if (!max) return empty(box, 'No sittings with clock times.');
      const m = { t: 18, r: 4, b: 4, l: 34 }, w0 = Math.max(280, box.clientWidth), cw = (w0 - m.l - m.r) / 24, ch = Math.min(26, Math.max(16, cw * 1.2)), h = m.t + ch * 7 + m.b;
      const { svg, tip } = svgIn(box, h);
      const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      names.forEach((n, i) => svg.append('text').attr('class', 'axl').attr('x', m.l - 6).attr('y', m.t + i * ch + ch / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(n));
      [0, 6, 12, 18].forEach((hr) => svg.append('text').attr('class', 'axl').attr('x', m.l + hr * cw).attr('y', m.t - 6).text(hr === 0 ? 'midnight' : hr === 12 ? 'noon' : `${hr}:00`));
      svg.selectAll('rect.hm').data(cells).join('rect').attr('class', 'hm')
        .attr('x', (c) => m.l + c.hour * cw + 1).attr('y', (c) => m.t + c.day * ch + 1).attr('width', cw - 2).attr('height', ch - 2).attr('rx', 2)
        .attr('fill', (c) => (c.minutes ? C[0] : 'var(--cds-chart-grid)')).attr('fill-opacity', (c) => (c.minutes ? 0.12 + 0.88 * Math.sqrt(c.minutes / max) : 1))
        .on('mousemove', (e, c) => showTip(tip, box, e, (tp) => tipLines(tp, `${names[c.day]}, ${c.hour}:00–${c.hour + 1}:00`, [[null, 'Watched', mins(c.minutes)]])))
        .on('mouseleave', () => hideTip(tip));
    },
  });

  rh.card({
    tab: 'tv', id: 'tv-month', title: 'Hours watched per month', wide: false, calc: 'tv_per_month',
    note: 'Hours of TV and film each month, with the 12-month average as a line.',
    draw(box, rows) {
      if (!rows.length) return empty(box, 'Nothing watched yet.');
      const h = 220, m = { t: 12, r: 6, b: 24, l: 30 }, { svg, w, tip } = svgIn(box, h);
      const x = d3.scaleBand(rows.map((r) => r.month), [m.l, w - m.r]).padding(0.15);
      const y = d3.scaleLinear([0, d3.max(rows, (r) => Math.max(r.hours, r.rolling)) || 1], [h - m.b, m.t]).nice();
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)));
      svg.selectAll('.domain').remove();
      const years = rows.filter((r) => r.month.endsWith('-01'));
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(years.map((r) => r.month)).tickFormat((s) => s.slice(0, 4)).tickSize(0));
      svg.selectAll('rect.b').data(rows).join('path').attr('fill', C[0])
        .call(grow, 'd', (r) => barPath(x(r.month), h - m.b, x.bandwidth(), 0), (r) => barPath(x(r.month), y(r.hours), x.bandwidth(), y(0) - y(r.hours), 'up', Math.min(2, x.bandwidth() / 2)));
      svg.append('path').datum(rows).attr('class', 'ref').attr('fill', 'none').attr('d', d3.line((r) => x(r.month) + x.bandwidth() / 2, (r) => y(r.rolling)));
      svg.selectAll('rect.hit').data(rows).join('rect').attr('class', 'hit').attr('x', (r) => x(r.month)).attr('width', x.bandwidth()).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
        .on('mousemove', (e, r) => showTip(tip, box, e, (tp) => tipLines(tp, fShort(pDate(r.month + '-01')), [[C[0], 'Watched', `${r.hours} h`], [null, '12-month average', `${r.rolling} h`]])))
        .on('mouseleave', () => hideTip(tip));
    },
  });

  rh.card({
    tab: 'tv', id: 'tv-genres', title: 'Genre drift', calc: 'tv_genre_month',
    note: 'Each quarter’s watching split by genre, as a share of the hours. Watch your tastes move.',
    draw(box, rows) {
      const known = rows.filter((r) => r.genre !== 'Untagged');
      if (!known.length) return empty(box, 'No genres yet. Add a TMDB key on the admin page, or genres in media/catalogue.json.');
      const top = genreOrder().slice(0, 6), key = (g) => (top.includes(g) ? g : 'Other');
      const q = (month) => `${month.slice(0, 4)} Q${Math.floor((+month.slice(5) - 1) / 3) + 1}`;
      const by = new Map();
      known.forEach((r) => { const k = q(r.month), o = by.get(k) || {}; o[key(r.genre)] = (o[key(r.genre)] || 0) + r.hours; by.set(k, o); });
      const quarters = [...by.keys()].sort(), keys = [...top, ...(known.some((r) => !top.includes(r.genre)) ? ['Other'] : [])];
      const data = quarters.map((k) => { const o = by.get(k), tot = d3.sum(keys, (g) => o[g] || 0) || 1; return { q: k, total: tot, ...Object.fromEntries(keys.map((g) => [g, (o[g] || 0) / tot])) }; });
      const h = 240, m = { t: 10, r: 8, b: 24, l: 36 }, { svg, w, tip } = svgIn(box, h);
      const x = d3.scalePoint(quarters, [m.l, w - m.r]), y = d3.scaleLinear([0, 1], [h - m.b, m.t]);
      const series = d3.stack().keys(keys)(data), color = (g) => (g === 'Other' ? 'var(--cds-chart-muted)' : tvColor(g));
      const area = d3.area().x((d) => x(d.data.q)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
      svg.selectAll('path.a').data(series).join('path').attr('fill', (s) => color(s.key)).attr('fill-opacity', 0.9).attr('d', area);
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4, '%').tickSize(0));
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(quarters.filter((k) => k.endsWith('Q1'))).tickFormat((k) => k.slice(0, 4)).tickSize(0));
      svg.selectAll('.domain').remove();
      const step = quarters.length > 1 ? x.step() : w;
      svg.selectAll('rect.hit').data(data).join('rect').attr('class', 'hit').attr('x', (d) => x(d.q) - step / 2).attr('width', step).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
        .on('mousemove', (e, d) => showTip(tip, box, e, (tp) => tipLines(tp, `${d.q}: ${hrs(d.total)} h`, keys.filter((g) => d[g] > 0).reverse().map((g) => [color(g), g, Math.round(d[g] * 100) + '%']))))
        .on('mouseleave', () => hideTip(tip));
      const leg = el('div', 'legend');
      legend(leg, keys.map((g) => [color(g), g]));
      box.append(leg);
    },
  });

  rh.card({
    tab: 'tv', id: 'tv-films', chartClass: 'tv-auto', title: 'Films', wide: false, calc: 'tv_reads',
    note: 'The films you watched, most recent first.',
    draw(box, reads) {
      const by = itemsById(), ul = el('ul', 'rh-list');
      reads.filter((r) => r.media === 'film' && r.finished).sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 10).forEach((r) => {
        const m = by.get(r.item_id);
        if (m) ul.append(itemRow(m, fDay(pDate(r.end)), m.creator ? `dir. ${m.creator}` : null));
      });
      if (!ul.children.length) return empty(box, 'No films yet.');
      box.replaceChildren(ul);
    },
  });

  rh.card({
    tab: 'tv', id: 'tv-cost', chartClass: 'tv-auto', title: 'Cost per hour', wide: false, calc: 'tv_cost',
    note: 'What each streaming subscription cost you per hour actually watched, by year. Set your subscriptions on the admin page, under TV & film.',
    draw(box, rows) {
      if (!rows.length) return empty(box, 'No subscriptions set. Add them on the admin page to see what an hour of watching costs you.');
      const tbl = el('table', 'tv-cost'), head = el('tr');
      ['Service', 'Year', 'Paid', 'Hours', 'Per hour'].forEach((s, i) => head.append(el('th', i > 1 ? 'n' : null, s)));
      const thead = el('thead'); thead.append(head);
      const body = el('tbody');
      rows.forEach((r) => {
        const tr = el('tr');
        tr.append(el('td', null, r.service), el('td', null, String(r.year)), el('td', 'n', money(r.cost, r.currency)), el('td', 'n', hrs(r.hours)),
          el('td', 'n', r.per_hour != null ? money(r.per_hour, r.currency) : '—'));
        tr.title = `${plural(r.months, 'month')} paid` + (r.idle ? `, ${r.idle} with under an hour watched` : '');
        body.append(tr);
      });
      tbl.append(thead, body);
      const idle = d3.sum(rows, (r) => r.idle), wrap = el('div', 'tv-scroll');
      wrap.append(tbl);
      box.replaceChildren(wrap);
      if (idle) box.append(el('p', 'note', `${plural(idle, 'month')} paid for with less than an hour watched.`));
    },
  });

  // ---------- show page ----------
  rh.register('show', {
    draw(id, root) {
      const items = ok('tv_books');
      if (!items) return root.replaceChildren(el('div', 'dy-empty', 'Loading…'));
      const seasons = items.filter((m) => m.series_id === id).sort((a, b) => a.series_no - b.series_no);
      if (!seasons.length) { setTitle('Show'); return root.replaceChildren(notFound('No such show in your watch history.')); }
      const name = seasons[0].series;
      setTitle(name);
      const asOf = (ok('tv_as_of') || [])[0], end = asOf && asOf.date;
      const latest = seasons[seasons.length - 1], hours = d3.sum(seasons, (m) => m.hours);
      const head = el('div', 'rh-card wide bk-head tv-head'), info = el('div', 'go-info');
      info.append(el('div', 'bk-title', name));
      const facts = [latest.creator, plural(seasons.length, 'season') + ' watched', `${hrs(hours)} h`, `${fDay(pDate(seasons[0].first))} – ${fDay(pDate(d3.max(seasons, (m) => m.last)))}`].filter(Boolean);
      info.append(el('div', 'go-sub', facts.join(' · ')));
      const chips = el('div', 'bk-chips');
      [...new Set(seasons.flatMap((m) => [m.genre, m.subgenre]).filter((g) => g && g !== 'Untagged'))].forEach((g) => { const c = el('span', 'chip', g); c.style.color = tvColor(g); chips.append(c); });
      const done = seasons.filter((m) => m.status === 'finished').length;
      chips.append(el('span', 'chip' + (done === seasons.length ? ' ok' : ''), done === seasons.length ? 'Every season finished' : `${done} of ${seasons.length} seasons finished`));
      info.append(chips);
      head.append(poster(latest, 'lg'), info);

      const card = (title, note) => { const c = el('div', 'rh-card wide'); c.append(el('h2', null, title)); if (note) c.append(el('p', 'note', note)); return c; };
      const list = card('Seasons', 'Each season you watched, with how far you got and how long it took.');
      const ul = el('ul', 'rh-list');
      const reads = (ok('tv_reads') || []).filter((r) => seasons.some((m) => m.id === r.item_id));
      seasons.forEach((m) => {
        const runs = reads.filter((r) => r.item_id === m.id), state = STATE[seasonState(m, end)][1];
        const span = m.first && m.last ? daysBetween(m.first, m.last) + 1 : 0;
        const li = el('li'), a = el('div', 'ttl');
        a.append(document.createTextNode(m.title), el('small', null, [state, m.units_total ? `${m.units} of ${plural(m.units_total, 'episode')}` : null, `${hrs(m.hours)} h over ${plural(span, 'day')}`, runs.length > 1 ? `watched ${runs.length} times` : null].filter(Boolean).join(' · ')));
        const p = el('div', 'pbar'), i = el('i'); i.style.width = Math.min(100, m.progress || 0) + '%'; i.style.background = STATE[seasonState(m, end)][0]; p.append(i); a.append(p);
        li.append(poster(m), a, el('div', 'meta', fShort(pDate(m.first))));
        ul.append(li);
      });
      list.append(ul);

      const binge = card('Binge fingerprint', 'One row per season from the day you started it: a dot per day you watched, bigger for more episodes.');
      const bingeBox = el('div', 'chart tv-auto');
      binge.append(bingeBox);

      const eps = card('Episodes', 'Every episode you started, in order.');
      const parts = (ok('media_parts') || []).filter((p) => seasons.some((m) => m.id === p.item_id));
      const wrap = el('div', 'tv-scroll'), tbl = el('table', 'tv-eps'), tb = el('tbody'), hr = el('tr');
      ['', 'Episode', 'Watched', 'First', 'Seen'].forEach((s, i) => hr.append(el('th', i === 2 || i === 3 ? 'n' : null, s)));
      const th = el('thead'); th.append(hr);
      parts.forEach((p) => {
        const m = seasons.find((s) => s.id === p.item_id), tr = el('tr');
        tr.append(el('td', 'tv-no', `S${m.series_no} E${p.no}`), el('td', null, p.title), el('td', 'n', mins(p.minutes)), el('td', 'n', fDay(pDate(p.first))), el('td', null, p.completed ? (p.plays > 1 ? `✓ ${p.plays} sittings` : '✓') : 'part'));
        tb.append(tr);
      });
      tbl.append(th, tb); wrap.append(tbl); eps.append(wrap);
      root.replaceChildren(head, list, binge, ...(parts.length ? [eps] : []));

      const rows = (ok('tv_binge') || []).filter((r) => r.show_id === id).sort((a, b) => a.season - b.season);
      if (!rows.length) { binge.hidden = true; return; }
      const maxSpan = Math.min(180, d3.max(rows, (r) => r.span) || 1), rowH = 30, m = { t: 22, r: 70, l: 70 }, h = m.t + rows.length * rowH + 4;
      const { svg, w, tip } = svgIn(bingeBox, h);
      const x = d3.scaleLinear([0, maxSpan], [m.l + 12, w - m.r]).clamp(true);
      const r = d3.scaleSqrt([0, d3.max(rows, (s) => d3.max(s.points, (p) => p.eps)) || 1], [0, 11]);
      axis(svg.append('g').attr('transform', `translate(0,${m.t - 8})`), d3.axisTop(x).ticks(Math.min(Math.floor((w - m.l - m.r) / 80), 6, maxSpan)).tickFormat((d) => (d ? `day ${d + 1}` : 'start')).tickSize(0));
      svg.selectAll('.domain').remove();
      rows.forEach((row, i) => {
        const y = m.t + i * rowH + rowH / 2;
        svg.append('text').attr('class', 'axl').attr('x', m.l - 10).attr('y', y).attr('dy', '0.35em').attr('text-anchor', 'end').text(`Season ${row.season}`);
        bingeStrip(svg, row, x, y, r, tip, bingeBox);
        svg.append('text').attr('class', 'axl').attr('x', w - m.r + 8).attr('y', y).attr('dy', '0.35em').text(`${Math.round(row.rate * 10) / 10}/day`);
      });
    },
  });

  // ---------- film page ----------
  rh.register('film', {
    draw(id, root) {
      const items = ok('tv_books');
      if (!items) return root.replaceChildren(el('div', 'dy-empty', 'Loading…'));
      const f = items.find((m) => m.id === id && m.media === 'film');
      if (!f) { setTitle('Film'); return root.replaceChildren(notFound('No such film in your watch history.')); }
      setTitle(f.title);
      const head = el('div', 'rh-card wide bk-head tv-head'), info = el('div', 'go-info');
      info.append(el('div', 'bk-title', f.title));
      info.append(el('div', 'go-sub', [f.year, f.creator ? `directed by ${f.creator}` : null, f.series].filter(Boolean).join(' · ')));
      const chips = el('div', 'bk-chips');
      [f.genre, f.subgenre].filter((g) => g && g !== 'Untagged').forEach((g) => { const c = el('span', 'chip', g); c.style.color = tvColor(g); chips.append(c); });
      chips.append(el('span', 'chip' + (f.status === 'finished' ? ' ok' : ''), f.status === 'finished' ? (f.times > 1 ? `Watched ${f.times} times` : 'Watched') : `Got ${Math.round(f.progress || 0)}% through`));
      info.append(chips);
      const facts = el('dl', 'go-facts'), fact = (k, v) => { if (v) facts.append(el('dt', null, k), el('dd', null, v)); };
      fact('First watched', fDay(pDate(f.first)));
      if (f.last !== f.first) fact('Last watched', fDay(pDate(f.last)));
      fact('Time watched', mins(f.hours * 60));
      info.append(facts);
      head.append(poster(f, 'lg'), info);
      const c = el('div', 'rh-card wide');
      c.append(el('h2', null, 'Sittings'), el('p', 'note', 'Each time you pressed play.'));
      const ul = el('ul', 'rh-list');
      (ok('media_sessions') || []).filter((s) => s.item_id === id).forEach((s) => {
        const when = new Date(s.start), li = el('li');
        li.append(el('div', 'ttl', when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })), el('div', 'meta', [mins(s.minutes), s.progress != null ? Math.round(s.progress) + '%' : null, s.device].filter(Boolean).join(' · ')));
        ul.append(li);
      });
      c.append(ul);
      root.replaceChildren(head, c);
    },
  });
})();
