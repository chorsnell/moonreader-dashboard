// The admin's own *arr book manager (BOO-64): Readarr's v1 API, as kept by forks such as
// Bookshelf. Admin only, and never while previewing as a visitor: settings in Admin → Book
// manager, status badges and "Get next in series" / "Get the rest of this author" buttons
// on book, series and author pages. Requests go from this server to the admin's instance;
// the dashboard never searches for or downloads books itself.
(() => {
  const { D, fDay, pDate } = rh;
  // an element with a class and any number of children (text or nodes; null skipped)
  const el = (tag, cls, ...kids) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    kids.flat().forEach((k) => k != null && n.append(k));
    return n;
  };
  const STATUS = { available: 'Available', downloading: 'Downloading', wanted: 'Wanted', in_library: 'In your book manager' };
  const ABOUT = 'This only sends a request to your own book manager; the dashboard never searches for or downloads books itself.';
  let on = false, status = null, loading = null;

  async function call(method, url, body) {
    const r = await fetch(url, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let j = {}; try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  function refresh() {
    loading = call('GET', 'api/admin/arr/status').then((s) => { status = s; }).catch((e) => { status = { error: e.message, books: {}, series: {}, requests: [] }; })
      .finally(() => { loading = null; rh.redraw(); });
    return loading;
  }
  window.addEventListener('dash:config', async (e) => {
    const c = e.detail || {};
    on = false; status = null;
    if (c.role !== 'admin' || c.preview) return;
    try { on = (await call('GET', 'api/admin/arr')).configured; } catch (err) { on = false; }
    if (on) refresh();
  });

  const badge = (s) => el('span', 'arr-badge arr-' + s, STATUS[s] || s);
  // a button that sends one request and says how it went
  function requestButton(label, url, body) {
    const msg = el('span', 'arr-msg');
    const b = el('button', 'arr-btn', label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true; msg.textContent = 'Asking your book manager…';
      try {
        const r = await call('POST', url, body);
        msg.textContent = r.request.outcome === 'added' ? `Added${r.request.arr_title ? ` “${r.request.arr_title}”` : ''}, and it’s searching.` : `Done: ${r.request.outcome}.`;
        refresh();
      } catch (err) { msg.textContent = err.message; b.disabled = false; }
    });
    return el('div', 'arr-act', b, msg);
  }
  const lastRequest = (match) => (status?.requests || []).filter(match).pop();
  const nextOf = (series) => { const n = D('series_next'); return n.status === 'ok' ? n.data.find((r) => r.series === series) : null; };
  const no = (n) => (n != null ? `#${n}` : 'the next book');

  function nextButton(series, author) {
    const nx = nextOf(series);
    if (!nx || nx.status !== 'not_in_library' || nx.next_no == null) return null;
    const there = (status?.series?.[series] || []).find((r) => r.no === nx.next_no);
    if (there) return el('p', 'note', `${no(nx.next_no)} of ${series}, ${there.title}, isn’t in your library yet; your book manager has it: `, badge(there.status));
    const asked = lastRequest((r) => r.series === series && r.series_no === nx.next_no);
    return el('div', null,
      el('p', 'note', `${no(nx.next_no)} of ${series} isn’t in your library.` + (asked ? ` Asked for on ${fDay(pDate(asked.time.slice(0, 10)))} (${asked.outcome}).` : '')),
      requestButton(`Get next in series (${no(nx.next_no)})`, 'api/admin/arr/request', { series, series_no: nx.next_no, author }));
  }
  function seriesList(series) {
    const rows = status?.series?.[series] || [];
    if (!rows.length) return null;
    const ul = el('ul', 'arr-list');
    rows.forEach((r) => ul.append(el('li', null, el('span', null, `#${r.no} ${r.title}`), badge(r.status), r.read ? null : el('span', 'arr-new', 'not read yet'))));
    return ul;
  }

  // ---------- book pages ----------
  rh.bookCard({
    id: 'bk-arr', title: 'Book manager', wide: false,
    draw(box, rows, parts, b) {
      if (!on) return false;
      box.replaceChildren(); box.style.minHeight = '0';
      if (!status) { box.append(el('p', 'note', 'Asking your book manager…')); return; }
      if (status.error) { box.append(el('p', 'note', status.error)); return; }
      const s = status.books[b.id];
      box.append(el('div', 'arr-row', s ? badge(s.status) : el('span', 'arr-badge', 'Not in your book manager')));
      const asked = lastRequest((r) => r.title && r.title.toLowerCase() === b.title.toLowerCase());
      if (asked) box.append(el('p', 'note', `You asked for it on ${fDay(pDate(asked.time.slice(0, 10)))}; now it’s in your library.`));
      if (b.series) {
        const n = nextButton(b.series, b.author);
        if (n) box.append(n);
      }
      box.append(el('p', 'arr-about', ABOUT));
    },
  });

  // ---------- series pages ----------
  rh.extend('series', (name, root) => {
    if (!on || !status || status.error) return;
    const books = (D('books').data || []).filter((x) => x.series === name);
    const author = books[0]?.author || '';
    const next = nextButton(name, author), list = seriesList(name);
    if (!next && !list) return;
    const c = el('div', 'rh-card wide arr-card');
    c.append(el('h2', null, 'Book manager'));
    if (list) c.append(el('p', 'note', 'This series in your book manager.'), list);
    if (next) c.append(next);
    c.append(el('p', 'arr-about', ABOUT));
    root.append(c);
  });

  // ---------- author pages ----------
  rh.extend('author', (name, root) => {
    if (!on) return;
    const c = el('div', 'rh-card wide arr-card');
    const list = el('div', null, el('p', 'note', 'Asking your book manager…'));
    const asked = lastRequest((r) => r.kind === 'author' && r.author === name);
    c.append(...[el('h2', null, 'Book manager'), list,
      asked ? el('p', 'note', `You asked for the rest of ${name} on ${fDay(pDate(asked.time.slice(0, 10)))} (${asked.outcome}).`) : null,
      requestButton('Get the rest of this author', 'api/admin/arr/request-author', { author: name }), el('p', 'arr-about', ABOUT)].filter(Boolean));
    root.append(c);
    call('GET', 'api/admin/arr/author?name=' + encodeURIComponent(name)).then((r) => {
      if (!r.books.length) { list.replaceChildren(el('p', 'note', 'No books by them in your book manager yet.')); return; }
      const unread = r.books.filter((x) => !x.read && x.status === 'available').length;
      const ul = el('ul', 'arr-list');
      r.books.forEach((x) => ul.append(el('li', null, el('span', null, x.title), badge(x.status), x.read ? null : el('span', 'arr-new', 'not read yet'))));
      list.replaceChildren(el('p', 'note', `${r.books.length} in your book manager` + (unread ? `, ${unread} on the server and not read yet.` : '.')), ul);
    }).catch((err) => list.replaceChildren(el('p', 'note', err.message)));
  });

  // ---------- Admin → Book manager ----------
  rh.adminSection({ id: 'arr', title: 'Book manager', order: 60, draw(box, a) {
    const { h } = a;
    const url = h('input', { type: 'url', id: 'arr-url', placeholder: 'http://bookshelf:8787', autocomplete: 'off' });
    const key = h('input', { type: 'password', id: 'arr-key', autocomplete: 'off' });
    const msg = a.msg();
    const drop = h('button', { class: 'up-link', type: 'button', hidden: true, onclick: async () => {
      if (!confirm('Disconnect the book manager? Its buttons leave the dashboard.')) return;
      try { await call('DELETE', 'api/admin/arr'); msg.textContent = 'Disconnected.'; on = false; status = null; load(); rh.redraw(); } catch (e) { msg.textContent = e.message; }
    } }, 'Disconnect');
    const save = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save and test');
    const form = h('form', { class: 'ad-form', onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true; msg.textContent = 'Checking…';
      try {
        const r = await call('PUT', 'api/admin/arr', { url: url.value.trim(), api_key: key.value.trim() });
        msg.textContent = `Connected to ${r.app || 'your book manager'}${r.version ? ` ${r.version}` : ''}.`;
        key.value = ''; on = true; refresh(); load();
      } catch (err) { msg.textContent = err.message; }
      save.disabled = false;
    } }, h('label', { for: 'arr-url' }, 'URL'), url, h('label', { for: 'arr-key' }, 'API key'), key,
      h('p', { class: 'up-note' }, 'In the book manager: Settings → General → Security → API Key. It is kept in settings.json on this server and is never sent to anyone but the admin’s own requests to it.'),
      h('div', { class: 'ad-actions' }, save, drop), msg);
    const recent = h('div', {});
    async function load() {
      let s; try { s = await call('GET', 'api/admin/arr'); } catch (e) { msg.textContent = e.message; return; }
      url.value = s.url || ''; key.placeholder = s.has_key ? 'Saved (leave blank to keep it)' : ''; drop.hidden = !s.configured;
      if (!s.configured) { recent.replaceChildren(h('p', { class: 'note' }, 'Not connected.')); return; }
      if (!status && !loading) await refresh(); else if (loading) await loading;
      const list = (status?.requests || []).slice(-10).reverse();
      recent.replaceChildren(list.length ? h('ul', { class: 'ad-list' }, list.map((r) => h('li', {},
        h('span', { class: 'ad-name' }, r.kind === 'author' ? `Everything by ${r.author}` : r.title ? `${r.title} · ${r.author}` : `#${r.series_no} of ${r.series} · ${r.author}`),
        h('span', { class: 'ad-meta' }, `${r.outcome} · ${a.when(r.time)}`))))
        : h('p', { class: 'note' }, 'No requests yet. Use the buttons on series, book and author pages.'));
    }
    box.append(
      a.block('Your book manager', 'Connect a Readarr-compatible book manager in your *arr stack (Readarr’s successors such as Bookshelf keep its API). You can then ask it for the next book in a series or the rest of an author from their pages, and see which books it has. Only you, the admin, see any of this. ' + ABOUT, form),
      a.block('Recent requests', 'Also in Sync & logs, under Requests.', recent));
    load();
  } });
})();
