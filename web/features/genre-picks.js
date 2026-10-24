// Popular books in your genres that you haven't read (BOO-105). data/genre_picks.json (built
// from Open Library's subjects, see docs/api.md) has up to 25 a genre, and a subgenre with
// three or more books, most popular first. A card on each genre and subgenre page, and one
// on the To read tab with the top few from your most-read genres. The admin gets a "Want to
// read" button (rh.wantToRead, from to-read.js) on each.
(() => {
  const { el, fmt, plural } = rh;
  const PAGE_SHOWN = 10, TAB_GENRES = 3, TAB_PER_GENRE = 3, RECENT_YEARS = 2;
  const DAY = 864e5, t = (s) => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');

  dash.file('genre_picks', 'data/genre_picks.json', { optional: true });

  dash.calc('genre_picks_top', {
    inputs: ['genre_picks', 'books', 'reads', 'as_of'],
    title: 'Popular in your genres',
    description: `The ${TAB_PER_GENRE} most popular books on Open Library you haven't got in each of your ${TAB_GENRES} most-read genres (by hours read in the last ${RECENT_YEARS} years, else ever), from genre_picks.json; one row per book, with the genre's hours.`,
    fn: (picks, books, reads, asOf) => {
      const rows = Array.isArray(picks) ? picks : [];
      if (!rows.length) return [];
      const end = (asOf[0] && asOf[0].date) || new Date().toISOString().slice(0, 10);
      const from = t(end) - RECENT_YEARS * 365 * DAY;
      const tagged = (g) => g && g !== 'Untagged' && g !== 'Private';
      const sum = (list, genre, hours) => {
        const m = new Map();
        list.forEach((r) => { const g = genre(r); if (tagged(g)) m.set(g, (m.get(g) || 0) + (hours(r) || 0)); });
        return m;
      };
      let hours = sum(reads.filter((r) => (r.end || r.start) && t(r.end || r.start) >= from), (r) => r.genre, (r) => r.hours);
      if (![...hours.values()].some((h) => h > 0)) hours = sum(books, (b) => b.genre, (b) => b.hours);
      const withPicks = new Set(rows.filter((r) => r.subgenre == null).map((r) => r.genre));
      const top = [...hours].filter(([g, h]) => h > 0 && withPicks.has(g))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TAB_GENRES);
      return top.flatMap(([genre, h]) => rows
        .filter((r) => r.genre === genre && r.subgenre == null)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, TAB_PER_GENRE)
        .map((r) => ({ ...r, genre_hours: Math.round(h * 10) / 10 })));
    },
  });

  // ---------- drawing ----------
  // An author links to their page only when they're in your library (spelled as books.json
  // spells them); Open Library writes "Jane Austen" where books.json may have "Austen, Jane".
  const plainName = (s) => String(s || '').split(/\s*(?:&|;| and )\s*/)[0].replace(/^([^,]+),\s*(.+)$/, '$2 $1')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '');
  let authorsOf = null, authorsFor = null;
  function yourAuthor(name) {
    const books = rh.D('books').data || [];
    if (authorsFor !== books) {
      authorsFor = books; authorsOf = new Map();
      books.forEach((b) => { const k = plainName(b.author); if (k && !authorsOf.has(k)) authorsOf.set(k, b.author.split(/\s*(?:&|;| and )\s*/)[0]); });
    }
    return authorsOf.get(plainName(name)) || null;
  }

  function item(r) {
    const li = el('li', 'gp-item'), ttl = el('div', 'ttl');
    ttl.append(el('span', 'gp-title', r.title));
    const by = el('small');
    if (r.author) {
      // linked only when they're your author; otherwise Open Library's name as plain text
      const mine = yourAuthor(r.author), theirs = String(r.author);
      by.append(mine ? rh.ref({ author: mine }, 'author', theirs) : theirs);
    }
    if (r.published_year != null) { if (r.author) by.append(' · '); by.append(String(r.published_year < 0 ? `${-r.published_year} BC` : r.published_year)); }
    if (r.on_pile) by.append(el('span', 'gp-tag', 'On your pile'));
    ttl.append(by);
    li.append(ttl);
    // the admin's own "Want to read" (BOO-102); only when to-read.js gives one
    const w = rh.wantToRead;
    const btn = w && typeof w.button === 'function'
      ? w.button({ title: r.title, author: r.author, isbn13: null, work_id: r.work_id, published_year: r.published_year, genre: r.genre, from: 'genre' }, 'genre')
      : null;
    if (btn instanceof Node) { const m = el('div', 'meta gp-act'); m.append(btn); li.append(m); }
    return li;
  }

  // the genre and subgenre pages: this genre's picks, before the full list of books
  const expanded = {};
  function pageCard(kind, id, root) {
    const res = rh.D('genre_picks');
    if (res.status !== 'ok') return;
    const rows = (res.data || []).filter((r) => (kind === 'genre' ? r.genre === id && r.subgenre == null : r.subgenre === id)).sort((a, b) => a.rank - b.rank);
    const c = el('div', 'rh-card wide gp-card');
    c.id = 'card-genre-page-picks';
    c.append(el('h2', null, `Popular in ${id} you haven’t read`));
    if (!rows.length) {
      c.append(el('p', 'note', 'Nothing to suggest yet. Suggestions come from Open Library after the next lookup.'));
    } else {
      const key = kind + '/' + id, all = !!expanded[key];
      c.append(el('p', 'note', `The best-loved books in ${id} on Open Library that aren’t in your library, most popular first.`));
      const ul = el('ul', 'rh-list gp-list');
      ul.append(...(all ? rows : rows.slice(0, PAGE_SHOWN)).map(item));
      c.append(ul);
      if (rows.length > PAGE_SHOWN) {
        const b = el('button', 'up-link gp-more', all ? 'Show fewer' : `Show all ${fmt(rows.length)}`);
        b.type = 'button'; b.id = 'genre-picks-more';
        b.addEventListener('click', () => { expanded[key] = !all; rh.redraw(); });
        c.append(b);
      }
    }
    // before the "Books" table at the bottom, if there is one
    const tables = root.querySelectorAll('.ge-tbl');
    const last = tables.length ? tables[tables.length - 1].closest('.rh-card') : null;
    if (last) last.before(c); else root.append(c);
  }
  rh.extend('genre', (id, root) => pageCard('genre', id, root));
  rh.extend('subgenre', (id, root) => pageCard('subgenre', id, root));

  // the To read tab: at the end, after "More from your authors and series" when that's there
  rh.card({
    tab: 'toread', id: 'genre-picks', title: 'Popular in your genres', calc: 'genre_picks_top', after: 'card-discover-more',
    note: `The best-loved books on Open Library in the genres you’ve read most lately that you haven’t got.`,
    draw(box, rows, parts) {
      if (!rows.length) { box.replaceChildren(el('div', 'dy-empty', 'Nothing to suggest yet.')); return; }
      const out = [];
      [...new Set(rows.map((r) => r.genre))].forEach((g) => {
        const h = el('h3', 'gp-genre');
        h.append(rh.chip('genre', g), el('span', 'gp-hours', `${fmt(Math.round(rows.find((r) => r.genre === g).genre_hours))} h read`));
        const ul = el('ul', 'rh-list gp-list');
        ul.append(...rows.filter((r) => r.genre === g).map(item));
        out.push(h, ul);
      });
      box.replaceChildren(...out);
      const n = new Set(rows.map((r) => r.genre)).size;
      parts.note.textContent = `The best-loved books on Open Library in your ${n === 1 ? 'most-read genre' : plural(n, 'most-read genre')} that you haven’t got.`;
    },
  });

  // ---------- Admin → Discovery ----------
  // which Open Library subject each genre is looked up under; '' skips a genre
  rh.adminSection({ id: 'discovery', title: 'Discovery', order: 42, draw(box, a) {
    const { h, block, msg } = a;
    const out = msg(), list = h('div', { class: 'gp-admin' });
    const save = h('button', { class: 'up-primary ad-auto', type: 'button', id: 'discovery-save', disabled: true }, 'Save');
    box.append(block('Popular in your genres', 'Each genre page, and the To read tab, suggests well-loved books from that genre’s subject on Open Library. Change the subject a genre is looked up under (as in openlibrary.org/subjects/fantasy), or leave it blank and tick Skip to suggest nothing for it. Subgenres with three or more books get their own.', list, h('div', { class: 'ad-actions' }, save), out));
    let rows = [], inputs = [];
    const render = () => {
      if (!rows.length) { list.replaceChildren(h('p', { class: 'up-note' }, 'No genres yet. Tag your books in Catalogue and they’ll show here.')); save.disabled = true; return; }
      inputs = rows.map((r) => {
        const name = r.subgenre ?? r.genre;
        const input = h('input', { type: 'text', value: r.override ?? '', placeholder: r.default_subject || 'not looked up', 'aria-label': `Open Library subject for ${name}`, autocomplete: 'off', spellcheck: 'false' });
        const skip = h('input', { type: 'checkbox', 'aria-label': `Skip ${name}` });
        skip.checked = r.override === '';
        input.disabled = skip.checked;
        skip.addEventListener('change', () => { input.disabled = skip.checked; save.disabled = false; });
        input.addEventListener('input', () => { save.disabled = false; });
        return { r, name, input, skip };
      });
      list.replaceChildren(h('ul', { class: 'ad-list gp-admin-list' }, inputs.map(({ r, name, input, skip }) => {
        const found = r.works != null ? `${fmt(r.works)} books found` : r.subject ? 'not looked up yet' : 'skipped';
        const label = r.subgenre ? h('span', {}, rh.chip('subgenre', r.subgenre), h('small', { class: 'up-note' }, ` in ${r.genre}`)) : rh.chip('genre', r.genre);
        return h('li', {}, h('div', { class: 'gp-admin-name' }, label, h('small', { class: 'up-note' }, `${plural(r.books, 'book')} · ${found}`)),
          h('div', { class: 'gp-admin-field' }, input, h('label', { class: 'gp-skip' }, skip, 'Skip')));
      })));
      save.disabled = true;
    };
    async function load() {
      out.textContent = 'Loading…';
      try { rows = (await a.get('api/admin/discovery')).genres; out.textContent = ''; render(); } catch (e) { out.textContent = e.message; }
    }
    save.addEventListener('click', async () => {
      const subjects = {};
      inputs.forEach(({ name, input, skip }) => {
        if (skip.checked) subjects[name] = '';
        else if (input.value.trim()) subjects[name] = input.value.trim();
      });
      save.disabled = true; out.textContent = 'Saving…';
      try {
        const before = await a.status().catch(() => ({}));
        const r = await a.put('api/admin/discovery', { subjects });
        if (r.rebuilding) await a.waitForBuild(before, (s) => { out.textContent = s; });
        else out.textContent = 'Nothing changed.';
        await load();
        if (r.rebuilding) out.textContent = 'Saved. Any new subject is looked up on Open Library in the background, and the suggestions update after that.';
      } catch (e) { out.textContent = e.message; save.disabled = false; }
    });
    load();
  } });
})();
