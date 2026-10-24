// Books by your authors you haven't read, and the gaps in your series (BOO-104), from
// data/bibliography.json (BOO-103: works by your authors and in your series that aren't in
// your library). A card on each author page, the whole series in order on each series page,
// and "More from your authors and series" on the To read tab. The admin gets a want-to-read
// button on each book when rh.wantToRead (BOO-102) is there; everything works without it.
(() => {
  const { el, fmt, plural } = rh;
  const LOOKUP_NOTE = 'The bibliography lookup fills this in after a rebuild. It needs METADATA_LOOKUP and BIBLIOGRAPHY_LOOKUP on.';

  dash.file('bibliography', 'data/bibliography.json', { optional: true });

  const rowsOf = (bib) => (Array.isArray(bib) ? bib : []);
  const round1 = (x) => Math.round(x * 10) / 10;
  // the most common value of a field, ties to the first seen
  const mostOf = (list, f) => {
    const n = new Map();
    list.forEach((x) => { const v = x[f]; if (v) n.set(v, (n.get(v) || 0) + 1); });
    let best = null, top = 0;
    n.forEach((c, v) => { if (c > top) { best = v; top = c; } });
    return best;
  };
  // books you've finished at least once (status, or a finished read)
  const finishedSet = (books, reads) => {
    const s = new Set(books.filter((b) => b.status === 'finished').map((b) => b.id));
    (reads || []).forEach((r) => { if (r.finished === true) s.add(r.book_id); });
    return s;
  };
  const work = (r) => ({
    work_id: r.work_id ?? null, title: r.title, author: r.author, published_year: r.published_year ?? null, editions: r.editions ?? null,
    series: r.series ?? null, series_no: r.series_no ?? null, isbn13: r.isbn13 ?? null, why: r.why || [], on_pile: !!r.on_pile,
  });

  dash.calc('unread_by_author', {
    inputs: ['books', 'reads', 'bibliography'],
    title: 'Unread books by your authors',
    description: 'For each author with books you haven\'t got (from the bibliography lookup): those works, most editions first then oldest, with how many of theirs you have and have finished, your average rating of them (when you rate books) and the hours you\'ve spent on them.',
    fn: (books, reads, bib) => {
      const fin = finishedSet(books, reads), mine = new Set(books.map((b) => b.series).filter(Boolean));
      const by = new Map();
      rowsOf(bib).forEach((r) => { if (r && r.title && r.author) (by.get(r.author) || by.set(r.author, []).get(r.author)).push(r); });
      const out = [];
      by.forEach((rows, author) => {
        const theirs = books.filter((b) => b.author === author), rated = theirs.filter((b) => b.rating > 0);
        const works = rows.map((r) => ({ ...work(r), series_mine: !!r.series && mine.has(r.series) }))
          .sort((a, b) => (b.editions ?? -1) - (a.editions ?? -1) || (a.published_year ?? 9999) - (b.published_year ?? 9999) || a.title.localeCompare(b.title));
        out.push({
          author, genre: mostOf(theirs, 'genre'), books: theirs.length, finished: theirs.filter((b) => fin.has(b.id)).length,
          rated: rated.length, avg_rating: rated.length ? round1(rated.reduce((s, b) => s + b.rating, 0) / rated.length) : null,
          hours: round1(theirs.reduce((s, b) => s + (b.hours || 0), 0)),
          last_read: theirs.map((b) => b.last_read).filter(Boolean).sort().pop() || null,
          works, on_pile: works.filter((w) => w.on_pile).length,
        });
      });
      return out.sort((a, b) => b.finished - a.finished || b.books - a.books || a.author.localeCompare(b.author));
    },
  });

  // series order: numbered entries by number, then the rest by year, then title
  const entryOrder = (a, b) => (a.series_no == null) - (b.series_no == null) || (a.series_no ?? 0) - (b.series_no ?? 0)
    || (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title);
  const UNREAD = new Set(['not_started', 'on_pile', 'unread']);

  dash.calc('series_gaps', {
    inputs: ['books', 'reads', 'bibliography'],
    title: 'Series, with the books you haven\'t read',
    description: 'For each series you\'ve read or are reading a book of: every known entry in order, your books (read, reading or not started) and the ones you haven\'t got from the bibliography lookup (unread or on your to-read pile), and next_up: the first unread entry after the highest-numbered one you\'ve read (or the first unread when the numbers don\'t say).',
    fn: (books, reads, bib) => {
      const fin = finishedSet(books, reads), out = [];
      const others = new Map();
      rowsOf(bib).forEach((r) => { if (r && r.series && r.title) (others.get(r.series) || others.set(r.series, []).get(r.series)).push(r); });
      const groups = new Map();
      books.forEach((b) => { if (b.series) (groups.get(b.series) || groups.set(b.series, []).get(b.series)).push(b); });
      groups.forEach((v, series) => {
        const state = (b) => (b.status === 'in_progress' ? 'reading' : fin.has(b.id) ? 'read' : 'not_started');
        if (!v.some((b) => state(b) !== 'not_started')) return;
        const entries = v.map((b) => ({
          title: b.title, author: b.author, book_id: b.id, series_no: b.series_no ?? null, year: b.published_year ?? null,
          state: state(b), work_id: b.work_id ?? null, isbn13: b.isbn13 ?? null,
        })).concat((others.get(series) || []).map((r) => ({
          title: r.title, author: r.author, book_id: null, series_no: r.series_no ?? null, year: r.published_year ?? null,
          state: r.on_pile ? 'on_pile' : 'unread', work_id: r.work_id ?? null, isbn13: r.isbn13 ?? null,
        }))).sort(entryOrder);
        const done = entries.filter((e) => e.state === 'read' || e.state === 'reading');
        const top = done.reduce((m, e) => (e.series_no != null && (m == null || e.series_no > m) ? e.series_no : m), null);
        const unread = entries.filter((e) => UNREAD.has(e.state));
        // numbered entries sort first, so this is the lowest number past `top`, else the first unnumbered
        const next = (top != null && unread.find((e) => (e.series_no != null ? e.series_no > top : true))) || unread[0] || null;
        entries.forEach((e) => { e.next = e === next; });
        out.push({
          series, author: mostOf(v, 'author'), genre: mostOf(v, 'genre'), books: v.length,
          read: entries.filter((e) => e.state === 'read').length, reading: entries.filter((e) => e.state === 'reading').length,
          unread: unread.length, missing: entries.filter((e) => !e.book_id).length,
          last_read: v.map((b) => b.last_read).filter(Boolean).sort().pop() || null,
          entries, next_up: next ? { ...next } : null,
        });
      });
      return out.sort((a, b) => (b.last_read || '').localeCompare(a.last_read || '') || a.series.localeCompare(b.series));
    },
  });

  dash.calc('discover_picks', {
    inputs: ['series_gaps', 'unread_by_author'],
    title: 'More from your authors and series',
    description: 'Books to read next from what you already like: the next unread book in each series you\'re part-way through (most recently read first), then books you haven\'t got by authors you\'ve finished two or more books of or rated 4 or more on average, one per author in turn.',
    fn: (gaps, authors) => {
      const out = [], seen = new Set(), key = (r) => (r.author + '\u0000' + r.title).toLowerCase();
      const byAuthor = new Map(authors.map((a) => [a.author, a]));
      gaps.forEach((s) => {
        const n = s.next_up;
        if (!n || !(s.read + s.reading)) return;
        seen.add(key(n));
        const a = byAuthor.get(n.author);
        out.push({ kind: 'series', title: n.title, author: n.author, series: s.series, series_no: n.series_no, series_mine: true, published_year: n.year,
          book_id: n.book_id, in_library: !!n.book_id, on_pile: n.state === 'on_pile',
          work_id: n.work_id, isbn13: n.isbn13, genre: s.genre, series_read: s.read, author_finished: a ? a.finished : null, author_rating: a ? a.avg_rating : null });
      });
      const liked = authors.filter((a) => a.finished >= 2 || (a.avg_rating != null && a.avg_rating >= 4))
        .sort((a, b) => b.finished - a.finished || (b.avg_rating ?? 0) - (a.avg_rating ?? 0) || (b.last_read || '').localeCompare(a.last_read || ''));
      const queues = liked.map((a) => ({ a, works: a.works.filter((w) => !seen.has(key(w))) }));
      for (let i = 0; queues.some((q) => q.works.length > i); i++) {
        queues.forEach(({ a, works }) => {
          const w = works[i];
          if (!w) return;
          out.push({ kind: 'author', title: w.title, author: a.author, series: w.series, series_no: w.series_no, series_mine: w.series_mine, published_year: w.published_year,
            book_id: null, in_library: false, on_pile: w.on_pile, work_id: w.work_id, isbn13: w.isbn13, genre: a.genre,
            series_read: null, author_finished: a.finished, author_rating: a.avg_rating });
        });
      }
      return out;
    },
  });

  // ---------- drawing ----------
  const bibEmpty = () => !rowsOf(dash.data('bibliography').data).length;
  const ready = (id) => { const r = dash.data(id); return r.status === 'ok' ? r.data : null; };
  const seriesLabel = (s, n) => s + (n != null ? ' #' + n : '');
  // the want-to-read button (BOO-102), when there is one for this viewer
  function wantButton(row, from) {
    let b = null;
    try {
      b = rh.wantToRead?.button?.({ title: row.title, author: row.author, series: row.series ?? null, series_no: row.series_no ?? null,
        isbn13: row.isbn13 ?? null, work_id: row.work_id ?? null, published_year: row.published_year ?? row.year ?? null, from });
    } catch (e) { console.error('want to read', e); }
    return b && typeof Node !== 'undefined' && b instanceof Node ? b : null;
  }
  const tag = (text, cls) => el('span', 'dc-tag' + (cls ? ' ' + cls : ''), text);
  // a series chip: linked when it's one of yours
  const seriesChip = (series, no, mine) => (mine ? rh.chip('series', series, seriesLabel(series, no)) : el('span', 'chip', seriesLabel(series, no)));
  // one book you haven't got, as a list row
  function workItem(w, o) {
    const li = el('li', 'dc-item'), ttl = el('div', 'ttl'), sm = el('small', 'dc-sub');
    if (w.book_id) rh.linkBook(li, w.book_id);
    li.append(rh.cover(w.book_id || null, w.title, o.genre, 'sm'));
    const bits = [];
    if (o.author) bits.push(rh.ref(w, 'author'));
    if (w.published_year) bits.push(String(w.published_year));
    if (w.series && o.series !== false) bits.push(seriesChip(w.series, w.series_no, w.series_mine));
    if (o.extra) bits.push(o.extra);
    bits.forEach((b, i) => { if (i) sm.append(' · '); sm.append(b); });
    ttl.append(el('span', 'dc-title', w.title), sm);
    if (w.editions) ttl.title = `${plural(w.editions, 'edition')} on Open Library`;
    const side = el('div', 'dc-side');
    (o.tags || []).forEach((t) => side.append(t));
    if (w.on_pile && !w.in_library) side.append(tag('On your pile', 'pile'));
    // a book on the pile already says so; the button would only say "On your list"
    const btn = !w.book_id && !w.on_pile && wantButton(w, o.from);
    if (btn) side.append(btn);
    li.append(ttl);
    if (side.childNodes.length) li.append(side);
    return li;
  }
  // place a card on an entity page: before the book manager's card when it's there
  function put(root, card, after) {
    const ref = after && root.querySelector(after);
    if (ref) { ref.after(card); return; }
    const arr = root.querySelector(':scope > .arr-card');
    if (arr) arr.before(card); else root.append(card);
  }
  const card = (title, note, cls) => {
    const c = el('div', 'rh-card wide dc-card' + (cls ? ' ' + cls : ''));
    c.append(el('h2', null, title));
    if (note) c.append(el('p', 'note', note));
    return c;
  };

  // ---------- author pages ----------
  rh.extend('author', (name, root) => {
    const rows = ready('unread_by_author');
    const a = rows && rows.find((r) => r.author === name);
    if (!a || !a.works.length) return;
    const ctx = [];
    if (a.finished) ctx.push(`you’ve finished ${plural(a.finished, 'book')} of theirs`);
    if (a.avg_rating != null) ctx.push(`rated them ${fmt(a.avg_rating)} out of 5 on average`);
    if (a.hours >= 1) ctx.push(`spent ${fmt(Math.round(a.hours))} hours on them`);
    const note = `${plural(a.works.length, 'book')} by ${name} not in your library, most-published first.` + (ctx.length ? ` So far ${ctx.join(', ')}.` : '');
    const c = card('Books you haven’t read', note, 'dc-author');
    const ul = el('ul', 'rh-list dc-list');
    a.works.forEach((w) => ul.append(workItem(w, { genre: a.genre, from: 'author' })));
    c.append(ul);
    put(root, c);
  });

  // ---------- series pages ----------
  const STATE = { read: 'Read', reading: 'Reading', not_started: 'Not started', on_pile: 'On your pile', unread: 'Unread' };
  rh.extend('series', (name, root) => {
    const rows = ready('series_gaps');
    const s = rows && rows.find((r) => r.series === name);
    if (!s || !s.missing) return;
    const got = s.entries.length - s.missing;
    const c = card('The whole series', `${plural(s.entries.length, 'book')} known, ${fmt(got)} in your library.` +
      (s.next_up ? ` Next up is ${s.next_up.series_no != null ? '#' + s.next_up.series_no + ', ' : ''}${s.next_up.title}.` : ''), 'dc-series');
    const strip = el('ol', 'dc-strip');
    strip.setAttribute('aria-label', `${name}, in series order`);
    s.entries.forEach((e) => {
      const li = el('li', 'dc-step ' + e.state + (e.next ? ' next' : ''));
      if (e.book_id) rh.linkBook(li, e.book_id);
      li.title = `${e.series_no != null ? '#' + e.series_no + ' ' : ''}${e.title}: ${STATE[e.state]}${e.next ? ' (next up)' : ''}`;
      li.append(el('span', 'dc-no', e.series_no != null ? '#' + e.series_no : '·'), el('span', 'dc-mark'), el('span', 'dc-state', STATE[e.state]));
      if (e.next) li.append(el('span', 'dc-next', 'Next up'));
      strip.append(li);
    });
    c.append(strip);
    const unread = s.entries.filter((e) => !e.book_id);
    if (unread.length) {
      const ul = el('ul', 'rh-list dc-list');
      unread.forEach((e) => ul.append(workItem({ ...e, series: name, published_year: e.year, on_pile: e.state === 'on_pile' },
        { genre: s.genre, from: 'series', series: false, author: e.author !== s.author, extra: e.series_no != null ? '#' + e.series_no : null, tags: e.next ? [tag('Next up', 'next')] : [] })));
      c.append(el('h3', 'dc-h3', 'Not in your library'), ul);
    }
    put(root, c, ':scope > .se-kpis');
  });

  // ---------- To read tab ----------
  let showAll = false;
  const SHOWN = 12;
  rh.card({
    tab: 'toread', id: 'discover', title: 'More from your authors and series', calc: 'discover_picks', after: 'card-what-next',
    note: 'The next book in each series you’re part-way through, then books by authors you’ve finished two or more of, or rate 4 or more.',
    draw(box, rows, parts) {
      // discover.js loads before to-read.js and what-next.js, so their cards are placed after
      // this one draws: once the tab is drawn, sit after the want-to-read list (else what next)
      setTimeout(() => {
        const anchor = document.getElementById('card-toread-want') || document.getElementById('card-what-next');
        if (anchor && anchor.parentNode === parts.card.parentNode && anchor.nextElementSibling !== parts.card) anchor.after(parts.card);
      }, 0);
      if (!rows.length) {
        box.replaceChildren(el('div', 'dy-empty', bibEmpty() ? LOOKUP_NOTE : 'Nothing to suggest yet: finish a couple of books by one author, or start a series.'));
        return;
      }
      const ul = el('ul', 'rh-list dc-list');
      (showAll ? rows : rows.slice(0, SHOWN)).forEach((r) => {
        const why = r.kind === 'series'
          ? `next after ${fmt(r.series_read)} read`
          : r.author_finished >= 2 ? `you’ve finished ${fmt(r.author_finished)} of theirs` : `you rate them ${fmt(r.author_rating)} on average`;
        const tags = [];
        if (r.in_library) tags.push(tag('In your library'));
        ul.append(workItem(r, { genre: r.genre, from: r.kind, author: true, extra: why, tags }));
      });
      box.replaceChildren(ul);
      if (rows.length > SHOWN) {
        const b = el('button', 'up-link dc-more', showAll ? 'Show fewer' : `Show all ${fmt(rows.length)}`);
        b.type = 'button'; b.id = 'discover-more';
        b.addEventListener('click', () => { showAll = !showAll; rh.redraw(); });
        box.append(b);
      }
      if (bibEmpty()) box.append(el('p', 'note dc-foot', LOOKUP_NOTE));
    },
  });
})();
