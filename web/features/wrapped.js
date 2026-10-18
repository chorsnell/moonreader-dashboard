// Reading Wrapped: a year in review on the year page, as swipeable stories (phones) or a
// scroll-driven story (desktop), ending with a card image to save or share
(() => {
  const { el, fmt, pDate, fDay } = rh;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  dash.calc('wrapped', {
    inputs: ['books', 'reads', 'daily', 'as_of', 'records', 'word_units'], title: 'Year in review',
    description: 'One row per year: totals, month by month, peak and quiet months, biggest day, longest streak, fastest and longest books, new authors, genres, records broken that year and a word-count comparison.',
    fn: (books, reads, daily, as_of, records, units) => {
      const end = as_of[0].date, DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z');
      const span = (a, b) => Math.round((t(b) - t(a)) / DAY) + 1;
      const ok = (d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800;
      const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
      const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      const genreOf = new Map(books.map((b) => [b.id, b.genre]));
      const years = new Set();
      reads.forEach((r) => { if (r.start) years.add(r.start.slice(0, 4)); if (r.end) years.add(r.end.slice(0, 4)); });
      daily.forEach((d) => years.add(d.date.slice(0, 4)));
      // when you first opened anything by each author
      const firstBy = new Map();
      reads.forEach((r) => { if (r.author && r.start && (!firstBy.has(r.author) || r.start < firstBy.get(r.author))) firstBy.set(r.author, r.start); });
      const logStart = daily.reduce((m, d) => (d.date < m ? d.date : m), end);
      const byBook = new Map();
      daily.forEach((d) => { if (ok(d)) { if (!byBook.has(d.book_id)) byBook.set(d.book_id, []); byBook.get(d.book_id).push(d); } });

      return [...years].filter((y) => y <= end.slice(0, 4)).sort().map((Y) => {
        const yr = +Y, inY = (s) => !!s && s.slice(0, 4) === Y, partial = end.slice(0, 4) === Y;
        const fin = reads.filter((r) => r.finished === true && inY(r.end)).sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
        const days = daily.filter((d) => inY(d.date) && (d.minutes > 0 || d.words > 0));
        const minutes = sum(days, (d) => d.minutes), words = sum(days, (d) => d.words);
        const dayMap = new Map();
        days.forEach((d) => {
          const r = dayMap.get(d.date) || { date: d.date, minutes: 0, words: 0, books: [] };
          r.minutes += d.minutes || 0; r.words += d.words || 0;
          if (!r.books.some((b) => b.book_id === d.book_id)) r.books.push({ book_id: d.book_id, title: d.title });
          dayMap.set(d.date, r);
        });
        const dates = [...dayMap.keys()].sort();
        const yearDays = partial ? span(Y + '-01-01', end) : span(Y + '-01-01', Y + '-12-31');
        const months = MONTHS.map((_, i) => {
          const k = `${Y}-${String(i + 1).padStart(2, '0')}`;
          return { month: i + 1, minutes: Math.round(sum(days.filter((d) => d.date.startsWith(k)), (d) => d.minutes)), finished: fin.filter((r) => r.end.startsWith(k)).length };
        });
        // months the log could have covered
        const lastM = partial ? +end.slice(5, 7) : 12, firstM = logStart.slice(0, 4) === Y ? +logStart.slice(5, 7) : logStart.slice(0, 4) < Y ? 1 : 13;
        const span_m = months.filter((m) => m.month >= firstM && m.month <= lastM);
        const peak = minutes ? span_m.reduce((a, m) => (m.minutes > a.minutes ? m : a)) : null;
        const quiet = minutes && span_m.length > 2 ? span_m.reduce((a, m) => (m.minutes < a.minutes ? m : a)) : null;
        const bookMonth = fin.length ? months.reduce((a, m) => (m.finished > a.finished ? m : a)) : null;
        const big = dates.length ? [...dayMap.values()].reduce((a, d) => (d.minutes > a.minutes ? d : a)) : null;
        let streak = null, s = null;
        dates.forEach((d, i) => {
          if (!i || t(d) - t(dates[i - 1]) !== DAY) s = d;
          if (!streak || span(s, d) > streak.days) streak = { start: s, end: d, days: span(s, d) };
        });
        const timed = fin.map((r) => {
          const v = (byBook.get(r.book_id) || []).filter((d) => d.date >= r.start && d.date <= r.end), m = sum(v, (d) => d.minutes);
          return m >= 30 ? { book_id: r.book_id, title: r.title, author: r.author, wpm: Math.round(sum(v, (d) => d.words) / m) } : null;
        }).filter(Boolean);
        const fastest = timed.length ? timed.reduce((a, r) => (r.wpm > a.wpm ? r : a)) : null;
        const withH = fin.filter((r) => r.hours);
        const longest = withH.length ? withH.reduce((a, r) => (r.hours > a.hours ? r : a)) : null;
        const authorsY = new Map(), genres = new Map();
        fin.forEach((r) => {
          if (r.author) authorsY.set(r.author, (authorsY.get(r.author) || 0) + 1);
          const g = r.genre || genreOf.get(r.book_id) || 'Untagged';
          genres.set(g, (genres.get(g) || 0) + 1);
        });
        const touched = new Set(reads.filter((r) => inY(r.start) || inY(r.end)).map((r) => r.author).filter(Boolean));
        const newAuthors = [...touched].filter((a) => inY(firstBy.get(a))).map((author) => ({ author, finished: authorsY.get(author) || 0 }))
          .sort((a, b) => b.finished - a.finished || (a.author < b.author ? -1 : 1));
        const broken = records.map((r) => {
          const hits = r.history.map((e, i) => ({ ...e, i })).filter((e) => e.i > 0 && inY(e.date));
          if (!hits.length) return null;
          const last = hits[hits.length - 1];
          return { id: r.id, label: r.label, unit: r.unit, value: last.value, date: last.date, times: hits.length, standing: last.i === r.history.length - 1 };
        }).filter(Boolean);
        const ratios = units.map((u) => ({ id: u.id, one: u.one, many: u.many, times: words / u.words }));
        const comparison = words ? ['war_and_peace', 'kjv', 'lotr', 'hobbit'].map((id) => ratios.find((u) => u.id === id)).find((u) => u && u.times >= 1.5) || ratios.find((u) => u.id === 'hobbit') : null;
        // last year, to the same date if this one isn't over
        const md = partial ? end.slice(5) : '12-31', inPrev = (x) => !!x && x.slice(0, 4) === String(yr - 1) && x.slice(5) <= md;
        return {
          year: yr, partial, as_of: end,
          finished: fin.length, rereads: fin.filter((r) => r.read_no > 1).length, started: reads.filter((r) => inY(r.start)).length,
          minutes: Math.round(minutes), words, days_read: dates.length, year_days: yearDays,
          months, peak_month: peak, quiet_month: quiet && peak && quiet.month !== peak.month ? quiet : null, book_month: bookMonth,
          biggest_day: big && big.minutes > 0 ? { ...big, minutes: Math.round(big.minutes) } : null,
          longest_streak: streak,
          fastest, longest: longest ? { book_id: longest.book_id, title: longest.title, author: longest.author, hours: longest.hours, days_read: longest.days_read } : null,
          new_authors: newAuthors, top_authors: top(authorsY).slice(0, 5).map(([author, n]) => ({ author, finished: n })),
          genres: top(genres).map(([genre, n]) => ({ genre, finished: n })),
          records_broken: broken, comparison, yardsticks: ratios,
          prev: years.has(String(yr - 1)) ? { year: yr - 1, finished: reads.filter((r) => r.finished === true && inPrev(r.end)).length, minutes: Math.round(sum(daily.filter((d) => inPrev(d.date)), (d) => d.minutes)) } : null,
          books: fin.map((r) => ({ book_id: r.book_id, title: r.title, genre: r.genre || genreOf.get(r.book_id) })),
        };
      });
    },
  });

  // ---------- helpers ----------
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hrs = (m) => Math.round(m / 60);
  const times = (n) => (n >= 10 ? fmt(Math.round(n)) : (Math.round(n * 10) / 10).toString());
  const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'k' : fmt(n));
  const plural = (n, w, ws = w + 's') => `${fmt(n)} ${n === 1 ? w : ws}`;
  const mins = (v) => (v >= 60 ? `${Math.floor(v / 60)} h ${Math.round(v % 60)} min` : `${Math.round(v)} min`);
  const low = (g) => (/[A-Z]{2}/.test(g) ? g : g.toLowerCase());
  // a big number that counts up when its slide is revealed
  const big = (n, unit, f = fmt) => {
    const b = el('div', 'wr-big wr-r');
    const v = el('span', 'wr-num', f(n));
    v.dataset.count = n; v.dataset.f = f === short ? 'short' : 'int';
    b.append(v);
    if (unit) b.append(el('span', 'wr-unit', unit));
    return b;
  };
  const line = (cls, ...parts) => { const p = el('p', cls + ' wr-r'); p.append(...parts.filter((x) => x != null && x !== '')); return p; };
  const kicker = (s) => el('div', 'wr-kicker wr-r', s);
  const bookLink = (b) => rh.linkBook(el('span', 'lk', b.title), b.book_id);

  // ---------- the slides ----------
  function slides(R) {
    const Y = R.year, so = R.partial ? ' so far' : '', out = [];
    const add = (id, build) => out.push({ id, build });

    add('intro', (s) => {
      s.append(kicker(R.partial ? `Your year in reading, so far` : 'Your year in reading'), el('div', 'wr-year wr-r', String(Y)));
      const bits = [plural(R.finished, 'book')];
      if (R.minutes) bits.push(plural(hrs(R.minutes), 'hour'));
      if (R.new_authors.length) bits.push(plural(R.new_authors.length, 'new author'));
      s.append(line('wr-line', bits.join(' · ') + '.'), line('wr-hint', el('span', 'only-stories', 'Tap or swipe to go on'), el('span', 'only-scroll', 'Scroll to begin ↓')));
    });

    if (R.finished) add('books', (s) => {
      s.append(kicker(`Books finished${so}`), big(R.finished, R.finished === 1 ? 'book' : 'books'));
      const vs = R.prev && R.prev.finished ? R.finished - R.prev.finished : null;
      s.append(line('wr-line', R.rereads ? `${plural(R.rereads, 're-read')} among them. ` : '', vs == null ? '' : vs === 0 ? `Level with ${R.prev.year}.` : `${fmt(Math.abs(vs))} ${vs > 0 ? 'more' : 'fewer'} than ${R.partial ? 'this point in ' : ''}${R.prev.year}.`));
      const shelf = el('div', 'wr-shelf wr-r');
      R.books.slice(0, 40).forEach((b, i) => { const c = rh.cover(b.book_id, b.title, b.genre, 'sm'); c.style.setProperty('--i', i); shelf.append(c); });
      s.append(shelf);
    });

    if (R.minutes) add('time', (s) => {
      const h = R.minutes / 60;
      s.append(kicker(`Time spent reading${so}`), big(Math.round(h), 'hours'));
      s.append(line('wr-line', h >= 24 ? `That’s ${times(h / 24)} whole days, ` : 'Spread ', `over ${plural(R.days_read, 'day')}: ${Math.round(R.days_read / R.year_days * 100)}% of the year${so}.`));
      s.append(line('wr-sub', `About ${mins(R.minutes / R.days_read)} on a reading day.`));
    });

    if (R.words && R.comparison) add('words', (s) => {
      const c = R.comparison;
      s.append(kicker(`Words read${so}`), big(R.words, 'words', short));
      s.append(line('wr-line', '≈ ', el('b', null, `${times(c.times)}×`), ` ${c.one}`));
      const shelf = R.yardsticks.find((u) => u.id === 'shelf_m'), others = R.yardsticks.filter((u) => u.id !== c.id && u.id !== 'shelf_m' && u.times >= 1);
      const more = others.slice(0, 2).map((u) => `${times(u.times)} ${Math.round(u.times * 10) === 10 ? u.one : u.many}`);
      if (shelf) more.push(shelf.times >= 1 ? `${times(shelf.times)} metres of shelf` : `${Math.round(shelf.times * 100)} cm of shelf`);
      s.append(line('wr-sub', 'Or ' + more.join(', or ') + '.'));
    });

    if (R.peak_month || R.book_month) add('months', (s) => {
      s.append(kicker('Month by month'));
      const wrap = el('div', 'wr-mwrap'), chart = el('div', 'wr-mchart wr-r'), steps = el('div', 'wr-steps');
      const byMin = !!R.minutes, val = (m) => (byMin ? m.minutes / 60 : m.finished), mx = Math.max(...R.months.map(val)) || 1;
      R.months.forEach((m) => {
        const col = el('div', 'wr-mcol'), bar = el('i');
        bar.style.height = Math.max(2, val(m) / mx * 100) + '%';
        col.dataset.m = m.month;
        col.append(bar, el('span', null, MONTHS[m.month - 1][0]));
        chart.append(col);
      });
      const step = (m, ...parts) => { const t = el('span'); t.append(...parts); const p = line('wr-step', t); p.dataset.m = m; steps.append(p); };
      if (R.peak_month) step(R.peak_month.month, el('b', null, MONTHS[R.peak_month.month - 1]), ` was your peak: ${plural(hrs(R.peak_month.minutes), 'hour')} of reading.`);
      if (R.book_month && R.book_month.finished > 1) step(R.book_month.month, `You finished the most books in `, el('b', null, MONTHS[R.book_month.month - 1]), `: ${R.book_month.finished}.`);
      if (R.quiet_month) step(R.quiet_month.month, el('b', null, MONTHS[R.quiet_month.month - 1]), R.quiet_month.minutes ? ` was the quietest, at ${plural(hrs(R.quiet_month.minutes), 'hour')}.` : ` was a month off.`);
      wrap.append(chart, steps); s.append(wrap);
      const first = steps.querySelector('.wr-step');
      if (first) chart.querySelector(`[data-m="${first.dataset.m}"]`)?.classList.add('hi');
    });

    if (R.biggest_day) add('binge', (s) => {
      const d = R.biggest_day;
      s.append(kicker('Your biggest day'), el('div', 'wr-big wr-r', mins(d.minutes)));
      const day = el('span', 'lk', fDay(pDate(d.date)));
      day.setAttribute('data-day', d.date);
      const books = el('span', 'wr-links');
      d.books.slice(0, 3).forEach((b, i) => { if (i) books.append(i === d.books.slice(0, 3).length - 1 ? ' and ' : ', '); books.append(bookLink(b)); });
      s.append(line('wr-line wr-links', day, ', reading ', books, '.'));
      if (R.longest_streak && R.longest_streak.days > 1) {
        const st = R.longest_streak;
        s.append(line('wr-sub', `Longest streak: `, el('b', null, plural(st.days, 'day')), ` in a row, ${fDay(pDate(st.start))} to ${fDay(pDate(st.end))}.`));
      }
    });

    if (R.fastest || R.longest) add('reads', (s) => {
      if (R.fastest) {
        const f = R.fastest;
        s.append(kicker('Fastest read'), big(f.wpm, 'words a minute'), line('wr-line wr-links', bookLink(f), f.author ? el('span', 'wr-by', ' by ') : '', f.author ? rh.ref(f, 'author') : ''));
      }
      if (R.longest) {
        const l = R.longest;
        s.append(line(R.fastest ? 'wr-sub wr-links' : 'wr-line wr-links', R.fastest ? 'Longest: ' : '', bookLink(l), `, ${fmt(Math.round(l.hours))} hours` + (l.days_read ? ` over ${plural(l.days_read, 'day')}.` : '.')));
        if (!R.fastest) s.prepend(kicker('Longest read'));
      }
    });

    if (R.new_authors.length) add('authors', (s) => {
      const n = R.new_authors.length;
      s.append(kicker('New to you'), big(n, n === 1 ? 'new author' : 'new authors'));
      const chips = el('div', 'wr-chips wr-links wr-r');
      R.new_authors.slice(0, 8).forEach((a) => chips.append(rh.chip('author', a.author)));
      s.append(chips);
      if (n > 8) s.append(line('wr-sub', `and ${fmt(n - 8)} more.`));
    });

    if (R.genres.length) add('genres', (s) => {
      const g = R.genres[0], total = R.genres.reduce((a, x) => a + x.finished, 0);
      s.append(kicker('Your genres'));
      const head = el('div', 'wr-big wr-r wr-links');
      head.append(rh.chip('genre', g.genre));
      s.append(head, line('wr-line', `${Math.round(g.finished / total * 100)}% of the books you finished.`));
      const bar = el('div', 'wr-gbar wr-r');
      R.genres.forEach((x) => { const i = el('i'); i.style.flex = x.finished; i.style.background = rh.gColor(x.genre); i.title = `${x.genre}: ${x.finished}`; bar.append(i); });
      s.append(bar);
      if (R.top_authors.length && R.top_authors[0].finished > 1) s.append(line('wr-sub wr-links', 'Most read: ', rh.ref(R.top_authors[0], 'author'), `, ${plural(R.top_authors[0].finished, 'book')}.`));
    });

    if (R.records_broken.length) add('records', (s) => {
      const n = R.records_broken.length;
      s.append(kicker('Personal records'), big(n, n === 1 ? 'record broken' : 'records broken'));
      const ul = el('ul', 'wr-recs wr-r');
      R.records_broken.slice(0, 6).forEach((r) => {
        const li = el('li');
        li.append(el('span', null, r.label), el('b', null, rh.recordText ? rh.recordText(r) : fmt(r.value)));
        ul.append(li);
      });
      s.append(ul);
    });

    // slides other features registered with rh.wrappedSlide, after the one they name (or
    // before the closing share slide); one that fails to build is left out
    const ui = { kicker, big, line, bookLink, plural, fmt, short, hrs, MONTHS };
    (rh.wrappedSlides ? rh.wrappedSlides() : []).forEach((x) => {
      try { if (!x.id || !x.build || (x.show && !x.show(R))) return; } catch (e) { console.error('wrapped slide', x.id, e); return; }
      const at = x.after ? out.findIndex((o) => o.id === x.after) : -1;
      const slide = { id: x.id, build: (s) => x.build(s, R, ui) };
      if (at >= 0) out.splice(at + 1 + out.slice(at + 1).filter((o) => o.extra && o.after === x.after).length, 0, { ...slide, extra: true, after: x.after });
      else out.push({ ...slide, extra: true });
    });

    add('share', (s) => {
      s.append(kicker(R.partial ? `${Y}, so far` : `That was ${Y}`));
      const img = el('img', 'wr-card-img wr-r');
      img.alt = `A summary card of ${Y} in reading`;
      const canvas = shareCard(R);
      img.src = canvas.toDataURL('image/png');
      const btns = el('div', 'wr-btns wr-r'), dl = el('button', 'wr-btn', 'Download image');
      dl.addEventListener('click', () => canvas.toBlob((b) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = `reading-${Y}.png`;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }, 'image/png'));
      btns.append(dl);
      if (navigator.canShare) {
        const sh = el('button', 'wr-btn ghost', 'Share…');
        canvas.toBlob((b) => {
          const file = new File([b], `reading-${Y}.png`, { type: 'image/png' });
          if (!navigator.canShare({ files: [file] })) return;
          sh.addEventListener('click', () => navigator.share({ files: [file], title: `${Y} in reading` }).catch(() => {}));
          btns.append(sh);
        });
      }
      const again = el('button', 'wr-btn ghost wr-again', 'Start again');
      btns.append(again);
      s.append(img, btns);
    });
    return out;
  }

  // ---------- the share card ----------
  function shareCard(R) {
    const W = 1080, H = 1350, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), css = getComputedStyle(document.documentElement);
    const col = (v, d) => css.getPropertyValue(v).trim() || d;
    const serif = col('--font-anthropic-serif', 'Georgia, serif'), sans = col('--font-anthropic-sans', 'sans-serif');
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, col('--series-1', '#4e6fd8')); grad.addColorStop(1, col('--series-5', '#8a6bd1'));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,10,20,.42)'; g.fillRect(0, 0, W, H);
    // a few soft circles for texture
    [[900, 180, 260, '--series-2'], [120, 1180, 320, '--series-3']].forEach(([x, y, r, v]) => { g.globalAlpha = 0.18; g.fillStyle = col(v, '#fff'); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
    g.globalAlpha = 1; g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
    const fit = (s, max) => { if (g.measureText(s).width <= max) return s; while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1); return s + '…'; };
    g.font = `600 34px ${sans}`;
    g.fillText((R.partial ? 'MY YEAR IN READING, SO FAR' : 'MY YEAR IN READING'), 80, 130);
    g.font = `400 230px ${serif}`;
    g.fillText(String(R.year), 72, 340);
    const stats = [[fmt(R.finished), R.finished === 1 ? 'book finished' : 'books finished']];
    if (R.minutes) stats.push([fmt(hrs(R.minutes)), 'hours read']);
    if (R.words) stats.push([short(R.words), 'words']);
    if (R.days_read) stats.push([fmt(R.days_read), 'days with a book']);
    if (stats.length < 4 && R.new_authors.length) stats.push([fmt(R.new_authors.length), 'new authors']);
    if (stats.length < 4 && R.rereads) stats.push([fmt(R.rereads), 're-reads']);
    stats.slice(0, 4).forEach(([v, l], i) => {
      const x = 80 + (i % 2) * 470, y = 520 + Math.floor(i / 2) * 210;
      g.font = `400 120px ${serif}`; g.fillText(v, x, y);
      g.font = `400 34px ${sans}`; g.globalAlpha = 0.8; g.fillText(l, x + 4, y + 52); g.globalAlpha = 1;
    });
    const facts = [];
    if (R.genres.length) facts.push(['Top genre', R.genres[0].genre]);
    if (R.top_authors.length) facts.push(['Most read', R.top_authors[0].author]);
    if (R.fastest) facts.push(['Fastest read', `${R.fastest.title} · ${fmt(R.fastest.wpm)} wpm`]);
    if (R.peak_month) facts.push(['Peak month', MONTHS[R.peak_month.month - 1]]);
    if (R.comparison) facts.push(['Words ≈', `${times(R.comparison.times)}× ${R.comparison.one}`]);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(80, 890, W - 160, 2); g.fillStyle = '#fff';
    facts.slice(0, 5).forEach(([k, v], i) => {
      const y = 962 + i * 66;
      g.font = `400 30px ${sans}`; g.globalAlpha = 0.75; g.fillText(k, 80, y); g.globalAlpha = 1;
      g.font = `500 36px ${sans}`; g.fillText(fit(v, W - 160 - 300), 380, y);
    });
    g.font = `400 26px ${sans}`; g.globalAlpha = 0.6; g.fillText('Moon+ Reader dashboard', 80, H - 50); g.globalAlpha = 1;
    return c;
  }

  // ---------- the presenter ----------
  const COLOURS = [1, 5, 3, 4, 2, 7, 8, 6];
  const count = (n) => {
    if (n.dataset.done || reduced()) return;
    n.dataset.done = '1';
    const to = +n.dataset.count, f = n.dataset.f === 'short' ? short : fmt, t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 1100), e = 1 - Math.pow(1 - k, 3);
      n.textContent = f(Math.round(to * e));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const reveal = (slide) => { if (slide.classList.contains('in')) return; slide.classList.add('in'); slide.querySelectorAll('[data-count]').forEach(count); };

  function open(R, mode) {
    const list = slides(R);
    const dlg = el('dialog', 'wr');
    dlg.setAttribute('aria-label', `${R.year} in reading`);
    const bar = el('div', 'wr-top'), segs = el('div', 'wr-segs'), title = el('div', 'wr-title', `${R.year} Wrapped`);
    const toggle = el('button', 'wr-mode'), close = el('button', 'wr-close', '×');
    close.setAttribute('aria-label', 'Close');
    const body = el('div', 'wr-body'), rail = el('nav', 'wr-rail');
    rail.setAttribute('aria-label', 'Slides');
    // build every slide first: an added one that fails is dropped before they're numbered
    const built = list.map((sl) => {
      const inner = el('div', 'wr-in');
      try { sl.build(inner); return { sl, inner }; } catch (e) { if (!sl.extra) throw e; console.error('wrapped slide', sl.id, e); return null; }
    }).filter(Boolean);
    const nodes = built.map(({ sl, inner }, i) => {
      const s = el('section', 'wr-slide wr-' + sl.id);
      s.style.setProperty('--wr-a', `var(--series-${COLOURS[i % 8]})`);
      s.style.setProperty('--wr-b', `var(--series-${COLOURS[(i + 3) % 8]})`);
      inner.querySelectorAll('.wr-r').forEach((n, k) => n.style.setProperty('--d', k));
      s.append(inner);
      segs.append(el('i'));
      const dot = el('button');
      dot.setAttribute('aria-label', `Slide ${i + 1}`);
      dot.addEventListener('click', () => go(i));
      rail.append(dot);
      return s;
    });
    body.append(...nodes);
    bar.append(segs, title, toggle, close);
    dlg.append(bar, body, rail);
    document.body.append(dlg);

    let cur = 0, io = null, stepIo = null;
    function mark(i) {
      cur = i;
      [...segs.children].forEach((x, k) => x.classList.toggle('done', k <= i));
      [...rail.children].forEach((x, k) => x.setAttribute('aria-current', String(k === i)));
    }
    function go(i) {
      i = Math.max(0, Math.min(nodes.length - 1, i));
      if (mode === 'scroll') { nodes[i].scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); return; }
      nodes.forEach((n, k) => { n.classList.toggle('on', k === i); n.classList.toggle('past', k < i); n.setAttribute('aria-hidden', String(k !== i)); });
      reveal(nodes[i]);
      mark(i);
    }
    // stories: one card at a time; scroll: every scene stacked, revealed as it arrives
    function setMode(m) {
      mode = m;
      dlg.classList.toggle('stories', m === 'stories');
      dlg.classList.toggle('scroll', m === 'scroll');
      toggle.textContent = m === 'stories' ? 'Scroll view' : 'Story view';
      if (io) io.disconnect();
      if (stepIo) stepIo.disconnect();
      nodes.forEach((n) => { n.classList.remove('on', 'past'); n.removeAttribute('aria-hidden'); });
      if (m === 'stories') { go(cur); return; }
      io = new IntersectionObserver((es) => es.forEach((e) => {
        if (!e.isIntersecting) return;
        reveal(e.target);
        mark(nodes.indexOf(e.target));
      }), { root: body, threshold: 0.35 });
      nodes.forEach((n) => io.observe(n));
      // the sticky month chart follows the step being read
      stepIo = new IntersectionObserver((es) => es.forEach((e) => {
        if (!e.isIntersecting) return;
        const wrap = e.target.closest('.wr-mwrap'), chart = wrap.querySelector('.wr-mchart');
        wrap.querySelectorAll('.wr-step').forEach((x) => x.classList.toggle('cur', x === e.target));
        chart.querySelectorAll('.hi').forEach((x) => x.classList.remove('hi'));
        chart.querySelector(`[data-m="${e.target.dataset.m}"]`)?.classList.add('hi');
      }), { root: body, rootMargin: '-45% 0px -45% 0px' });
      body.querySelectorAll('.wr-step').forEach((n) => stepIo.observe(n));
      requestAnimationFrame(() => nodes[cur].scrollIntoView());
    }
    toggle.addEventListener('click', () => setMode(mode === 'stories' ? 'scroll' : 'stories'));
    close.addEventListener('click', () => dlg.close());
    dlg.querySelector('.wr-again')?.addEventListener('click', () => go(0));
    // a link inside opens its page behind, so close first
    dlg.addEventListener('click', (e) => { if (e.target.closest('[data-link],[data-day]')) dlg.close(); }, true);
    // stories: tap the left third to go back, elsewhere to go on; swipe; arrow keys
    body.addEventListener('click', (e) => {
      if (mode !== 'stories' || e.target.closest('a,button,[data-link],[data-day],.wr-links')) return;
      const r = body.getBoundingClientRect();
      go(cur + (e.clientX - r.left < r.width / 3 ? -1 : 1));
    });
    let sx = null, sy = null;
    body.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    body.addEventListener('touchend', (e) => {
      if (mode !== 'stories' || sx == null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); go(cur + (dx < 0 ? 1 : -1)); }
      sx = null;
    });
    dlg.addEventListener('keydown', (e) => {
      if (mode !== 'stories') return;
      if (e.key === 'ArrowRight' || (e.key === ' ' && e.target === dlg)) { e.preventDefault(); go(cur + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
    });
    const prevOverflow = document.documentElement.style.overflow;
    dlg.addEventListener('close', () => { if (io) io.disconnect(); if (stepIo) stepIo.disconnect(); document.documentElement.style.overflow = prevOverflow; dlg.remove(); });
    document.documentElement.style.overflow = 'hidden';
    setMode(mode);
    dlg.showModal();
    close.focus();
    return dlg;
  }
  const defaultMode = () => (matchMedia('(max-width: 720px), (pointer: coarse)').matches ? 'stories' : 'scroll');
  rh.wrapped = (year, mode) => {
    const r = dash.data('wrapped'), R = r.status === 'ok' && r.data.find((x) => String(x.year) === String(year));
    return R ? open(R, mode || defaultMode()) : null;
  };

  // ---------- the way in, on the year page ----------
  rh.extend('year', (id, root) => {
    const r = dash.data('wrapped'), R = r.status === 'ok' && r.data.find((x) => String(x.year) === String(id));
    if (!R || (!R.finished && !R.minutes)) return;
    const c = el('div', 'rh-card wide wr-banner'), txt = el('div', 'wr-banner-txt');
    txt.append(el('div', 'wr-banner-k', R.partial ? 'Year in review, so far' : 'Year in review'), el('h2', null, `Your ${R.year} Wrapped`));
    const bits = [plural(R.finished, 'book')];
    if (R.minutes) bits.push(plural(hrs(R.minutes), 'hour'));
    if (R.peak_month) bits.push(`peak in ${MONTHS[R.peak_month.month - 1]}`);
    txt.append(el('p', null, bits.join(' · ') + '. The highlights, one card at a time, with an image to keep.'));
    const play = el('button', 'wr-play', '▶ Play');
    play.addEventListener('click', () => rh.wrapped(R.year));
    c.append(txt, play);
    const head = root.querySelector('.yr-head');
    if (head) head.after(c); else root.prepend(c);
  });
})();
