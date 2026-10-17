// Book clubs (BOO-58): a book read together. Clubs you host come from api/clubs; clubs a
// friend hosts on their own dashboard come with their data (friends/<slug>/clubs.json). The
// server has already hidden every comment pinned past where you are. Each club shows
// everyone's progress lanes against the schedule (rh.raceLanes, from the buddy-read race),
// the discussion, and once someone finishes, the club's stats.
(() => {
  const { el, fmt, plural, ref, linkBook, pDate, fDay, mins, okDay } = rh;
  const DAY = 864e5;
  const dayNo = (s) => Math.round(Date.parse(String(s).slice(0, 10)) / DAY);
  let own = { status: 'loading', clubs: [] }, role = null;

  async function loadOwn() {
    try {
      const r = await fetch('api/clubs', { cache: 'no-store' });
      own = { status: 'ok', clubs: r.ok ? ((await r.json()).clubs || []) : [] };
    } catch (e) { own = { status: 'ok', clubs: [] }; }
    rh.redraw();
  }
  window.addEventListener('dash:config', (e) => { role = (e.detail || {}).role || null; if ((e.detail || {}).can_read !== false) loadOwn(); });

  // someone's reading of the club's book since it started: { points, finished, end, minutes, words }
  function laneOf(person, book, start) {
    if (!person) return null;
    const theirs = dash.sameBook.matcher(person.books || [])(book);
    if (!theirs) return null;
    const from = dayNo(start) - 3;
    const days = (person.daily || []).filter((d) => d.book_id === theirs.id && dayNo(d.date) >= from).sort((x, y) => (x.date < y.date ? -1 : 1));
    let best = 0;
    const points = days.filter((d) => d.progress != null).map((d) => ({ date: d.date, progress: (best = Math.max(best, d.progress)) }));
    if (!points.length) return null;
    const done = points.find((p) => p.progress >= 99.5);
    const timed = days.filter(okDay);
    return {
      points, finished: !!done, end: done ? done.date : null, at: points.at(-1).progress,
      minutes: d3.sum(days, (d) => d.minutes || 0), wpm: d3.sum(timed, (d) => d.minutes) >= 20 ? Math.round(d3.sum(timed, (d) => d.words) / d3.sum(timed, (d) => d.minutes)) : null,
      highlights: (person.highlights || []).filter((h) => h.book_id === theirs.id && h.text),
    };
  }

  // every club, as the page draws it: members with where their reading comes from
  function allClubs() {
    const fr = rh.friends;
    const me = { books: dash.data('books').data || [], daily: dash.data('daily').data || [], highlights: dash.data('highlights').data || [] };
    const out = own.clubs.map((c) => ({
      ...c, host: null,
      people: c.members.map((m) => ({ name: m.key === 'me' ? 'You' : m.name, me: m.key === 'me', color: fr.color(m.key === 'me' ? 'me' : m.friend), data: m.key === 'me' ? me : m.friend ? fr.get(m.friend) : null })),
    }));
    fr.list().forEach((f) => (f.clubs || []).forEach((c) => out.push({
      ...c, host: f,
      people: c.members.map((m) => ({ name: m.you ? 'You' : m.name, me: !!m.you, color: m.you ? fr.color('me') : m.host ? fr.color(f.slug) : 'var(--cds-chart-muted)', data: m.you ? me : m.host ? f : null })),
    })));
    return out.sort((a, b) => (a.start < b.start ? 1 : -1));
  }

  function statusOf(lane, expected) {
    if (!lane) return ['', 'No reading shared'];
    if (lane.finished) return ['ok', 'Finished'];
    if (expected == null) return ['', `${Math.round(lane.at)}%`];
    if (lane.at >= expected + 5) return ['ahead', `Ahead · ${Math.round(lane.at)}%`];
    if (lane.at < expected - 5) return ['behind', `Behind · ${Math.round(lane.at)}%`];
    return ['on', `On track · ${Math.round(lane.at)}%`];
  }

  async function post(club, position, text) {
    const url = club.host ? `api/admin/federation/following/${encodeURIComponent(club.host.slug)}/clubs/${encodeURIComponent(club.id)}/comments` : `api/admin/clubs/${encodeURIComponent(club.id)}/comments`;
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position, text }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (club.host) await rh.friends.reload(); else await loadOwn();
  }

  function drawClub(c, today, parent) {
    // in the page before drawing, so the chart knows its width
    const box = el('div', 'cl-club');
    parent.append(box);
    const lanes = c.people.map((p) => ({ p, lane: laneOf(p.data, c.book, c.start) }));
    const expected = c.pct_per_week ? Math.min(100, Math.max(0, (today - dayNo(c.start)) / 7) * c.pct_per_week) : null;
    const mine = (dash.data('books').data || []).find((b) => dash.sameBook.keys(b).some((k) => dash.sameBook.keys(c.book).includes(k)));

    // the book, who's in, the schedule
    const head = el('div', 'cl-head');
    const title = el('b', 'cl-title', c.book.title);
    if (mine) linkBook(title, mine.id);
    const sub = el('div', 'cl-sub');
    sub.append(ref(c.book, 'author'), ` · started ${fDay(pDate(c.start))}`, c.pct_per_week ? ` · ${fmt(c.pct_per_week)}% a week` : '', c.host ? ` · hosted by ${c.host.name}` : '');
    head.append(title, sub);
    box.append(head);
    const who = el('ul', 'cl-members');
    lanes.forEach(({ p, lane }) => {
      const [cls, label] = statusOf(lane, expected);
      const li = el('li'), sw = el('i', 'sw');
      sw.style.background = p.color;
      li.append(sw, el('span', null, p.name), el('span', 'cl-badge' + (cls ? ' cl-' + cls : ''), label));
      who.append(li);
    });
    box.append(who);
    const drawn = lanes.filter((l) => l.lane).map(({ p, lane }) => ({ name: p.name, color: p.color, points: lane.points, finished: lane.finished }));
    if (drawn.length) {
      const chart = el('div', 'rc-chart');
      box.append(chart);
      rh.raceLanes(chart, drawn, { mode: 'date', from: c.start, schedule: c.pct_per_week ? { start: c.start, pct_per_week: c.pct_per_week } : null, height: 200 });
    }

    // the end: who finished first, hours together, speeds, passages everyone marked
    const finished = lanes.filter((l) => l.lane && l.lane.finished).sort((a, b) => (a.lane.end < b.lane.end ? -1 : 1));
    if (finished.length || (expected != null && expected >= 100)) {
      const st = el('div', 'cl-stats');
      const fact = (k, v) => { const d = el('div'); d.append(el('span', null, k), el('b', null, v)); st.append(d); };
      if (finished.length) fact(finished.length > 1 ? 'Finishing order' : 'Finished first', finished.map((l) => `${l.p.name} (${fDay(pDate(l.lane.end))})`).join(', '));
      const minutes = d3.sum(lanes, (l) => (l.lane ? l.lane.minutes : 0));
      if (minutes) fact('Hours together', mins(minutes));
      const sp = lanes.filter((l) => l.lane && l.lane.wpm).sort((a, b) => b.lane.wpm - a.lane.wpm);
      if (sp.length > 1) fact('Speed', sp.map((l) => `${l.p.name} ${fmt(l.lane.wpm)} wpm`).join(' · '));
      // the same passage highlighted by more than one reader
      const by = new Map();
      lanes.forEach(({ p, lane }) => (lane ? lane.highlights : []).forEach((h) => {
        const k = h.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!by.has(k)) by.set(k, { text: h.text, who: new Set() });
        by.get(k).who.add(p.name);
      }));
      const top = [...by.values()].filter((x) => x.who.size > 1).sort((a, b) => b.who.size - a.who.size).slice(0, 3);
      box.append(el('h4', 'cl-h', finished.length === lanes.length ? 'The club in numbers' : 'So far'), st);
      if (top.length) {
        const q = el('ul', 'cl-quotes');
        top.forEach((x) => { const li = el('li'); li.append(el('q', null, x.text), el('span', 'cl-n', `highlighted by ${[...x.who].join(' and ')}`)); q.append(li); });
        box.append(el('h4', 'cl-h', 'Most-highlighted passages'), q);
      }
    }

    // the discussion
    box.append(el('h4', 'cl-h', 'Discussion'));
    // your own comments: as the host, or as the member marked you on a friend's club
    const myKey = c.host ? (c.members.find((m) => m.you) || {}).key : 'me';
    const list = el('ul', 'cl-comments');
    if (!c.comments.length) list.append(el('li', 'cl-none', 'No comments yet.'));
    c.comments.forEach((m) => {
      const li = el('li', m.hidden ? 'cl-hidden' : '');
      li.append(el('span', 'cl-pos', `${fmt(m.position)}%`));
      if (m.hidden) li.append(el('span', null, `${m.name} wrote something here. Read on to see it.`));
      else { const t = el('div'); t.append(el('b', null, m.member === myKey ? 'You' : m.name), ` ${m.text}`); li.append(t); }
      list.append(li);
    });
    box.append(list);
    if (role === 'admin') {
      const at = el('input'), txt = el('input'), go = el('button', 'up-copy', 'Post'), msg = el('p', 'fr-note');
      Object.assign(at, { type: 'number', min: 0, max: 100, step: 'any', value: Math.round(c.progress ?? 0), title: 'Where in the book (%)' });
      at.setAttribute('aria-label', 'Where in the book (%)');
      Object.assign(txt, { type: 'text', maxLength: 1000, placeholder: 'Say something about this part…' });
      txt.setAttribute('aria-label', 'Comment');
      go.type = 'button';
      go.addEventListener('click', async () => {
        if (!txt.value.trim()) return;
        go.disabled = true; msg.textContent = 'Posting…';
        try { await post(c, Number(at.value), txt.value); } catch (e) { msg.textContent = e.message; go.disabled = false; }
      });
      const form = el('div', 'cl-form');
      form.append(at, txt, go);
      box.append(form, msg, el('p', 'fr-note', 'Pinned where you say: others see it once they’ve read that far.'));
    }
  }

  rh.card({
    tab: 'friends', id: 'friends-clubs', title: 'Book clubs', after: 'card-friends-list', calc: 'as_of',
    note: 'Books read together. Everyone’s progress against the schedule; comments stay hidden until you’ve read that far.',
    draw(box, asOf, parts) {
      box.replaceChildren();
      const fr = rh.friends;
      if (!fr || fr.status() !== 'ok') { parts.card.hidden = true; return; }
      const clubs = allClubs();
      parts.card.hidden = !clubs.length;
      if (!clubs.length) return;
      const today = dayNo(asOf[0].date);
      const grid = el('div', 'cl-grid');
      box.append(grid);
      clubs.forEach((c) => drawClub(c, today, grid));
      parts.note.textContent = `${plural(clubs.length, 'club')}. Everyone’s progress against the schedule; comments stay hidden until you’ve read that far.`;
    },
  });

  // ---------- admin: start a club ----------
  const blocks = Array.isArray(rh.friendsAdmin) ? rh.friendsAdmin : (rh.friendsAdmin = []);
  blocks.push((box, a, state) => {
    const { h, block, msg } = a;
    const wrap = h('div', {}, h('p', { class: 'note' }, 'Loading…'));
    (async () => {
      let fed = { followers: [] };
      try { fed = await a.get('api/admin/federation'); } catch (e) { /* federation not set up */ }
      try { await a.get('api/clubs').then((r) => (own = { status: 'ok', clubs: r.clubs || [] })); } catch (e) { /* none */ }
      const books = (dash.data('books').data || []).slice().sort((x, y) => x.title.localeCompare(y.title));
      const approved = fed.followers.filter((f) => f.status === 'approved');
      // a friend you follow who also follows you can comment from their dashboard
      const people = state.friends.map((f) => ({ name: f.name, friend: f.slug, follower: (approved.find((x) => f.url && x.url === f.url) || {}).id || null }));
      approved.filter((x) => !people.some((p) => p.follower === x.id)).forEach((x) => people.push({ name: x.name, friend: null, follower: x.id }));
      const book = h('input', { type: 'search', id: 'cl-book', list: 'cl-books', placeholder: 'A book in your library' });
      const start = h('input', { type: 'date', id: 'cl-start', value: new Date().toISOString().slice(0, 10) });
      const pct = h('input', { type: 'number', id: 'cl-pct', min: '1', max: '100', step: '1', placeholder: 'e.g. 10' });
      const checks = people.map((p) => { const c = h('input', { type: 'checkbox' }); return [p, c, h('label', { class: 'pv-check' }, c, p.name, h('span', { class: 'ad-meta' }, p.friend && p.follower ? ' · can comment' : p.friend ? ' · progress only' : ' · comments only'))]; });
      const out = msg();
      const go = h('button', { class: 'up-primary ad-auto', type: 'button', onclick: async () => {
        const b = books.find((x) => x.title === book.value);
        if (!b) { out.textContent = 'Choose a book from your library.'; return; }
        try {
          await a.post('api/admin/clubs', {
            book: { title: b.title, author: b.author, isbn13: b.isbn13 || null, work_id: b.work_id || null, book_id: b.id },
            start: start.value, pct_per_week: pct.value ? Number(pct.value) : null,
            members: checks.filter(([, c]) => c.checked).map(([p]) => p),
          });
          out.textContent = 'Started. It’s on the Friends tab.';
          await loadOwn(); a.refresh();
        } catch (e) { out.textContent = e.message; }
      } }, 'Start the club');
      const list = own.clubs.length ? h('ul', { class: 'ad-list' }, own.clubs.map((c) => h('li', {},
        h('span', { class: 'ad-name' }, c.book.title, h('span', { class: 'ad-meta' }, ` · from ${fDay(pDate(c.start))} · ${c.members.length} readers · ${c.comments.length} comments`)),
        h('button', { class: 'up-link', type: 'button', onclick: async () => {
          if (!confirm(`End the club on ${c.book.title}? Its comments go too.`)) return;
          const r = await fetch('api/admin/clubs/' + encodeURIComponent(c.id), { method: 'DELETE' });
          if (r.ok) { await loadOwn(); a.refresh(); }
        } }, 'End')))) : null;
      wrap.replaceChildren(
        h('label', { for: 'cl-book' }, 'Book'), book, h('datalist', { id: 'cl-books' }, books.map((b) => h('option', { value: b.title }))),
        h('label', { for: 'cl-start' }, 'Start'), start, h('label', { for: 'cl-pct' }, 'Schedule: % of the book a week (optional)'), pct,
        h('label', {}, 'Who’s reading'), people.length ? h('div', { class: 'pv-checks' }, checks.map((x) => x[2])) : h('p', { class: 'note' }, 'Add or follow friends first.'),
        h('div', { class: 'ad-actions' }, go), out, list);
    })();
    return block('Book clubs', 'Read a book together. Friends’ progress comes from the reading they share; friends who follow your dashboard can comment from theirs. Comments are pinned to a position and hidden from anyone who hasn’t read that far.', wrap);
  });
})();
