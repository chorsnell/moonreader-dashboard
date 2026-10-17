// genre and subgenre pages: #genre/<name>, #subgenre/<name>
(() => {
  const { D, el, fmt, pDate, fDay, fShort, gColor, hbars, vbars, cover, linkBook, linkPage, mins, pct, date, plural, avgWpm, vsAvg, STATUS } = rh;
  const BOOKS_CAP = 25;
  const expanded = {}; // 'genre/<name>' → true once "Show all" is clicked
  const ok = (id) => { const r = D(id); return r.status === 'ok' ? r.data : null; };
  const subOf = (b) => b.subgenre || 'Untagged';
  const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];

  function card(title, note, wide) {
    const c = el('div', 'rh-card' + (wide ? ' wide' : ''));
    c.append(el('h2', null, title));
    if (note) c.append(el('p', 'note', note));
    return c;
  }
  function kpi(lbl, val, sub, book) {
    const k = el('div', 'rh-kpi'); k.append(el('div', 'lbl', lbl), el('div', 'val' + (val.length > 12 ? ' val-sm' : ''), val));
    if (sub) k.append(el('div', 'sub', sub));
    if (book) linkBook(k, book);
    return k;
  }

  function draw(kind, id, root) {
    const books = ok('books');
    if (!books) { root.replaceChildren(el('div', 'dy-empty', 'Loading…')); return; }
    rh.setTitle(id);
    const inG = kind === 'genre' ? (b) => b.genre === id : (b) => subOf(b) === id;
    const mine = books.filter(inG);
    if (!mine.length) {
      const c = el('div', 'rh-card wide');
      c.append(el('div', 'dy-empty', `Nothing tagged “${id}” in your library.`));
      root.replaceChildren(c); return;
    }
    const ids = new Set(mine.map((b) => b.id));
    const parent = kind === 'genre' ? id : top(d3.rollup(mine, (v) => v.length, (b) => b.genre));
    const color = gColor(parent);
    const reads = (ok('reads') || []).filter((r) => ids.has(r.book_id));
    const finished = mine.filter((b) => b.status === 'finished');
    const going = mine.filter((b) => b.status === 'in_progress');
    const hours = d3.sum(mine, (b) => b.hours || 0), allHours = d3.sum(books, (b) => b.hours || 0);
    const words = d3.sum(mine, (b) => b.words || 0);
    const byHours = mine.slice().sort((a, b) => (b.hours || 0) - (a.hours || 0) || (b.times_read || 0) - (a.times_read || 0));
    const byRecent = mine.slice().sort((a, b) => ((a.last_read || '') < (b.last_read || '') ? 1 : (a.last_read || '') > (b.last_read || '') ? -1 : a.title.localeCompare(b.title)));
    const authors = d3.rollups(mine.filter((b) => b.author), (v) => ({ books: v.length, finished: v.filter((b) => b.status === 'finished').length, hours: d3.sum(v, (b) => b.hours || 0) }), (b) => b.author)
      .map(([author, a]) => ({ author, ...a })).sort((a, b) => b.books - a.books || b.hours - a.hours);

    // header: name, parent genre, summary, covers of the most-read books
    const head = el('div', 'rh-card wide ge-head'), info = el('div', 'go-info');
    head.style.setProperty('--ge', color);
    const title = el('div', 'bk-title ge-title', id);
    info.append(title);
    const chips = el('div', 'bk-chips');
    chips.append(el('span', 'chip', kind === 'genre' ? 'Genre' : 'Subgenre'));
    if (kind === 'subgenre' && parent) { const c = linkPage(el('span', 'chip', parent), 'genre', parent); c.style.color = color; chips.append(c); }
    info.append(chips);
    const firsts = mine.map((b) => b.first_read).filter(Boolean).sort();
    const sum = [`${plural(mine.length, 'book')} by ${plural(authors.length, 'author')}`, `${fmt(finished.length)} finished`];
    if (going.length) sum.push(`${fmt(going.length)} on the go`);
    if (hours) sum.push(`${fmt(Math.round(hours))} hours` + (allHours ? ` (${pct(hours / allHours * 100)} of all your reading)` : ''));
    if (firsts.length) sum.push(`since ${fShort(pDate(firsts[0]))}`);
    info.append(el('div', 'go-sub', sum.join(' · ') + '.'));
    const covers = el('div', 'ge-covers');
    byHours.slice(0, 12).forEach((b) => { const c = linkBook(cover(b.id, b.title, b.genre, ''), b.id); c.title = b.title; covers.append(c); });
    info.append(covers);
    head.append(info);

    // headline figures
    const k = [];
    k.push(kpi('Books', fmt(mine.length), [`${fmt(finished.length)} finished`, going.length ? `${fmt(going.length)} on the go` : null].filter(Boolean).join(' · ')));
    if (hours) k.push(kpi('Hours read', fmt(Math.round(hours)), allHours ? `${pct(hours / allHours * 100)} of all your reading time` : null));
    const gs = (ok('group_speed') || []).find((r) => r.kind === kind && r.name === id), avg = avgWpm();
    if (gs) {
      const v = avg ? vsAvg(gs.wpm / avg - 1) : '';
      k.push(kpi('Speed', `${fmt(gs.wpm)} wpm`, [v === 'your average' ? 'same as your average' : v ? v + ' than your average' : null, `${fmt(gs.hours)} h timed`].filter(Boolean).join(' · ')));
    }
    if (words) k.push(kpi('Words read', fmt(words), finished.length ? `about ${fmt(Math.round(d3.sum(finished, (b) => b.words || 0) / finished.length / 1000))}k per finished book` : null));
    if (authors.length) k.push(kpi('Authors', fmt(authors.length), authors.length === 1 ? authors[0].author : authors[0].books > 1 ? `most read: ${authors[0].author}` : null));
    const first = mine.filter((b) => b.first_read).sort((a, b) => (a.first_read < b.first_read ? -1 : 1))[0];
    if (first) k.push(kpi('First read', fDay(pDate(first.first_read)), first.title, first.id));
    const last = byRecent.find((b) => b.last_read);
    if (last && last !== first) k.push(kpi('Latest', fDay(pDate(last.last_read)), last.title, last.id));
    const kpis = el('div', 'rh-kpis'); kpis.append(...k);

    root.replaceChildren(head, kpis);

    // finished per year
    const fin = reads.filter((r) => r.finished === true && r.end);
    if (fin.length) {
      const per = d3.rollup(fin, (v) => v.length, (r) => +r.end.slice(0, 4));
      const allFin = d3.rollup((ok('reads') || []).filter((r) => r.finished === true && r.end), (v) => v.length, (r) => +r.end.slice(0, 4));
      const [y0, y1] = d3.extent([...per.keys()]);
      const rows = d3.range(y0, y1 + 1).map((year) => ({ year, n: per.get(year) || 0, all: allFin.get(year) || 0 }));
      const best = rows.reduce((a, r) => (r.n > a.n ? r : a));
      const c = card('Finished each year', `Books in ${id} you finished each year, re-reads included. ` + (rows.length > 1 ? `Your biggest year was ${best.year}, with ${plural(best.n, 'book')}` : `${plural(best.n, 'book')} in ${best.year}`) +
        (best.all ? ` (${pct(best.n / best.all * 100)} of everything you finished that year)` : '') + '. Click a year to open it.', true);
      const ch = el('div', 'chart short');
      c.append(ch); root.append(c);
      vbars(ch, rows, (r) => r.year, (r) => r.n, color, 'Finished', (r) => ['year', r.year]);
      // vbars labels every year and every bar: thin the years to fit, drop the zeros
      const every = Math.ceil(rows.length / Math.max(1, Math.floor(ch.clientWidth / 44)));
      d3.select(ch).selectAll('.tick text').filter((d) => d >= 1000 && (y1 - d) % every !== 0).remove();
      d3.select(ch).selectAll('text.lbl-in').filter((d) => !d.n).remove();
    }

    const grid = el('div', 'rh-grid'); root.append(grid);
    // draw once every card is in the grid, so each chart is measured at its final width
    const later = [], addBars = (c, rows, opts) => { const ch = el('div', 'chart'); c.append(ch); grid.append(c); later.push(() => hbars(ch, rows, opts)); };

    // subgenres of this genre, or the other subgenres beside this one
    const sibs = d3.rollups(books.filter((b) => b.genre === parent), (v) => ({ books: v.length, finished: v.filter((b) => b.status === 'finished').length, hours: d3.sum(v, (b) => b.hours || 0) }), subOf)
      .map(([name, a]) => ({ name, ...a })).sort((a, b) => b.books - a.books || b.hours - a.hours);
    if (kind === 'genre' ? sibs.length > 1 || (sibs.length && sibs[0].name !== 'Untagged') : sibs.length > 1) {
      const c = card(kind === 'genre' ? 'Subgenres' : `Other ${parent} subgenres`, kind === 'genre' ? 'Books in your library in each subgenre. Click one to open it.' : `Books in each ${parent} subgenre, with ${id} highlighted.`);
      addBars(c, sibs.slice(0, 15), {
        label: (r) => r.name, value: (r) => r.books, color: (r) => (kind === 'genre' || r.name === id ? color : 'var(--cds-chart-muted)'),
        tipFn: (t, r) => rh.tipLines(t, r.name, [[null, 'Books', r.books], [null, 'Finished', r.finished], [null, 'Hours', fmt(Math.round(r.hours))]]),
        link: (r) => (kind === 'subgenre' && r.name === id ? [null, null] : ['subgenre', r.name]),
      });
    }

    // authors
    if (authors.length > 1) {
      const c = card('Authors', authors.length > 10 ? `The 10 authors you've read most in ${id}, by books in your library.` : `Authors you've read in ${id}, by books in your library.`);
      addBars(c, authors.slice(0, 10), {
        label: (r) => r.author, value: (r) => r.books, color: () => color,
        tipFn: (t, r) => rh.tipLines(t, r.author, [[null, 'Books', r.books], [null, 'Finished', r.finished], [null, 'Hours', fmt(Math.round(r.hours))]]),
        link: (r) => ['author', r.author],
      });
    }

    // series
    const series = d3.rollups(mine.filter((b) => b.series), (v) => ({ books: v.length, finished: v.filter((b) => b.status === 'finished').length, author: top(d3.rollup(v, (x) => x.length, (b) => b.author)), last: d3.max(v, (b) => b.last_read) }), (b) => b.series)
      .map(([name, s]) => ({ name, ...s })).sort((a, b) => b.books - a.books || ((a.last || '') < (b.last || '') ? 1 : -1));
    if (series.length) {
      const c = card('Series', `${plural(series.length, 'series')} with books in ${id}.`), ul = el('ul', 'rh-list');
      ul.append(...series.slice(0, 12).map((s) => {
        const li = linkPage(el('li'), 'series', s.name), a = el('div', 'ttl');
        a.append(document.createTextNode(s.name)); if (s.author) a.append(el('small', null, s.author));
        li.append(a, el('div', 'meta', `${fmt(s.finished)} of ${plural(s.books, 'book')} finished`));
        return li;
      }));
      if (series.length > 12) ul.append(el('li', 'meta', `and ${plural(series.length - 12, 'more series')}`));
      c.append(ul); grid.append(c);
    }

    // fastest and slowest
    const bs = (ok('book_speed') || []).filter((r) => ids.has(r.book_id));
    if (bs.length > 1) {
      const c = card('Fastest and slowest', `Words a minute for books in ${id} with two hours or more of timed reading, fastest first.`), ul = el('ul', 'rh-list');
      const row = (r) => {
        const b = mine.find((x) => x.id === r.book_id) || {}, li = linkBook(el('li'), r.book_id), a = el('div', 'ttl');
        li.append(cover(r.book_id, r.title, b.genre || parent, 'sm'));
        a.append(document.createTextNode(r.title || r.book_id), el('small', null, r.author || ''));
        const m = el('div', 'meta'); m.append(el('b', null, `${fmt(r.wpm)} wpm`), document.createElement('br'), el('span', 'spd ' + (r.vs_avg > 0.005 ? 'up' : r.vs_avg < -0.005 ? 'down' : ''), vsAvg(r.vs_avg)));
        li.append(a, m); return li;
      };
      if (bs.length <= 8) ul.append(...bs.map(row));
      else ul.append(...bs.slice(0, 4).map(row), el('li', 'meta ge-gap', `${plural(bs.length - 8, 'more book')} in between`), ...bs.slice(-4).map(row));
      c.append(ul); grid.append(c);
    }
    later.forEach((f) => f());

    // every book, most recent first
    const key = kind + '/' + id, all = !!expanded[key], shown = all ? byRecent : byRecent.slice(0, BOOKS_CAP);
    const c = card('Books', `Every book in ${id} in your library, most recently opened first.`, true);
    const box = el('div', 'tbl-box'), tbl = el('table', 'bk-tbl ge-tbl'), thead = el('thead'), htr = el('tr'), tb = el('tbody');
    [['Title', ''], ['Last opened', 'hide-sm'], ['Hours', 'n hide-sm'], ['Reached', 'n']].forEach(([t, cls]) => htr.append(el('th', cls || null, t)));
    thead.append(htr); tbl.append(thead, tb); box.append(tbl); c.append(box);
    tb.append(...shown.map((b) => {
      const tr = linkBook(el('tr'), b.id), t = el('td', 'ge-t'), w = el('div', 'tt'), a = el('div');
      a.append(el('div', null, b.title), el('small', null, [b.author, kind === 'genre' && b.subgenre ? b.subgenre : null, b.series ? b.series + (b.series_no != null ? ' #' + b.series_no : '') : null].filter(Boolean).join(' · ')));
      w.append(cover(b.id, b.title, b.genre, 'sm'), a); t.append(w);
      const r = el('td', 'n'); r.append(el('div', null, pct(b.progress)), el('small', null, STATUS[b.status] || b.status || ''));
      if (b.progress != null) { const pb = el('div', 'pbar'), i = el('i'); i.style.width = Math.min(100, b.progress) + '%'; i.style.background = color; pb.append(i); r.append(pb); }
      tr.append(t, el('td', 'hide-sm', date(b.last_read)), el('td', 'n hide-sm', b.hours ? fmt(b.hours) : '—'), r);
      return tr;
    }));
    if (byRecent.length > BOOKS_CAP) {
      const more = el('button', 'dy-more', all ? 'Show fewer' : `Show all ${fmt(byRecent.length)}`);
      more.addEventListener('click', () => { expanded[key] = !all; draw(kind, id, root); });
      c.append(more);
    }
    root.append(c);
  }

  rh.register('genre', { draw: (id, root) => draw('genre', id, root) });
  rh.register('subgenre', { draw: (id, root) => draw('subgenre', id, root) });
})();
