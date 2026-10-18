// Reading and watching together: hours split by medium, whether big TV weeks crowd out reading,
// books you've also seen on screen (and which came first), and the year page's combined review.
// Loads after tv.js (by name), so its cards can sit among the TV ones.
(() => {
  const { el, fmt, pDate, fDay, fShort, C, svgIn, showTip, hideTip, tipLines, axis, legend, link, linkBook, plural, barPath, grow } = rh;
  const arr = (x) => (Array.isArray(x) ? x : []);
  const isScreen = (m) => m.media === 'tv' || m.media === 'film';
  const DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z');
  const hrs = (h) => (h >= 10 ? fmt(Math.round(h)) : String(Math.round(h * 10) / 10));
  const ok = (id) => { const r = dash.data(id); return r.status === 'ok' ? r.data : null; };
  const isOther = (m) => isScreen(m) || m.media === 'audiobook';
  const hasMedia = () => (ok('media_items') || []).some(isOther);
  const MEDIUM = { reading: [C[0], 'Reading'], watching: [C[1], 'Watching'], listening: [C[2], 'Listening'] };
  // which of those a day's row counts towards
  const kindOf = (media) => (media === 'book' ? 'reading' : media === 'audiobook' ? 'listening' : 'watching');
  // Monday of the week a date falls in
  const weekOf = (date) => { const d = new Date(t(date)); return new Date(d - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10); };

  dash.calc('x_all_daily', {
    inputs: ['daily', 'media_daily'], title: 'Every day, every medium',
    description: 'Minutes per day per book, season, film or audiobook, tagged with its medium (book, tv, film or audiobook).',
    fn: (daily, mediaDaily) => [
      ...daily.filter((d) => d.minutes > 0).map((d) => ({ date: d.date, media: 'book', id: d.book_id, title: d.title, minutes: d.minutes })),
      ...arr(mediaDaily).filter((d) => isOther(d) && d.minutes > 0).map((d) => ({ date: d.date, media: d.media, id: d.item_id, title: d.title, minutes: d.minutes })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  });

  dash.calc('x_split_month', {
    inputs: ['x_all_daily'], title: 'Reading and watching per month',
    description: 'Hours read, watched (TV and film) and listened to (audiobooks) in each month from the first to the last day any was logged.',
    fn: (all) => {
      if (!all.length) return [];
      const m = new Map();
      const zero = () => ({ reading: 0, watching: 0, listening: 0 });
      all.forEach((d) => { const k = d.date.slice(0, 7), r = m.get(k) || zero(); r[kindOf(d.media)] += d.minutes / 60; m.set(k, r); });
      const out = [];
      let [y, mo] = all[0].date.slice(0, 7).split('-').map(Number);
      const last = all[all.length - 1].date.slice(0, 7);
      for (;;) {
        const k = `${y}-${String(mo).padStart(2, '0')}`, r = m.get(k) || zero(), r1 = (v) => Math.round(v * 10) / 10;
        out.push({ month: k, reading: r1(r.reading), watching: r1(r.watching), listening: r1(r.listening) });
        if (k >= last) break;
        mo++; if (mo > 12) { mo = 1; y++; }
      }
      return out;
    },
  });

  dash.calc('x_weeks', {
    inputs: ['x_all_daily'], title: 'TV weeks and reading weeks',
    description: 'Hours read and watched in each week (Monday to Sunday) while both were being logged, how closely they move together (correlation), and the average reading in weeks with no TV against the busiest quarter of TV weeks.',
    fn: (rows0) => {
      const all = rows0.filter((d) => kindOf(d.media) !== 'listening');
      const books = all.filter((d) => d.media === 'book'), screen = all.filter((d) => d.media !== 'book');
      if (!books.length || !screen.length) return [];
      const from = [books[0].date, screen[0].date].sort()[1], to = [books[books.length - 1].date, screen[screen.length - 1].date].sort()[0];
      if (from > to) return [];
      const weeks = new Map();
      for (let d = t(weekOf(from)); d <= t(to); d += 7 * DAY) weeks.set(new Date(d).toISOString().slice(0, 10), { week: new Date(d).toISOString().slice(0, 10), reading: 0, watching: 0 });
      all.forEach((d) => { const w = weeks.get(weekOf(d.date)); if (w && d.date >= from && d.date <= to) w[d.media === 'book' ? 'reading' : 'watching'] += d.minutes / 60; });
      const rows = [...weeks.values()].map((w) => ({ ...w, reading: Math.round(w.reading * 10) / 10, watching: Math.round(w.watching * 10) / 10 }));
      // plain sums (calcs don't need d3): correlation, and the top quartile of TV weeks
      const n = rows.length, sum = (f, xs = rows) => xs.reduce((s, r) => s + f(r), 0), mean = (f, xs) => (xs.length ? sum(f, xs) / xs.length : null);
      const mx = sum((r) => r.watching) / n, my = sum((r) => r.reading) / n;
      const cov = sum((r) => (r.watching - mx) * (r.reading - my)), sx = Math.sqrt(sum((r) => (r.watching - mx) ** 2)), sy = Math.sqrt(sum((r) => (r.reading - my) ** 2));
      const tv = rows.filter((r) => r.watching > 0).map((r) => r.watching).sort((a, b) => a - b);
      const cut = tv.length ? tv[Math.floor((tv.length - 1) * 0.75)] : Infinity;
      const none = rows.filter((r) => r.watching === 0), heavy = rows.filter((r) => r.watching > 0 && r.watching >= cut);
      const summary = { r: sx && sy ? cov / (sx * sy) : 0, weeks: n, none_weeks: none.length, heavy_weeks: heavy.length, cut,
        read_none: mean((r) => r.reading, none), read_heavy: mean((r) => r.reading, heavy) };
      return rows.map((r) => ({ ...r, heavy: r.watching > 0 && r.watching >= cut, summary }));
    },
  });

  // titles compared without case, accents, punctuation or a leading "The"
  const norm = (s) => String(s || '').normalize('NFKD').replace(/[^\p{ASCII}]/gu, '').toLowerCase().replace(/&/g, 'and').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '');
  dash.calc('x_adaptations', {
    inputs: ['books', 'reads', 'media_items', 'media_runs'], title: 'Book to screen',
    description: 'Films and shows that adapt a book in your library, matched by title (or by "book" in media/catalogue.json), with whether you read it or watched it first.',
    fn: (books, reads, items, runs) => {
      const byTitle = new Map(books.map((b) => [norm(b.title), b])), byExact = new Map(books.map((b) => [b.title.toLowerCase(), b]));
      const shows = new Map();
      arr(items).filter(isScreen).forEach((m) => {
        const key = m.media === 'tv' ? m.series_id : m.id;
        const s = shows.get(key) || { media: m.media, key, name: m.media === 'tv' ? m.series : m.title, adapts: m.adapts, first: m.first, finished: false, year: m.year, ids: [] };
        if (m.first && m.first < s.first) s.first = m.first;
        if (m.status === 'finished') s.finished = true;
        s.adapts = s.adapts || m.adapts; s.ids.push(m.id);
        shows.set(key, s);
      });
      const firstRead = new Map();
      reads.forEach((r) => { const d = r.start; if (d && (!firstRead.has(r.book_id) || d < firstRead.get(r.book_id))) firstRead.set(r.book_id, d); });
      const out = [];
      shows.forEach((s) => {
        const b = s.adapts ? byExact.get(s.adapts.toLowerCase()) || byTitle.get(norm(s.adapts)) : byTitle.get(norm(s.name));
        if (!b) return;
        const read = firstRead.get(b.id) || b.first_read;
        if (!read || !s.first) return;
        const gap = Math.round((t(s.first) - t(read)) / DAY);
        out.push({ book_id: b.id, title: b.title, author: b.author, genre: b.genre, read, book_status: b.status,
          media: s.media, ...(s.media === 'tv' ? { show: s.name, show_id: s.key } : { film: s.name, film_id: s.key }), screen_title: s.name, poster_id: s.ids[s.ids.length - 1],
          watched: s.first, first: gap >= 0 ? 'read' : 'watched', gap_days: Math.abs(gap) });
      });
      return out.sort((a, b) => (a.watched < b.watched ? 1 : -1));
    },
  });

  const gapText = (d) => (d < 2 ? 'the same day' : d < 60 ? plural(d, 'day') : d < 730 ? plural(Math.round(d / 30.4), 'month') : plural(Math.round(d / 365.25), 'year'));
  const empty = (box, text) => box.replaceChildren(el('div', 'dy-empty', text));

  // ---------- hours split by medium (Overview, only with TV or film) ----------
  rh.card({
    tab: 'overview', id: 'x-split', title: 'Reading and watching', calc: 'x_split_month', hidden: () => !hasMedia(),
    note: 'Hours read, hours of TV and film, and hours of audiobooks each month, stacked.',
    draw(box, rows) {
      if (!rows.length) return empty(box, 'Nothing logged yet.');
      const keys = ['reading', 'watching', 'listening'].filter((k) => rows.some((r) => r[k] > 0));
      const last12 = rows.slice(-12), tot = Object.fromEntries(keys.map((k) => [k, d3.sum(last12, (r) => r[k])])), all = d3.sum(keys, (k) => tot[k]);
      const verb = { reading: 'reading', watching: 'watching', listening: 'listening' };
      const line = el('p', 'x-line');
      keys.forEach((k, i) => { if (i) line.append(i === keys.length - 1 ? ' and ' : ', '); line.append(el('b', null, `${hrs(tot[k])} h`), ` ${verb[k]}`); });
      line.append(` in the last 12 months: ${all ? Math.round(((tot.reading || 0) / all) * 100) : 0}% of it on books.`);
      const chart = el('div', 'x-chart'), leg = el('div', 'legend');
      legend(leg, keys.map((k) => MEDIUM[k]));
      box.replaceChildren(line, chart, leg);
      const h = 220, m = { t: 10, r: 6, b: 24, l: 30 }, { svg, w, tip } = svgIn(chart, h);
      const x = d3.scaleBand(rows.map((r) => r.month), [m.l, w - m.r]).padding(0.15);
      const total = (r) => d3.sum(keys, (k) => r[k]);
      const y = d3.scaleLinear([0, d3.max(rows, total) || 1], [h - m.b, m.t]).nice();
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)));
      svg.selectAll('.domain').remove();
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(rows.filter((r) => r.month.endsWith('-01')).map((r) => r.month)).tickFormat((s) => s.slice(0, 4)).tickSize(0));
      const bw = x.bandwidth(), rad = Math.min(2, bw / 2);
      d3.stack().keys(keys)(rows).forEach((layer, li) => {
        svg.append('g').selectAll('path').data(layer).join('path').attr('fill', MEDIUM[layer.key][0])
          .call(grow, 'd', (d) => barPath(x(d.data.month), y(d[0]), bw, 0, 'up', 0), (d) => {
            const top = keys.slice(li + 1).every((k) => !d.data[k]);
            const gap = li && d[0] > 0 ? 1 : 0; // a hairline between stacked parts
            return barPath(x(d.data.month), y(d[1]), bw, Math.max(0, y(d[0]) - y(d[1]) - gap), 'up', top ? rad : 0);
          });
      });
      svg.selectAll('rect.hit').data(rows).join('rect').attr('class', 'hit').attr('x', (r) => x(r.month)).attr('width', bw).attr('y', m.t).attr('height', h - m.t - m.b)
        .on('mousemove', (e, r) => showTip(tip, chart, e, (tp) => tipLines(tp, fShort(pDate(r.month + '-01')), keys.map((k) => [MEDIUM[k][0], MEDIUM[k][1], `${r[k]} h`]))))
        .on('mouseleave', () => hideTip(tip));
    },
  });

  // ---------- TV weeks vs reading weeks ----------
  rh.card({
    tab: 'tv', id: 'x-weeks', title: 'Do TV weeks crowd out reading?', calc: 'x_weeks', after: 'card-tv-month', chartClass: 'tv-auto',
    note: 'Each dot is a week: hours watched across, hours read up. The busiest quarter of TV weeks is filled in.',
    draw(box, rows) {
      if (rows.length < 8) return empty(box, 'Not enough weeks with both reading and watching yet.');
      const s = rows[0].summary, verdict = el('p', 'x-line');
      const diff = s.read_none != null && s.read_heavy != null ? s.read_heavy - s.read_none : null;
      verdict.append(diff == null ? 'Too few weeks to compare.' : Math.abs(diff) < 0.5 ? 'Not really: you read about as much in big TV weeks as in weeks with none.'
        : diff < 0 ? `Yes: in your biggest TV weeks you read ${hrs(-diff)} h less than in weeks with no TV (${hrs(s.read_heavy)} h against ${hrs(s.read_none)} h).`
          : `No: in your biggest TV weeks you read ${hrs(diff)} h more than in weeks with no TV (${hrs(s.read_heavy)} h against ${hrs(s.read_none)} h).`);
      verdict.append(` Correlation ${s.r >= 0 ? '+' : '−'}${Math.abs(s.r).toFixed(2)} over ${plural(s.weeks, 'week')}.`);
      const chart = el('div', 'x-chart');
      box.replaceChildren(verdict, chart);
      const h = 230, m = { t: 10, r: 10, b: 30, l: 34 }, { svg, w, tip } = svgIn(chart, h);
      const x = d3.scaleLinear([0, d3.max(rows, (r) => r.watching) || 1], [m.l, w - m.r]).nice(), y = d3.scaleLinear([0, d3.max(rows, (r) => r.reading) || 1], [h - m.b, m.t]).nice();
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)));
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(5).tickSize(0).tickFormat((v) => v + ' h'));
      svg.selectAll('.domain').remove();
      svg.append('text').attr('class', 'axl').attr('x', w - m.r).attr('y', h - 2).attr('text-anchor', 'end').text('hours watched');
      svg.append('text').attr('class', 'axl').attr('x', m.l + 16).attr('y', m.t + 4).text('hours read');
      svg.append('g').selectAll('circle').data(rows).join('circle').attr('class', 'ring').attr('cx', (r) => x(r.watching)).attr('cy', (r) => y(r.reading))
        .attr('fill', (r) => (r.heavy ? C[1] : 'var(--cds-chart-muted)')).attr('fill-opacity', (r) => (r.heavy ? 0.9 : 0.6)).call(grow, 'r', 0, 4)
        .on('mousemove', (e, r) => showTip(tip, chart, e, (tp) => tipLines(tp, `Week of ${fDay(pDate(r.week))}`, [[MEDIUM.reading[0], 'Read', `${r.reading} h`], [MEDIUM.watching[0], 'Watched', `${r.watching} h`]])))
        .on('mouseleave', () => hideTip(tip));
    },
  });

  // ---------- book to screen ----------
  function adaptRow(a, small) {
    const li = link(el('li', 'x-adapt'), a.media === 'tv' ? 'show' : 'film', a.media === 'tv' ? a.show_id : a.film_id);
    const pics = el('div', 'x-pics');
    const item = (ok('media_items') || []).find((m) => m.id === a.poster_id);
    const pic = item && rh.mediaPoster ? rh.mediaPoster({ ...item, genre: item.genre || 'Untagged' }, small ? 'sm' : null) : rh.cover(a.poster_id, a.screen_title, null, small ? 'sm' : null);
    pics.append(linkBook(rh.cover(a.book_id, a.title, a.genre, small ? 'sm' : null), a.book_id), pic);
    const txt = el('div', 'ttl');
    txt.append(document.createTextNode(a.screen_title));
    const sub = el('small');
    sub.append(a.media === 'tv' ? 'Series' : 'Film', ' of ', linkBook(el('span', 'lk', a.title), a.book_id));
    txt.append(sub);
    const when = a.first === 'read' ? `Read first, ${gapText(a.gap_days)} before` : `Watched first, ${gapText(a.gap_days)} before reading`;
    li.append(pics, txt, el('div', 'meta x-' + a.first, when));
    return li;
  }

  rh.card({
    tab: 'tv', id: 'x-adapt', title: 'Book to screen', calc: 'x_adaptations', chartClass: 'tv-auto',
    note: 'Films and shows of books in your library, and which you got to first. Titles are matched as they are; for a different title, add "book" to the film in media/catalogue.json.',
    draw(box, rows) {
      if (!rows.length) return empty(box, 'None of your films or shows matches a book in your library yet.');
      const read = rows.filter((r) => r.first === 'read').length;
      const p = el('p', 'x-line');
      p.append(el('b', null, `${read} of ${rows.length}`), ` you read before you watched${rows.length - read ? `; ${rows.length - read} you saw on screen first` : ''}.`);
      const ul = el('ul', 'rh-list');
      rows.forEach((a) => ul.append(adaptRow(a)));
      box.replaceChildren(p, ul);
    },
  });

  // on a book's page: its adaptations
  rh.bookCard({
    id: 'bk-screen', title: 'On screen', calc: 'x_adaptations', before: 'card-bk-log', wide: false, chartClass: 'tv-auto',
    draw(box, rows, parts, b) {
      const mine = rows.filter((a) => a.book_id === b.id);
      if (!mine.length) return false;
      const ul = el('ul', 'rh-list');
      mine.forEach((a) => ul.append(adaptRow(a, true)));
      box.replaceChildren(ul);
    },
  });

  // on a show's or film's page: the book it adapts
  const fromBook = (kind) => (id, root) => {
    const a = (ok('x_adaptations') || []).find((x) => (kind === 'show' ? x.show_id : x.film_id) === id);
    if (!a) return;
    const c = el('div', 'rh-card wide'), ul = el('ul', 'rh-list');
    c.append(el('h2', null, 'From the book'));
    const li = linkBook(el('li'), a.book_id), txt = el('div', 'ttl');
    txt.append(document.createTextNode(a.title), rh.byline('small', null, a, ['author']));
    li.append(rh.cover(a.book_id, a.title, a.genre), txt, el('div', 'meta', a.first === 'read' ? `Read ${gapText(a.gap_days)} before watching` : `Watched ${gapText(a.gap_days)} before reading`));
    ul.append(li); c.append(ul);
    const head = root.querySelector('.tv-head');
    if (head) head.after(c); else root.append(c);
  };
  rh.extend('show', fromBook('show'));
  rh.extend('film', fromBook('film'));

  // ---------- Wrapped: your year on screen ----------
  dash.calc('x_year_screen', {
    inputs: ['x_all_daily', 'media_items', 'media_runs'], title: 'Watching and listening by year',
    description: 'For each year with any TV, film or audiobook time: hours read, watched and listened to, seasons and films finished, audiobooks listened to, and the most-watched show.',
    fn: (days, items, runs) => {
      const byId = new Map(arr(items).map((m) => [m.id, m]));
      const out = new Map();
      const year = (y) => out.get(y) || out.set(y, { year: +y, read: 0, watched: 0, listened: 0, shows: new Map(), heard: new Set(), seasons: 0, films: 0 }).get(y);
      days.forEach((d) => {
        const y = year(d.date.slice(0, 4)), k = kindOf(d.media), h = d.minutes / 60;
        if (k === 'reading') y.read += h;
        else if (k === 'listening') { y.listened += h; y.heard.add(d.id); }
        else {
          y.watched += h;
          const m = byId.get(d.id);
          if (d.media === 'tv' && m && m.series_id) y.shows.set(m.series_id, { show_id: m.series_id, show: m.series, hours: ((y.shows.get(m.series_id) || {}).hours || 0) + h });
        }
      });
      arr(runs).filter((r) => isScreen(r) && r.finished && r.end).forEach((r) => {
        const y = out.get(r.end.slice(0, 4));
        if (y) { if (r.media === 'tv') y.seasons++; else y.films++; }
      });
      const r1 = (h) => Math.round(h * 10) / 10;
      return [...out.values()].filter((y) => y.watched > 0 || y.listened > 0).sort((a, b) => a.year - b.year).map((y) => {
        const top = [...y.shows.values()].sort((a, b) => b.hours - a.hours)[0] || null;
        return {
          year: y.year, read: r1(y.read), watched: r1(y.watched), listened: r1(y.listened),
          seasons: y.seasons, films: y.films, shows: y.shows.size, audiobooks: y.heard.size,
          top_show: top ? { show_id: top.show_id, show: top.show, hours: r1(top.hours) } : null,
        };
      });
    },
  });

  rh.wrappedSlide({
    id: 'screen', after: 'genres',
    show: (R) => !!(ok('x_year_screen') || []).find((y) => y.year === R.year),
    build(s, R, ui) {
      const y = (ok('x_year_screen') || []).find((x) => x.year === R.year);
      const so = R.partial ? ' so far' : '';
      const total = y.read + y.watched + y.listened;
      if (y.watched >= 1) {
        s.append(ui.kicker(`Your year on screen${so}`), ui.big(Math.round(y.watched), Math.round(y.watched) === 1 ? 'hour watched' : 'hours watched'));
        const bits = [];
        if (y.seasons) bits.push(ui.plural(y.seasons, 'season'));
        if (y.films) bits.push(ui.plural(y.films, 'film'));
        s.append(ui.line('wr-line', bits.length ? `${bits.join(' and ')} finished.` : `Across ${ui.plural(y.shows, 'show')}.`));
        if (y.top_show) s.append(ui.line('wr-sub wr-links', 'Most watched: ', link(el('span', 'lk', y.top_show.show), 'show', y.top_show.show_id), `, ${ui.plural(Math.round(y.top_show.hours), 'hour')}.`));
      } else {
        s.append(ui.kicker(`Your year in your ears${so}`), ui.big(Math.round(y.listened), Math.round(y.listened) === 1 ? 'hour listened' : 'hours listened'));
        s.append(ui.line('wr-line', `${ui.plural(y.audiobooks, 'audiobook')}.`));
      }
      // reading against watching and listening, as one bar
      const bar = el('div', 'wr-gbar wr-r'), key = el('p', 'wr-sub wr-r x-wr-key');
      [['reading', y.read], ['watching', y.watched], ['listening', y.listened]].filter(([, h]) => h > 0).forEach(([k, h]) => {
        const i = el('i'); i.style.flex = h; i.style.background = MEDIUM[k][0]; i.title = `${MEDIUM[k][1]}: ${hrs(h)} h`; bar.append(i);
        const part = el('span'), sw = el('i', 'sw'); sw.style.background = MEDIUM[k][0];
        part.append(sw, `${MEDIUM[k][1]} ${Math.round((h / total) * 100)}%`); key.append(part);
      });
      s.append(bar, key);
      if (y.watched >= 1 && y.listened >= 1) s.append(ui.line('wr-sub', `Plus ${ui.plural(Math.round(y.listened), 'hour')} of ${ui.plural(y.audiobooks, 'audiobook')}.`));
      else if (y.read > y.watched) s.append(ui.line('wr-sub', `You still read more than you watched: ${hrs(y.read)} hours of books.`));
      else if (y.watched > 0) s.append(ui.line('wr-sub', `${hrs(y.watched)} hours on screen against ${hrs(y.read)} with a book.`));
    },
  });

  // ---------- the year page: reading and watching that year ----------
  rh.extend('year', (id, root) => {
    const items = (ok('media_items') || []).filter(isScreen), days = ok('x_all_daily') || [];
    const year = String(id), inYear = days.filter((d) => d.date.startsWith(year + '-'));
    const watched = inYear.filter((d) => kindOf(d.media) === 'watching'), heard = inYear.filter((d) => kindOf(d.media) === 'listening');
    if (!watched.length && !heard.length) return;
    const L = d3.sum(heard, (d) => d.minutes) / 60;
    const R = d3.sum(inYear.filter((d) => d.media === 'book'), (d) => d.minutes) / 60, W = d3.sum(watched, (d) => d.minutes) / 60;
    const runs = arr(ok('media_runs')).filter((r) => isScreen(r) && r.finished && r.end && r.end.startsWith(year + '-'));
    const showHours = new Map();
    watched.filter((d) => d.media === 'tv').forEach((d) => { const m = items.find((x) => x.id === d.id); if (m) showHours.set(m.series_id, (showHours.get(m.series_id) || 0) + d.minutes / 60); });
    const top = [...showHours].sort((a, b) => b[1] - a[1])[0], topItem = top && items.find((m) => m.series_id === top[0]);
    const c = el('div', 'rh-card wide x-year'), k = el('div', 'rh-kpis');
    c.append(el('h2', null, `Reading and watching in ${year}`), el('p', 'note', 'Your books and your TV and film together.'));
    const kpi = (lbl, val, sub, node) => { const d = node || el('div', 'rh-kpi'); d.className = 'rh-kpi'; d.append(el('div', 'lbl', lbl), el('div', 'val' + (val.length > 12 ? ' val-sm' : ''), val)); if (sub) d.append(el('div', 'sub', sub)); return d; };
    k.append(
      kpi('Hours read', hrs(R), `${R + W + L ? Math.round((R / (R + W + L)) * 100) : 0}% of your reading, watching and listening`),
      kpi('Hours watched', hrs(W), `${plural(runs.filter((r) => r.media === 'tv').length, 'season')} and ${plural(runs.filter((r) => r.media === 'film').length, 'film')} finished`));
    if (L) k.append(kpi('Hours listened', hrs(L), `${plural(new Set(heard.map((d) => d.id)).size, 'audiobook')}`));
    if (topItem) k.append(kpi('Most watched', topItem.series, `${hrs(top[1])} h`, link(el('div'), 'show', topItem.series_id)));
    const adapt = (ok('x_adaptations') || []).filter((a) => a.watched.startsWith(year + '-') || a.read.startsWith(year + '-'));
    c.append(k);
    if (adapt.length) {
      const ul = el('ul', 'rh-list x-year-adapt');
      adapt.forEach((a) => ul.append(adaptRow(a, true)));
      c.append(el('h3', 'x-h3', 'Book to screen'), ul);
    }
    const head = root.querySelector('.wr-banner') || root.querySelector('.yr-head');
    if (head) head.after(c); else root.append(c);
  });
})();
