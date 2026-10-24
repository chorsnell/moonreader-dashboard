// The Highlights tab (BOO-81): every highlight and note across all books in one place, with
// full-text search, filters (book, author, genre, year, kind), the most-highlighted books and
// the passages you highlighted more than once. highlights.json is filtered on the server for
// visitors (served empty when highlights are hidden; private books' highlights left out), so
// the search runs here over what this viewer was sent.
(() => {
  const { el, fmt, plural, ref, byline, cover, pDate, fDay, C } = rh;
  const FIRST_PAGE = 20, PAGE = 40;

  // ---------- calcs ----------
  const yearOf = (h) => (h.date ? +h.date.slice(0, 4) : null);
  // the same passage however it was typed or exported: case, accents, quotes and spacing aside
  const sameText = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}']+/gu, ' ').trim();

  dash.calc('highlight_rows', {
    inputs: ['highlights', 'books'], title: 'Every highlight and note',
    description: 'Highlights and notes (not bookmarks) in books still in the library, with each book\'s title, author, series and genre and the year it was made; in book order: title, then how far in.',
    fn: (highlights, books) => {
      const byId = new Map(books.map((b) => [b.id, b]));
      return highlights.filter((h) => h.kind !== 'bookmark' && byId.has(h.book_id) && (h.text || h.note)).map((h) => {
        const b = byId.get(h.book_id);
        return { id: h.id, book_id: h.book_id, title: b.title, author: b.author, series: b.series, series_no: b.series_no, genre: b.genre,
          year: yearOf(h), date: h.date, time: h.time, progress: h.progress, chapter: h.chapter, text: h.text || '', note: h.note, colour: h.colour, kind: h.kind };
      }).sort((a, b) => a.title.localeCompare(b.title) || a.book_id.localeCompare(b.book_id) ||
        (a.progress ?? 1e9) - (b.progress ?? 1e9) || (a.time || '').localeCompare(b.time || '') || a.id - b.id);
    },
  });

  dash.calc('highlight_books', {
    inputs: ['highlight_rows'], title: 'Most-highlighted books',
    description: 'Books by how many highlights and notes you made in them, most first, with the first and last day you made one.',
    fn: (rows) => {
      const by = new Map();
      for (const h of rows) {
        let b = by.get(h.book_id);
        if (!b) by.set(h.book_id, (b = { book_id: h.book_id, title: h.title, author: h.author, genre: h.genre, count: 0, notes: 0, first: null, last: null }));
        b.count++;
        if (h.note) b.notes++;
        if (h.date && (!b.first || h.date < b.first)) b.first = h.date;
        if (h.date && (!b.last || h.date > b.last)) b.last = h.date;
      }
      return [...by.values()].sort((a, b) => b.count - a.count || b.notes - a.notes || a.title.localeCompare(b.title));
    },
  });

  dash.calc('highlight_years', {
    inputs: ['highlight_rows'], title: 'Highlights per year',
    description: 'Highlights and notes made each year (those without a date are left out), and in how many books.',
    fn: (rows) => {
      const by = new Map();
      for (const h of rows) {
        if (h.year == null) continue;
        const y = by.get(h.year) || { year: h.year, count: 0, books: new Set() };
        y.count++; y.books.add(h.book_id); by.set(h.year, y);
      }
      return [...by.values()].sort((a, b) => a.year - b.year).map((y) => ({ year: y.year, count: y.count, books: y.books.size }));
    },
  });

  dash.calc('highlight_repeats', {
    inputs: ['highlight_rows'], title: 'Passages highlighted more than once',
    description: 'The same passage (ignoring case, accents and punctuation) highlighted more than once in a book: on a re-read, or from two apps (Moon+ and a Kindle, say). Most times first.',
    fn: (rows) => {
      const by = new Map();
      for (const h of rows) {
        const k = h.book_id + '\u0001' + sameText(h.text);
        if (!h.text || sameText(h.text).length < 3) continue;
        const g = by.get(k) || { book_id: h.book_id, title: h.title, author: h.author, series: h.series, series_no: h.series_no, genre: h.genre, text: h.text, ids: [], dates: [], notes: [] };
        g.ids.push(h.id);
        if (h.date) g.dates.push(h.date);
        if (h.note && !g.notes.includes(h.note)) g.notes.push(h.note);
        if (h.text.length > g.text.length) g.text = h.text; // the fullest copy
        by.set(k, g);
      }
      return [...by.values()].filter((g) => g.ids.length > 1).map((g) => ({ ...g, times: g.ids.length, dates: g.dates.sort() }))
        .sort((a, b) => b.times - a.times || (a.dates[0] || '').localeCompare(b.dates[0] || '') || a.title.localeCompare(b.title));
    },
  });

  // ---------- search ----------
  // a query: words and "quoted phrases", each of which must appear in the text, the note, the
  // title or the author; case, accents and curly quotes don't matter
  const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"');
  function parse(q) {
    const terms = [];
    String(q || '').replace(/"([^"]*)"|(\S+)/g, (_, phrase, word) => { const t = fold((phrase ?? word).trim()); if (t) terms.push(t); return ''; });
    return terms;
  }
  // folded text with, for each of its characters, where it came from in the original
  function folded(s) {
    let out = '';
    const at = [];
    let i = 0;
    for (const ch of s) {
      const f = fold(ch);
      out += f;
      for (let k = 0; k < f.length; k++) at.push(i);
      i += ch.length;
    }
    at.push(s.length);
    return { out, at };
  }
  const haystack = (h) => fold([h.text, h.note, h.title, h.author].filter(Boolean).join('\n'));
  const matches = (h, terms) => { if (!terms.length) return true; const s = haystack(h); return terms.every((t) => s.includes(t)); };
  // [start, end) ranges of s (in the original string) that match a term, merged
  function ranges(s, terms) {
    if (!s || !terms.length) return [];
    const { out, at } = folded(s), rs = [];
    for (const t of terms) for (let i = out.indexOf(t); i >= 0; i = out.indexOf(t, i + t.length)) rs.push([at[i], at[i + t.length]]);
    rs.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of rs) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
    return merged;
  }
  // text as nodes, with the matching parts in <mark>
  function marked(tag, cls, s, terms) {
    const n = el(tag, cls);
    let pos = 0;
    for (const [a, b] of ranges(s, terms)) {
      if (a > pos) n.append(s.slice(pos, a));
      n.append(el('mark', null, s.slice(a, b)));
      pos = b;
    }
    if (pos < s.length) n.append(s.slice(pos));
    return n;
  }
  // for the daily review (BOO-83) and tests
  rh.highlightSearch = { parse, matches, ranges, sameText };

  // ---------- the tab ----------
  rh.tab('highlights', 'Highlights', { after: 'library' });
  const rowsNow = () => { const d = dash.data('highlight_rows'); return d.status === 'ok' ? d.data : null; };
  // no highlights for this viewer (none made yet, or hidden by the owner): no tab
  dash.onData(() => {
    const rows = rowsNow(), b = document.getElementById('tab-highlights');
    if (!b || rows === null) return;
    b.hidden = !rows.length;
    if (!rows.length && rh.current() === 'highlights') rh.show('overview');
  });

  const ui = { q: '', book: '', author: '', genre: '', year: '', kind: '', sort: 'book', limit: FIRST_PAGE };
  let fmtWhen = null;
  const fWhen = (d) => (fmtWhen = fmtWhen || d3.timeFormat('%-d %b %Y'))(d);
  const KIND = { highlight: 'Highlight', note: 'Note' };
  const SORTS = {
    book: null, // highlight_rows' own order
    newest: (a, b) => (b.time || b.date || '').localeCompare(a.time || a.date || ''),
    oldest: (a, b) => (a.time || a.date || '￿').localeCompare(b.time || b.date || '￿'),
  };

  function item(h, terms) {
    const li = el('li', 'hx-item');
    if (h.colour) li.style.setProperty('--hl', h.colour);
    if (h.text) li.append(marked('blockquote', 'hl-text', h.text, terms));
    if (h.note) li.append(marked('p', 'hl-note', h.note, terms));
    const meta = [];
    if (h.kind === 'note') meta.push(KIND.note);
    if (h.progress != null) meta.push(`${fmt(Math.round(h.progress))}%`);
    if (h.time && dash.dates !== 'week' && dash.dates !== 'month') meta.push(fWhen(new Date(h.time)));
    else if (h.date) meta.push(fDay(pDate(h.date)));
    const src = el('div', 'hx-src');
    src.append(rh.linkBook(cover(h.book_id, h.title, h.genre, 'hx-cv'), h.book_id));
    const txt = el('div', 'hx-srct');
    txt.append(ref(h, 'title'), byline('div', 'hx-by', h, ['author', 'series'], meta.join(' · ')));
    src.append(txt);
    li.append(src);
    return li;
  }

  const opt = (value, text) => Object.assign(el('option', null, text), { value: String(value) });
  function fill(sel, first, entries, value) {
    const sig = entries.map(([v]) => v).join('\u0001');
    if (sel.dataset.sig !== sig) { sel.replaceChildren(opt('', first), ...entries.map(([v, t]) => opt(v, t))); sel.dataset.sig = sig; }
    sel.value = entries.some(([v]) => String(v) === String(value)) ? String(value) : '';
    return sel.value;
  }

  let tools = null;
  function controls(parts) {
    if (tools) return tools;
    const box = el('div', 'tbl-tools hx-tools');
    const q = Object.assign(el('input'), { type: 'search', id: 'hx-q', placeholder: 'Search highlights, notes, titles…', autocomplete: 'off' });
    q.setAttribute('aria-label', 'Search highlights');
    const sel = (id, label) => { const s = el('select'); s.id = id; s.setAttribute('aria-label', label); return s; };
    const book = sel('hx-book', 'Book'), author = sel('hx-author', 'Author'), genre = sel('hx-genre', 'Genre'), year = sel('hx-year', 'Year');
    const kind = sel('hx-kind', 'Kind'), sort = sel('hx-sort', 'Sort');
    kind.append(opt('', 'Highlights and notes'), opt('note', 'Notes only'), opt('highlight', 'Without a note'));
    sort.append(opt('book', 'In book order'), opt('newest', 'Newest first'), opt('oldest', 'Oldest first'));
    box.append(q, book, author, genre, year, kind, sort);
    const sum = el('div', 'dy-sum hx-sum'), count = el('p', 'note hx-count');
    parts.note.after(sum, box, count);
    const more = el('button', 'dy-more', 'Show more');
    more.type = 'button'; more.id = 'hx-more';
    parts.box.after(more);
    let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { ui.q = q.value; ui.limit = FIRST_PAGE; drawList(); }, 120); });
    for (const [s, k] of [[book, 'book'], [author, 'author'], [genre, 'genre'], [year, 'year'], [kind, 'kind'], [sort, 'sort']]) {
      s.addEventListener('change', () => { ui[k] = s.value; ui.limit = FIRST_PAGE; drawList(); });
    }
    more.addEventListener('click', () => { ui.limit += PAGE; drawList(); });
    tools = { q, book, author, genre, year, kind, sort, sum, count, more, parts };
    return tools;
  }

  function drawList() {
    const rows = rowsNow();
    if (!tools || !rows) return;
    const { sum, count, more, parts } = tools;
    // each filter lists only what the other filters leave, so no choice gives nothing
    const pass = (h, skip) => (skip === 'book' || !ui.book || h.book_id === ui.book) && (skip === 'author' || !ui.author || h.author === ui.author) &&
      (skip === 'genre' || !ui.genre || h.genre === ui.genre) && (skip === 'year' || !ui.year || String(h.year) === ui.year) &&
      (!ui.kind || (ui.kind === 'note' ? !!h.note : !h.note));
    const choices = (key, label, skip) => {
      const m = new Map();
      rows.forEach((h) => { if (h[key] != null && pass(h, skip)) m.set(h[key], label(h)); });
      return [...m.entries()];
    };
    const byText = (a, b) => String(a[1]).localeCompare(String(b[1]));
    ui.book = fill(tools.book, 'All books', choices('book_id', (h) => h.title, 'book').sort(byText), ui.book);
    ui.author = fill(tools.author, 'All authors', choices('author', (h) => h.author, 'author').sort(byText), ui.author);
    ui.genre = fill(tools.genre, 'All genres', choices('genre', (h) => h.genre, 'genre').sort(byText), ui.genre);
    ui.year = fill(tools.year, 'Any year', choices('year', (h) => String(h.year), 'year').sort((a, b) => b[0] - a[0]), ui.year);
    tools.kind.value = ui.kind; tools.sort.value = ui.sort;
    if (tools.q.value !== ui.q && document.activeElement !== tools.q) tools.q.value = ui.q;

    const books = new Set(rows.map((h) => h.book_id)).size, notes = rows.filter((h) => h.note).length;
    const years = rows.map((h) => h.year).filter((y) => y != null);
    sum.replaceChildren(...[
      [fmt(rows.length), rows.length === 1 ? 'highlight or note' : 'highlights and notes'],
      [fmt(notes), notes === 1 ? 'with a note of your own' : 'with notes of your own'],
      [fmt(books), books === 1 ? 'book' : 'books'],
      ...(years.length ? [[d3.min(years) === d3.max(years) ? String(d3.min(years)) : `${d3.min(years)}–${d3.max(years)}`, 'when you made them']] : []),
    ].map(([v, l]) => { const d = el('div'); d.append(el('b', null, v), el('span', null, l)); return d; }));

    const terms = parse(ui.q);
    let shown = rows.filter((h) => pass(h) && matches(h, terms));
    if (SORTS[ui.sort]) shown = shown.slice().sort(SORTS[ui.sort]);
    const filtered = terms.length || ui.book || ui.author || ui.genre || ui.year || ui.kind;
    count.textContent = filtered ? `${fmt(shown.length)} ${shown.length === 1 ? 'match' : 'matches'} of ${fmt(rows.length)}.` : '';
    count.hidden = !filtered;
    const list = el('ul', 'hx-list');
    if (!shown.length) list.append(el('li', 'dy-empty', 'Nothing matches. Try fewer words or another filter.'));
    else list.append(...shown.slice(0, ui.limit).map((h) => item(h, terms)));
    parts.box.replaceChildren(list);
    more.hidden = shown.length <= ui.limit;
    more.textContent = `Show more (${fmt(shown.length - ui.limit)} left)`;
  }

  rh.card({
    tab: 'highlights', id: 'hx-search', title: 'Every highlight and note', calc: 'highlight_rows', privacy: 'highlights', chartClass: 'hx-box',
    note: 'Search across every book: all the words you type must appear (put "a phrase" in quotes). Case and accents don’t matter.',
    draw(box, rows, parts) { controls(parts); drawList(); },
  });

  rh.card({
    tab: 'highlights', id: 'hx-books', title: 'Most-highlighted books', calc: 'highlight_books', privacy: 'highlights', wide: false,
    note: 'Highlights and notes per book. Click one for its page.',
    hidden: () => { const d = rh.D('highlight_books'); return d.status === 'ok' && !d.data.length; },
    draw(box, rows) {
      const top = rows.slice(0, 12);
      const n = box.clientWidth < 520 ? 20 : 34; // hbars keeps up to 34 characters; a phone fits fewer
      rh.hbars(box, top, { field: 'title', label: (r) => (r.title.length > n ? r.title.slice(0, n - 1).trimEnd() + '…' : r.title), value: (r) => r.count, color: C[0], link: (r) => ['book', r.book_id],
        tipFn: (t, r) => rh.tipLines(t, r.title, [[null, 'Highlights and notes', fmt(r.count)], [null, 'With a note', fmt(r.notes)],
          ...(r.first ? [[null, 'Made', r.first === r.last ? fDay(pDate(r.first)) : `${fDay(pDate(r.first))} – ${fDay(pDate(r.last))}`]] : [])]) });
    },
  });

  rh.card({
    tab: 'highlights', id: 'hx-years', title: 'Highlights per year', calc: 'highlight_years', privacy: 'highlights', wide: false,
    note: 'Highlights and notes made each year. Click a year for its page.',
    hidden: () => { const d = rh.D('highlight_years'); return d.status === 'ok' && !d.data.length; },
    draw(box, rows) { rh.vbars(box, rows, (r) => r.year, (r) => r.count, C[2], 'Highlights and notes', (r) => ['year', r.year]); },
  });

  rh.card({
    tab: 'highlights', id: 'hx-repeats', title: 'Passages you came back to', calc: 'highlight_repeats', privacy: 'highlights',
    note: 'The same passage highlighted more than once: on a re-read, or on another device.',
    hidden: () => { const d = rh.D('highlight_repeats'); return d.status === 'ok' && !d.data.length; },
    draw(box, rows) {
      const list = el('ul', 'hx-list');
      list.append(...rows.slice(0, 10).map((g) => {
        const li = el('li', 'hx-item');
        li.append(el('blockquote', 'hl-text', g.text));
        g.notes.forEach((n) => li.append(el('p', 'hl-note', n)));
        const when = g.dates.length ? [...new Set(g.dates.map((d) => fDay(pDate(d))))].join(', ') : '';
        const src = el('div', 'hx-src');
        src.append(rh.linkBook(cover(g.book_id, g.title, g.genre, 'hx-cv'), g.book_id));
        const txt = el('div', 'hx-srct');
        txt.append(ref(g, 'title'), byline('div', 'hx-by', g, ['author'], `${g.times} times`, when));
        src.append(txt);
        li.append(src);
        return li;
      }));
      box.replaceChildren(list);
    },
  });
})();
