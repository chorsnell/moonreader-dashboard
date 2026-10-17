// Series pull & gateway books: how fast one book of a series led to the next, which book got
// you into an author, and what's next in each series (series_next, for "get next in series").
(() => {
  const { el, gColor, svgIn, showTip, hideTip, tipLines, axis, links, linkBook, ref, byline, cover, pDate, fDay, plural, D } = rh;
  rh.tab('patterns', 'Patterns', { after: 'timeline' });
  const DAY = 864e5, days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const byOrder = (a, b) => (a.series_no ?? 1e9) - (b.series_no ?? 1e9) || (a.first_read || '').localeCompare(b.first_read || '') || a.title.localeCompare(b.title);
  // per book: first start and first finish, from the reads
  function firsts(reads) {
    const m = new Map();
    reads.forEach((r) => {
      const o = m.get(r.book_id) || { start: null, finish: null };
      if (!o.start || r.start < o.start) o.start = r.start;
      if (r.finished === true && (!o.finish || r.end < o.finish)) o.finish = r.end;
      m.set(r.book_id, o);
    });
    return m;
  }
  const seriesOf = (books) => d3.groups(books.filter((b) => b.series), (b) => b.series).map(([s, v]) => [s, v.sort(byOrder)]);

  dash.calc('series_pull', {
    inputs: ['books', 'reads', 'as_of'], title: 'Series pull',
    description: 'For each pair of consecutive books in a series (n and n+1, both in your library): days from first finishing n to first starting n+1, or how long n+1 has been waiting.',
    fn: (books, reads, as_of) => {
      const f = firsts(reads), today = as_of[0].date, out = [];
      seriesOf(books).forEach(([series, v]) => v.slice(1).forEach((b, i) => {
        const a = v[i];
        if (a.series_no != null && b.series_no != null && b.series_no - a.series_no > 1) return; // a gap in the numbering
        const fa = f.get(a.id), fb = f.get(b.id);
        if (!fa || !fa.finish) return;
        const started = fb && fb.start ? fb.start : null;
        out.push({ series, author: a.author, genre: a.genre, from_book: a.id, from_title: a.title, from_no: a.series_no, to_book: b.id, to_title: b.title, to_no: b.series_no,
          finished: fa.finish, started, status: started ? 'read' : 'waiting', overlap: !!started && started < fa.finish,
          gap_days: Math.max(0, started ? days(fa.finish, started) : days(fa.finish, today)) });
      }));
      return out;
    },
  });

  dash.calc('series_next', {
    inputs: ['books', 'reads', 'as_of'], title: 'Next in each series',
    description: 'For every series: the next book to read (the first in series order not yet finished), whether it is in your library, and how far you are through the series.',
    fn: (books, reads, as_of) => {
      const f = firsts(reads), today = as_of[0].date;
      const done = (b) => b.status === 'finished' || !!(f.get(b.id) && f.get(b.id).finish);
      return seriesOf(books).map(([series, v]) => {
        const fin = v.filter(done), lastFin = fin.map((b) => f.get(b.id)?.finish || b.last_read).filter(Boolean).sort().pop() || null;
        let next = null, no = null;
        if (v.every((b) => b.series_no != null)) {
          const max = d3.max(v, (b) => b.series_no);
          for (let n = 1; n <= Math.floor(max) + 1 && !next && no == null; n++) {
            const b = v.find((x) => x.series_no === n);
            if (!b) no = n; else if (!done(b)) next = b;
          }
        } else next = v.find((b) => !done(b)) || null;
        if (next) no = next.series_no;
        const status = next ? (next.status === 'in_progress' ? 'in_progress' : next.progress > 0 ? 'stopped' : 'not_started') : no != null ? 'not_in_library' : 'caught_up';
        return { series, author: v[0].author, genre: v[0].genre, books: v.length, finished: fin.length, next_no: no, book_id: next ? next.id : null, title: next ? next.title : null,
          progress: next ? next.progress ?? null : null, status, in_library: !!next, last_finished: lastFin, days_since: lastFin ? days(lastFin, today) : null };
      }).sort((a, b) => b.finished - a.finished || (a.days_since ?? 1e9) - (b.days_since ?? 1e9));
    },
  });

  dash.calc('gateway_books', {
    inputs: ['books', 'reads'], title: 'Gateway books',
    description: 'For each author with two or more books read: the first one you read, how many of their other books followed, and how soon the next one came.',
    fn: (books, reads) => {
      const meta = new Map(books.map((b) => [b.id, b])), out = [];
      d3.groups(reads.filter((r) => r.days_read !== 1 && r.author), (r) => r.author).forEach(([author, rs]) => {
        const seq = [];
        rs.sort((a, b) => (a.start < b.start ? -1 : 1)).forEach((r) => { if (!seq.some((x) => x.book_id === r.book_id)) seq.push(r); });
        if (seq.length < 2) return;
        const g = seq[0], n = seq[1], b = meta.get(g.book_id) || {};
        out.push({ author, book_id: g.book_id, title: g.title, genre: b.genre || g.genre, series: b.series || null, series_no: b.series_no ?? null, start: g.start,
          finished: g.finished === true, followers: seq.length - 1, next_book: n.book_id, next_title: n.title, next_days: Math.max(0, days(g.end, n.start)) });
      });
      return out.sort((a, b) => b.followers - a.followers || a.next_days - b.next_days);
    },
  });

  const dur = (d) => (d === 0 ? 'same day' : d < 60 ? plural(d, 'day') : d < 730 ? plural(Math.round(d / 30.44), 'month') : `${(d / 365.25).toFixed(1).replace(/\.0$/, '')} years`);
  const no = (n) => (n != null ? '#' + n : '');

  // dots on a shared scale: one row per series, one dot per hop; open dots are still waiting
  function pullChart(box, rows, { perSeries = true } = {}) {
    const groups = d3.groups(rows, (r) => r.series).map(([series, v]) => {
      const read = v.filter((r) => r.status === 'read');
      return { series, v, genre: v[0].genre, med: read.length ? d3.median(read, (r) => r.gap_days) : null };
    }).sort((a, b) => (a.med ?? 1e9) - (b.med ?? 1e9) || a.series.localeCompare(b.series));
    const rh = 28, m = { t: 8, r: 14, b: 30 };
    const w0 = Math.max(280, box.clientWidth), probe = d3.select(box).append('svg').attr('width', 0).attr('height', 0);
    const t = probe.append('text').attr('class', 'axl'), short = (s) => (s.length > 22 ? s.slice(0, 21) + '…' : s);
    const lab = perSeries ? Math.min(w0 * 0.38, d3.max(groups, (g) => { t.text(short(g.series)); return t.node().getComputedTextLength(); }) + 14) : 8;
    probe.remove();
    const h = m.t + groups.length * rh + m.b;
    box.style.minHeight = h + 'px';
    const { svg, w, tip } = svgIn(box, h);
    const max = Math.max(30, d3.max(rows, (r) => r.gap_days));
    const x = d3.scaleSymlog([0, max], [lab, w - m.r]).constant(2);
    const ticks = [0, 1, 7, 30, 90, 365, 730, 1825].filter((v) => v <= max);
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(ticks).tickFormat((v) => (v === 0 ? '0' : v < 30 ? v + 'd' : v < 365 ? Math.round(v / 30) + 'mo' : v / 365 + 'y')).tickSize(-(h - m.t - m.b)));
    svg.select('.domain').remove();
    svg.append('text').attr('class', 'axl').attr('x', w - m.r).attr('y', h - 2).attr('text-anchor', 'end').text('days from finishing one book to starting the next →');
    const g = svg.append('g').selectAll('g').data(groups).join('g').attr('transform', (d, i) => `translate(0,${m.t + i * rh + rh / 2})`);
    if (perSeries) g.append('text').attr('class', 'axl').attr('x', lab - 10).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => short(d.series)).call(links, 'series', (d) => d.series);
    g.filter((d) => d.med != null).append('line').attr('x1', (d) => x(d.med)).attr('x2', (d) => x(d.med)).attr('y1', -9).attr('y2', 9).attr('stroke', 'var(--color-fg)').attr('stroke-width', 2);
    g.selectAll('circle').data((d) => d.v).join('circle').attr('cx', (r) => x(r.gap_days)).attr('r', 6)
      .attr('fill', (r) => (r.status === 'read' ? gColor(r.genre) : 'var(--color-panel)')).attr('fill-opacity', (r) => (r.status === 'read' ? 0.8 : 1))
      .attr('stroke', (r) => (r.status === 'read' ? 'var(--color-panel)' : gColor(r.genre))).attr('stroke-width', (r) => (r.status === 'read' ? 1 : 2))
      .call(links, 'book', (r) => r.to_book)
      .on('mousemove', (e, r) => showTip(tip, box, e, (tp) => tipLines(tp, `${no(r.from_no)} ${r.from_title} → ${no(r.to_no)} ${r.to_title}`.trim(), [
        [gColor(r.genre), r.series, ''], [null, 'Finished', fDay(pDate(r.finished))],
        r.status === 'read' ? [null, 'Next started', `${fDay(pDate(r.started))}${r.overlap ? ' (before finishing)' : ''}`] : [null, 'Next', 'not started yet'],
        [null, r.status === 'read' ? 'Gap' : 'Waiting', dur(r.gap_days)]])))
      .on('mouseleave', () => hideTip(tip));
    return groups;
  }

  rh.card({
    tab: 'patterns', id: 'series-pull', title: 'Series pull', calc: 'series_pull', before: 'card-heat-explorer',
    note: 'How fast each series pulled you on: a dot per book, at the days between finishing it and starting the next. The bar is the median; open dots are next books still waiting. Most gripping first.',
    draw(box, rows, parts) {
      if (!rows.length) { box.style.minHeight = '80px'; box.replaceChildren(el('div', 'dy-empty', 'No series with two books read yet.')); return; }
      box.replaceChildren();
      const groups = pullChart(box, rows), best = groups.find((x) => x.med != null);
      parts.note.textContent = 'How fast each series pulled you on: a dot per book, at the days between finishing it and starting the next. The bar is the median; open dots are next books still waiting. Most gripping first.' +
        (best ? ` ${best.series} hooked you hardest, ${best.med === 0 ? 'starting the next book the same day' : dur(Math.round(best.med)) + ' between books'} on average.` : '');
    },
  });

  rh.card({
    tab: 'patterns', id: 'gateway', title: 'Gateway books', wide: false, calc: 'gateway_books', before: 'card-heat-explorer',
    note: 'The first book you read by an author who went on to get more of your time, and how many of theirs followed.',
    draw(box, rows, parts) {
      pair(parts.card);
      box.style.minHeight = '';
      if (!rows.length) { box.replaceChildren(el('div', 'dy-empty', 'No author with two books read yet.')); return; }
      const ul = el('ul', 'rh-list');
      ul.append(...rows.slice(0, 10).map((r) => {
        const li = linkBook(el('li', 'sp-item'), r.book_id), t = el('div', 'ttl');
        t.append(el('span', null, r.title), byline('small', null, r, ['author']));
        li.append(cover(r.book_id, r.title, r.genre, 'sm'), t, el('span', 'meta', `${plural(r.followers, 'more book')} · next ${dur(r.next_days)} later`));
        return li;
      }));
      box.replaceChildren(ul);
    },
  });

  // the two lists side by side: put their cards in a grid of their own
  function pair(card) {
    let g = document.getElementById('sp-grid');
    if (!g) { g = el('div', 'rh-grid'); g.id = 'sp-grid'; card.before(g); }
    if (card.parentElement !== g) g.append(card);
  }
  const STATUS = { in_progress: 'reading now', stopped: 'started, not finished', not_started: 'in your library', not_in_library: 'not in your library' };
  rh.card({
    tab: 'patterns', id: 'series-next', title: 'Next in your series', wide: false, calc: 'series_next', before: 'card-heat-explorer',
    note: 'Series you have started, and the next book in each: the first in order you haven’t finished, or the next number when you’ve read all you have.',
    draw(box, rows, parts) {
      pair(parts.card);
      const list = rows.filter((r) => r.finished > 0 && r.status !== 'caught_up');
      if (!list.length) { box.replaceChildren(el('div', 'dy-empty', 'No series on the go.')); return; }
      const ul = el('ul', 'rh-list');
      ul.append(...list.slice(0, 10).map((r) => {
        const li = el('li', 'sp-item'), t = el('div', 'ttl');
        if (r.book_id) linkBook(li, r.book_id);
        t.append(el('span', null, r.title ? `${no(r.next_no)} ${r.title}`.trim() : `${no(r.next_no)} (not in your library)`), ref(r, 'series', `${r.series} · ${r.finished} of ${r.books} read`));
        t.lastChild.classList.add('sp-sub');
        li.append(cover(r.book_id, r.title || r.series, r.genre, 'sm'), t, el('span', 'meta', [r.status === 'not_in_library' ? null : STATUS[r.status], r.days_since != null && r.status !== 'in_progress' ? `last finished ${dur(r.days_since)} ago` : null].filter(Boolean).join(' · ')));
        return li;
      }));
      box.replaceChildren(ul);
    },
  });

  // the series page: this series' pull, after its headline figures
  rh.extend('series', (name, root) => {
    const pull = D('series_pull'), nx = D('series_next');
    if (pull.status !== 'ok') return;
    const rows = pull.data.filter((r) => r.series === name), next = nx.status === 'ok' ? nx.data.find((r) => r.series === name) : null;
    if (!rows.length && !(next && next.finished)) return;
    const c = el('div', 'rh-card wide sp-card');
    c.append(el('h2', null, 'Series pull'));
    const read = rows.filter((r) => r.status === 'read'), med = read.length ? d3.median(read, (r) => r.gap_days) : null;
    const bits = [];
    if (med != null) bits.push(`${med === 0 ? 'You usually started the next book the same day you finished one' : `You usually started the next book ${dur(Math.round(med))} after finishing one`}.`);
    if (next && next.status !== 'caught_up') bits.push(`Next up: ${next.title ? `${no(next.next_no)} ${next.title}`.trim() : `${no(next.next_no)}, not in your library`}${next.status === 'not_in_library' ? '' : ` (${STATUS[next.status]})`}.`);
    c.append(el('p', 'note', bits.join(' ') || 'Not enough read in this series yet.'));
    if (rows.length) {
      const box = el('div', 'chart short sp-chart');
      c.append(box);
      const after = root.querySelector('.se-kpis');
      if (after) after.after(c); else root.append(c);
      pullChart(box, rows, { perSeries: false });
    } else {
      const after = root.querySelector('.se-kpis');
      if (after) after.after(c); else root.append(c);
    }
  });
})();
