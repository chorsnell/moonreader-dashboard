// Friends' reading in your dashboard (BOO-30). A friend is a named profile whose data (the
// same books/reads/daily files as yours, already filtered by what they chose to share) the
// server keeps in library/friends/<slug>/: from a share file the admin uploaded, or pulled
// from their own installation (federation). data/friends.json lists them; their files are
// at friends/<slug>/<file>.json. The static demo ships both as plain files.
//
// rh.friends is what the other friends-*.js views build with: the list, each friend's data,
// the friend picked in "Compare with", their colour, a book matcher, and calcs worked out
// from a friend's data (dash.calcWith).

// Matching books across libraries, kept apart from the page so calcs (and tests) can use it:
// dash.sameBook.{keys, matcher, shared, authorKey}.
(() => {
  // the same book has the same ISBN or work id; failing that, the same title and author once
  // case, accents, punctuation and a leading article are ignored
  const norm = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const titleKey = (t) => norm(t).replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const authorKey = (a) => norm(a).replace(/[^a-z]+/g, '');
  function keys(b) {
    const out = [];
    if (b.isbn13) out.push('isbn:' + String(b.isbn13).replace(/[^0-9X]/gi, ''));
    if (b.work_id) out.push('work:' + b.work_id);
    if (b.title) out.push('ta:' + titleKey(b.title) + '|' + authorKey(b.author));
    return out;
  }
  // a finder over a list of books: find(book) gives the matching one, or null
  function matcher(books) {
    const by = new Map();
    (books || []).forEach((b) => keys(b).forEach((k) => { if (!by.has(k)) by.set(k, b); }));
    return (b) => { for (const k of keys(b)) if (by.has(k)) return by.get(k); return null; };
  }
  // books you both have: [{ mine, theirs }]
  function shared(mine, theirs) {
    const find = matcher(mine), seen = new Set(), out = [];
    (theirs || []).forEach((t) => { const m = find(t); if (m && !seen.has(m.id)) { seen.add(m.id); out.push({ mine: m, theirs: t }); } });
    return out;
  }

  dash.sameBook = { keys, matcher, shared, authorKey };
})();

(() => {
  const { el, fmt, plural, fShort, pDate } = rh;
  const st = { status: 'loading', me: { name: 'You', leaderboards: [] }, list: [], data: {} };
  const memo = new Map();
  const PARTS = ['books', 'reads', 'daily', 'highlights', 'clubs'];

  async function load() {
    let index;
    try {
      const r = await fetch('data/friends.json?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('none');
      index = await r.json();
    } catch (e) {
      Object.assign(st, { status: 'none', list: [], data: {} });
      sync();
      return;
    }
    const list = (index.friends || []).filter((f) => f && f.slug);
    const data = {};
    await Promise.all(list.map(async (f) => {
      const d = { ...f };
      await Promise.all(PARTS.map(async (p) => {
        d[p] = [];
        if (p === 'clubs' ? !f.clubs : f.parts && !f.parts.includes(p)) return;
        try { const r = await fetch(`friends/${encodeURIComponent(f.slug)}/${p}.json`); if (r.ok) d[p] = await r.json(); } catch (e) { /* left empty */ }
      }));
      data[f.slug] = d;
    }));
    memo.clear();
    Object.assign(st, { status: 'ok', me: { name: 'You', leaderboards: [], ...index.me }, list: list.map((f) => data[f.slug]), data });
    sync();
  }
  // the tab shows only when there are friends to show
  function sync() {
    const t = document.getElementById('tab-friends');
    if (t) t.hidden = st.status === 'ok' ? !st.list.length : st.status !== 'loading';
    if (t && t.hidden && rh.current() === 'friends') rh.show('overview');
    else rh.redraw();
  }
  window.addEventListener('dash:config', (e) => { if (e.detail && e.detail.can_read !== false) load(); });

  const { keys, matcher, shared, authorKey } = dash.sameBook;

  // ---------- colours: you first, then each friend in order ----------
  const color = (slug) => (slug === 'me' || !slug ? rh.C[0] : rh.C[(st.list.findIndex((f) => f.slug === slug) + 1) % rh.C.length]);

  // ---------- the friend picked in "Compare with" ----------
  function selected() {
    if (st.status !== 'ok' || !st.list.length) return null;
    const want = dash.params().friend;
    return st.data[want] || st.list[0];
  }
  const select = (slug) => dash.setParams({ friend: slug });

  // a calc worked out from a friend's data, kept until their data reloads
  function calc(slug, id) {
    const f = st.data[slug];
    if (!f) return [];
    const k = slug + '|' + id;
    if (!memo.has(k)) {
      try { memo.set(k, dash.calcWith(id, { books: f.books, reads: f.reads, daily: f.daily, highlights: f.highlights })); }
      catch (e) { console.error(id, e); memo.set(k, []); }
    }
    return memo.get(k);
  }

  // "updated 3 Oct 2026", or why it's old
  function freshness(f) {
    const when = f.updated ? new Date(String(f.updated).replace(' ', 'T')) : null;
    const date = when && !isNaN(when) ? when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    if (f.status === 'offline') return `Couldn't reach their dashboard lately; showing their reading as of ${date || 'the last visit'}`;
    if (f.status === 'pending') return 'Waiting for them to approve';
    return date ? `Updated ${date}` : '';
  }

  rh.friends = {
    status: () => st.status,
    me: () => st.me,
    list: () => st.list.slice(),
    get: (slug) => st.data[slug] || null,
    selected, select, color, calc, matcher, shared, keys, authorKey, freshness,
    reload: load,
  };

  // ---------- the Friends tab ----------
  rh.tab('friends', 'Friends', { after: 'library' });
  const tabButton = document.getElementById('tab-friends');
  if (tabButton) tabButton.hidden = true;

  // "Compare with": the friend the one-to-one views compare you with
  rh.card({
    tab: 'friends', id: 'friends-pick', title: 'Compare with', wide: true,
    note: 'Friends who share their reading with you. Their data is theirs: it only has what they chose to share.',
    draw(box) {
      box.replaceChildren();
      if (st.status !== 'ok') { box.append(el('div', 'dy-empty', st.status === 'loading' ? 'Loading friends…' : 'No friends yet.')); return; }
      const cur = selected();
      const row = el('div', 'fr-pick');
      row.setAttribute('role', 'radiogroup');
      row.setAttribute('aria-label', 'Compare with');
      st.list.forEach((f) => {
        const b = el('button', 'fr-pill');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(cur && cur.slug === f.slug));
        const sw = el('i', 'sw'); sw.style.background = color(f.slug);
        b.append(sw, f.name);
        b.addEventListener('click', () => select(f.slug));
        row.append(b);
      });
      box.append(row);
    },
  });

  // each friend at a glance
  rh.card({
    tab: 'friends', id: 'friends-list', title: 'Your friends', wide: true,
    note: 'What each friend shares, and how fresh it is.',
    draw(box) {
      box.replaceChildren();
      if (st.status !== 'ok') return;
      const grid = el('div', 'fr-grid');
      st.list.forEach((f) => {
        const c = el('div', 'fr-card');
        c.style.setProperty('--fr', color(f.slug));
        const head = el('div', 'fr-head');
        head.append(el('b', 'fr-name', f.name), el('span', 'chip', f.source === 'federation' ? 'Follows their dashboard' : 'From a share file'));
        if (f.status === 'offline') head.append(el('span', 'chip fr-warn', 'Offline'));
        const fin = f.books.filter((b) => b.status === 'finished').length;
        const hours = Math.round(f.books.reduce((a, b) => a + (b.hours || 0), 0));
        const mineFind = matcher(dash.data('books').data || []);
        const both = f.books.filter((b) => mineFind(b)).length;
        const facts = el('div', 'fr-facts');
        [[fmt(f.books.length), 'books'], [fmt(fin), 'finished'], [fmt(hours), 'hours'], [fmt(both), 'shared']].forEach(([v, l]) => {
          const k = el('div'); k.append(el('b', null, v), el('span', null, l)); facts.append(k);
        });
        const latest = f.reads.slice().sort((a, b) => (a.end < b.end ? 1 : -1))[0];
        const note = el('p', 'fr-note', freshness(f));
        if (latest && latest.end) note.append(`${note.textContent ? ' · ' : ''}last read ${fShort(pDate(String(latest.end).slice(0, 10)))}`);
        const hid = (f.privacy && f.privacy.hidden) || [];
        const keeps = el('p', 'fr-note', hid.length ? `Keeps to themselves: ${hid.map((h) => HIDDEN[h] || h).join(', ')}.` : 'Shares everything.');
        c.append(head, facts, note, keeps);
        grid.append(c);
      });
      box.append(grid);
      box.append(el('p', 'note', `${plural(st.list.length, 'friend')}. ${st.me.name !== 'You' ? `They see you as ${st.me.name}.` : ''}`));
    },
  });
  const HIDDEN = { exact_dates: 'exact dates', diary: 'day-by-day reading', current: 'what they’re reading now', streaks: 'streaks', money: 'prices', highlights: 'highlights' };
})();
