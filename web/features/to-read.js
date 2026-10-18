// The to-read pile (BOO-76): every book you have but haven't started, from wherever it waits.
// data/to_read.json (written by the build) has the Goodreads/StoryGraph to-read shelves and
// the books in Moon+'s library never opened; books.json adds the ones Moon+ shows as not
// started, prices.json the ones you bought and never opened. How big the pile is, how long
// it has waited, how long it would take at your pace, and whether it grows faster than you
// read. Friends' favourites are suggestions, so they're listed but not counted.
(() => {
  const { el, fmt, plural, pDate, fDay } = rh;
  const DAY = 864e5, t = (s) => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');
  const WORDS_PER_PAGE = 275; // a typical printed page, for books whose length is only known in pages
  const FLOW_MONTHS = 24;
  // a day with believable timing (as rh.okDay)
  const okDay = (d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800;
  const SOURCES = { goodreads: 'Goodreads to-read', storygraph: 'StoryGraph to-read', moonplus: 'In Moon+, not started', bought: 'Bought, never opened' };

  dash.file('to_read', 'data/to_read.json', { optional: true });

  dash.calc('to_read_pile', {
    inputs: ['books', 'to_read', 'prices'],
    title: 'To-read pile',
    description: 'Every book waiting to be read: to-read shelves from Goodreads or StoryGraph, books in Moon+ never opened or not started, and priced books never opened, one row per book (matched by ISBN, then title and author), with when it was added and its estimated length in words.',
    fn: (books, toRead, prices) => {
      const { matcher } = dash.sameBook;
      // a typical length: the median finished book's words per read
      const lengths = books.filter((b) => b.status === 'finished' && b.words > 0 && b.times_read > 0).map((b) => b.words / b.times_read).sort((a, b) => a - b);
      const typical = lengths.length ? Math.round(lengths[Math.floor(lengths.length / 2)]) : null;
      const out = [];
      let find = matcher([]);
      const add = (r) => {
        const same = find(r);
        if (same) {
          same.sources = [...new Set([...same.sources, ...r.sources])];
          if (r.added && (!same.added || r.added < same.added)) same.added = r.added;
          if (same.price == null && r.price != null) same.price = r.price;
          return;
        }
        out.push(r);
        find = matcher(out);
      };
      const row = (o) => {
        const words = o.words > 0 ? o.words : o.pages > 0 ? o.pages * WORDS_PER_PAGE : typical;
        return {
          book_id: o.book_id, title: o.title, author: o.author || '', series: o.series ?? null, series_no: o.series_no ?? null,
          genre: o.genre || 'Untagged', subgenre: o.subgenre || 'Untagged', isbn13: o.isbn13 || null,
          added: o.added || null, sources: o.sources, shelves: o.shelves || [], price: o.price ?? null,
          in_library: !!o.in_library, words: words || null, estimated: !(o.words > 0),
        };
      };
      // Moon+ books opened but not started (no progress yet)
      books.filter((b) => b.status === 'not_started').forEach((b) => add(row({ ...b, book_id: b.id, sources: ['moonplus'], added: b.added || b.first_read, words: 0, in_library: true })));
      (Array.isArray(toRead) ? toRead : []).forEach((r) => add(row({ ...r, words: 0 })));
      // bought but never opened (not in the reading data at all)
      const p = prices && !Array.isArray(prices) && Array.isArray(prices.books) ? prices : null;
      if (p) {
        const have = new Set(books.map((b) => b.id));
        p.books.filter((e) => !have.has(e.book_id)).forEach((e) => add(row({ book_id: e.book_id, title: e.title, author: e.author, added: e.date, sources: ['bought'], price: e.price, words: 0 })));
      }
      return out.sort((a, b) => (a.added || '9999').localeCompare(b.added || '9999') || a.title.localeCompare(b.title));
    },
  });

  // whole months between two YYYY-MM keys, inclusive
  const monthsTo = (from, to) => {
    const out = [];
    for (let [y, m] = from.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? ((m = 1), y++) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
    return out;
  };

  dash.calc('to_read_stats', {
    inputs: ['to_read_pile', 'books', 'reads', 'daily', 'as_of'],
    title: 'To-read pile: size, age and pace',
    description: 'How big the pile is, how long its books have waited, how long reading it all would take at your last-365-day pace (minutes a day and words a minute), and books added versus books finished each month. A book read without going on a pile first counts as added when you started it.',
    fn: (pile, books, reads, daily, asOf) => {
      const end = (asOf[0] && asOf[0].date) || new Date().toISOString().slice(0, 10);
      const ageOf = (d) => (d ? Math.max(0, Math.round((t(end) - t(d)) / DAY)) : null);
      const ages = pile.map((r) => ageOf(r.added)).filter((a) => a != null).sort((a, b) => a - b);
      // pace over the last 365 days
      const year = daily.filter((d) => t(end) - t(d.date) < 365 * DAY);
      const minutes = year.reduce((s, d) => s + (d.minutes || 0), 0);
      const timed = year.filter(okDay), tm = timed.reduce((s, d) => s + d.minutes, 0);
      const wpm = tm >= 30 ? timed.reduce((s, d) => s + d.words, 0) / tm : null;
      const perDay = minutes / 365;
      const words = pile.reduce((s, r) => s + (r.words || 0), 0);
      const hours = wpm ? words / wpm / 60 : null;
      const days = hours != null && perDay > 0 ? Math.ceil((hours * 60) / perDay) : null;
      // the flow: books added to your reading (pile or not) and books finished, by month
      const last = end.slice(0, 7), [ly, lm] = last.split('-').map(Number);
      const firstM = new Date(Date.UTC(ly, lm - FLOW_MONTHS, 1)).toISOString().slice(0, 7);
      const months = monthsTo(firstM, last).map((month) => ({ month, added: 0, finished: 0 }));
      const at = new Map(months.map((m) => [m.month, m]));
      const bump = (d, k) => { const m = d && at.get(String(d).slice(0, 7)); if (m) m[k]++; };
      pile.forEach((r) => bump(r.added, 'added'));
      const inPile = new Set(pile.map((r) => r.book_id));
      books.forEach((b) => { if (!inPile.has(b.id)) bump(b.added || b.first_read, 'added'); });
      reads.forEach((r) => { if (r.finished === true && r.read_no === 1) bump(r.end, 'finished'); });
      const y12 = months.slice(-12);
      const added12 = y12.reduce((s, m) => s + m.added, 0), finished12 = y12.reduce((s, m) => s + m.finished, 0);
      const BUCKETS = [[0, 31, 'Under a month'], [31, 183, '1–6 months'], [183, 366, '6–12 months'], [366, 731, '1–2 years'], [731, Infinity, 'Over 2 years']];
      const buckets = BUCKETS.map(([lo, hi, label]) => ({ label, books: ages.filter((a) => a >= lo && a < hi).length }));
      if (ages.length < pile.length) buckets.push({ label: 'Not known', books: pile.length - ages.length });
      const sources = Object.keys(SOURCES).map((s) => ({ source: s, label: SOURCES[s], books: pile.filter((r) => r.sources.includes(s)).length })).filter((s) => s.books);
      const oldest = pile.find((r) => r.added) || null;
      return [{
        as_of: end, books: pile.length, words, estimated: pile.filter((r) => r.estimated).length,
        median_age_days: ages.length ? ages[Math.floor(ages.length / 2)] : null, dated: ages.length,
        oldest: oldest && { book_id: oldest.book_id, title: oldest.title, author: oldest.author, added: oldest.added, in_library: oldest.in_library, age_days: ageOf(oldest.added) },
        wpm: wpm && Math.round(wpm), mins_per_day: Math.round(perDay * 10) / 10,
        hours: hours != null ? Math.round(hours) : null, days, done_by: days != null ? new Date(t(end) + days * DAY).toISOString().slice(0, 10) : null,
        added_12m: added12, finished_12m: finished12, net_12m: added12 - finished12,
        // at this year's rate of finishing, with nothing new added
        years_to_clear: finished12 ? Math.round((pile.length / finished12) * 10) / 10 : null,
        months, buckets, sources,
      }];
    },
  });

  // ---------- drawing ----------
  rh.tab('toread', 'To read', { after: 'library' });
  // prices only add bought-but-unopened books: without them (money hidden) the pile still stands
  const card = (o) => rh.card({ tab: 'toread', copesWithout: 'prices', ...o });
  const kpi = (lbl, val, sub) => { const n = el('div', 'rh-kpi'); n.append(el('div', 'lbl', lbl), el('div', 'val', val)); if (sub) n.append(el('div', 'sub', sub)); return n; };
  const ago = (days) => (days == null ? 'when unknown' : days < 45 ? plural(days, 'day') : days < 548 ? plural(Math.round(days / 30.4), 'month') : `${fmt(Math.round(days / 36.5) / 10)} years`);
  const kWords = (w) => (w >= 1e6 ? `${fmt(Math.round(w / 1e5) / 10)}M` : `${fmt(Math.round(w / 1000))}k`);
  const empty = (box) => box.replaceChildren(el('div', 'dy-empty', 'Nothing waiting. Import a Goodreads or StoryGraph export with a to-read shelf, add books to Moon+ or price books you bought, and they’ll show here.'));

  card({
    id: 'toread-kpis', title: 'Your to-read pile', calc: 'to_read_stats',
    note: 'Books you have but haven’t started: to-read shelves, books in Moon+ you haven’t opened, and books you bought and never opened. Time to read it all uses your words a minute and minutes a day over the last year, if you read nothing else.',
    draw(box, rows) {
      const s = rows[0];
      if (!s || !s.books) { empty(box); return; }
      const k = el('div', 'rh-kpis');
      k.append(
        kpi('On the pile', plural(s.books, 'book'), `about ${kWords(s.words)} words${s.estimated ? ` (${fmt(s.estimated)} estimated)` : ''}`),
        kpi('Typical wait', s.median_age_days == null ? '—' : ago(s.median_age_days), s.oldest ? `oldest: ${s.oldest.title}, ${ago(s.oldest.age_days)}` : null),
        kpi('To read it all', s.days != null ? plural(s.days, 'day') : s.hours != null ? `${fmt(s.hours)} h` : '—', s.days != null ? `${fmt(s.hours)} h at ${fmt(s.mins_per_day)} min a day → ${fDay(pDate(s.done_by))}` : 'needs timed reading this year'),
        kpi('Last 12 months', `${s.net_12m > 0 ? '+' : s.net_12m < 0 ? '−' : '±'}${fmt(Math.abs(s.net_12m))}`, `${plural(s.added_12m, 'book')} added, ${fmt(s.finished_12m)} finished`),
      );
      const take = el('p', 'tr-take');
      if (s.net_12m > 0) take.append('The pile is ', el('b', null, 'growing'), `: you added ${fmt(s.added_12m)} books in the last year and finished ${fmt(s.finished_12m)}.`);
      else if (s.net_12m < 0) take.append('The pile is ', el('b', null, 'shrinking'), `: you finished ${fmt(s.finished_12m)} books in the last year and added ${fmt(s.added_12m)}.`);
      else take.append(`You’re keeping pace: ${fmt(s.added_12m)} added and ${fmt(s.finished_12m)} finished in the last year.`);
      if (s.years_to_clear != null) take.append(` At a year’s worth of finishing, with nothing new, it would take ${s.years_to_clear < 1 ? 'under a year' : `about ${fmt(s.years_to_clear)} year${s.years_to_clear === 1 ? '' : 's'}`} to clear.`);
      box.replaceChildren(k, take);
    },
  });

  card({
    id: 'toread-flow', title: 'Adding versus finishing', calc: 'to_read_stats',
    note: `Books added each month (to a to-read shelf or to Moon+, or started without being on a pile) against first reads finished, over the last ${FLOW_MONTHS} months.`,
    draw(box, rows) {
      const s = rows[0];
      if (!s || !s.months.some((m) => m.added || m.finished)) { box.replaceChildren(el('div', 'dy-empty', 'No books added or finished in this time.')); return; }
      const lg = el('div', 'legend');
      [[rh.C[1], 'Added'], [rh.C[0], 'Finished']].forEach(([c, n]) => { const sp = el('span'), i = el('i', 'sw'); i.style.background = c; sp.append(i, n); lg.append(sp); });
      box.replaceChildren(lg);
      const chart = el('div', 'tr-chart');
      box.append(chart);
      const h = 220, { svg, w, tip } = rh.svgIn(chart, h), m = { t: 12, r: 4, b: 24, l: 30 };
      const ms = s.months, x = d3.scaleBand(ms.map((r) => r.month), [m.l, w - m.r]).padding(0.2);
      const y = d3.scaleLinear([0, d3.max(ms, (r) => Math.max(r.added, r.finished)) || 1], [h - m.b, m.t]).nice();
      rh.axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(Math.min(4, y.domain()[1]), 'd').tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      const every = Math.ceil(ms.length / Math.max(1, Math.floor((w - m.l) / 52)));
      rh.axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(ms.filter((_, i) => i % every === 0).map((r) => r.month)).tickFormat((v) => d3.utcFormat('%b %y')(pDate(v + '-01'))).tickSize(0).tickPadding(8));
      const bw = Math.min(rh.MARK.bar, (x.bandwidth() - rh.MARK.gap) / 2);
      const g = svg.append('g').selectAll('g').data(ms).join('g').attr('transform', (d) => `translate(${x(d.month) + x.bandwidth() / 2},0)`);
      [['added', -bw - rh.MARK.gap / 2, rh.C[1]], ['finished', rh.MARK.gap / 2, rh.C[0]]].forEach(([k, dx, c]) => {
        g.filter((d) => d[k] > 0).append('path').call(rh.grow, 'd', () => rh.barPath(dx, y(0), bw, 0), (d) => rh.barPath(dx, y(d[k]), bw, y(0) - y(d[k]))).attr('fill', c);
      });
      g.append('rect').attr('class', 'hit').attr('x', -x.step() / 2).attr('width', x.step()).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
        .on('mousemove', (e, d) => rh.showTip(tip, chart, e, (tt) => rh.tipLines(tt, d3.utcFormat('%B %Y')(pDate(d.month + '-01')), [[rh.C[1], 'Added', fmt(d.added)], [rh.C[0], 'Finished', fmt(d.finished)]])))
        .on('mouseleave', () => rh.hideTip(tip));
    },
  });

  card({
    id: 'toread-age', title: 'How long they’ve waited', calc: 'to_read_stats', wide: false,
    note: 'Books on the pile by how long ago they were added.',
    draw(box, rows) {
      const s = rows[0];
      if (!s || !s.books) { box.replaceChildren(el('div', 'dy-empty', 'Nothing waiting.')); return; }
      rh.hbars(box, s.buckets, { label: (r) => r.label, value: (r) => r.books, color: () => rh.C[0], tipFn: (tt, r) => rh.tipLines(tt, r.label, [[null, 'Books', fmt(r.books)]]) });
    },
  });

  card({
    id: 'toread-sources', title: 'Where they’re waiting', calc: 'to_read_stats', wide: false,
    note: 'A book in more than one place counts in each.',
    draw(box, rows) {
      const s = rows[0];
      if (!s || !s.books) { box.replaceChildren(el('div', 'dy-empty', 'Nothing waiting.')); return; }
      rh.hbars(box, s.sources, { label: (r) => r.label, value: (r) => r.books, color: () => rh.C[2], tipFn: (tt, r) => rh.tipLines(tt, r.label, [[null, 'Books', fmt(r.books)]]) });
    },
  });

  let showAll = false;
  const SHOWN = 24;
  card({
    id: 'toread-list', title: 'The pile', calc: 'to_read_pile',
    note: 'Oldest first. Lengths marked ≈ are estimated from the page count or your typical book.',
    draw(box, rows, parts) {
      if (!rows.length) { empty(box); return; }
      const end = (dash.data('as_of').data[0] || {}).date;
      const ul = el('ul', 'rh-list tr-list');
      (showAll ? rows : rows.slice(0, SHOWN)).forEach((r) => {
        const li = el('li'), ttl = el('div', 'ttl');
        if (r.in_library) rh.linkBook(li, r.book_id);
        li.append(rh.cover(r.in_library ? r.book_id : null, r.title, r.genre));
        const where = r.sources.map((s) => (SOURCES[s] || s).replace(/ to-read$/, '').replace(/, not started$/, '').replace(/, never opened$/, '')).join(' · ');
        ttl.append(document.createTextNode(r.title), rh.byline('small', null, r, ['author', 'series'], where));
        const age = r.added && end ? ago(Math.round((t(end) - t(r.added)) / DAY)) : null;
        li.append(ttl, el('div', 'meta', [age, r.words ? `${r.estimated ? '≈ ' : ''}${kWords(r.words)} words` : null].filter(Boolean).join(' · ')));
        ul.append(li);
      });
      box.replaceChildren(ul);
      if (rows.length > SHOWN) {
        const b = el('button', 'up-link tr-more', showAll ? 'Show fewer' : `Show all ${fmt(rows.length)}`);
        b.type = 'button'; b.id = 'toread-more';
        b.addEventListener('click', () => { showAll = !showAll; rh.redraw(); });
        box.append(b);
      }
      parts.note.textContent = `${plural(rows.length, 'book')}, oldest first. Lengths marked ≈ are estimated from the page count or your typical book.`;
    },
  });

  // friends' favourites you haven't got (friends-favourites.js), not counted in the pile
  card({
    id: 'toread-friends', title: 'Suggested by friends', calc: 'to_read_pile',
    note: 'Books friends devoured or re-read that you don’t have yet. They aren’t on your pile, so they don’t count above.',
    draw(box, pile, parts) {
      const fr = rh.friends;
      if (!fr || fr.status() !== 'ok' || !fr.list().length) { parts.card.hidden = true; return; }
      const mine = (k) => dash.data(k).data || [];
      const onPile = dash.sameBook.matcher(pile);
      const seen = new Set(), picks = [];
      fr.list().forEach((f) => dash.calcWith('friend_favourites', {
        books: mine('books'), reads: mine('reads'), friend_books: f.books, friend_fingerprints: fr.calc(f.slug, 'fingerprints'),
      }).forEach((r) => {
        const k = dash.sameBook.keys(r).at(-1);
        if (seen.has(k) || onPile(r)) return;
        seen.add(k); picks.push({ ...r, friend: f.name });
      }));
      parts.card.hidden = !picks.length;
      if (!picks.length) return;
      const ul = el('ul', 'rh-list tr-list');
      picks.sort((a, b) => b.score - a.score).slice(0, 6).forEach((r) => {
        const li = el('li'), ttl = el('div', 'ttl');
        li.append(rh.cover(null, r.title, r.genre));
        ttl.append(document.createTextNode(r.title), rh.byline('small', null, r, ['author'], `${r.friend} ${r.devoured ? 'devoured it' : 're-read it'}`));
        li.append(ttl);
        ul.append(li);
      });
      box.replaceChildren(ul);
    },
  });
})();
