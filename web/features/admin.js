// The admin page (#admin, #admin/<section>): only for the admin, signed in with the upload
// token. Each section is registered with rh.adminSection({ id, title, order, draw(box, api) }),
// so other features can add their own (see web/features/README.md). Signing in stays a small
// dialog (upload.js). On the static demo there's no admin, so the page never opens.
(() => {
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((k) => k != null && k !== false && n.append(k instanceof Node ? k : document.createTextNode(k)));
    return n;
  };
  // an old bookmark to the upload dialog
  if (/^#upload\b/.test(location.hash)) history.replaceState(history.state, '', '#admin');

  let config = null, shown = null;
  const page = rh.page('admin', draw);
  page.classList.add('ad-page');
  const nav = h('nav', { class: 'ad-nav', 'aria-label': 'Admin sections' });
  const body = h('div', { class: 'ad-body' });
  const out = h('button', { class: 'up-link', type: 'button', hidden: true, onclick: () => window.rhAuth?.signOut() }, 'Sign out');
  page.append(
    h('div', { class: 'ad-head' },
      h('div', {}, h('h2', {}, 'Admin'), h('p', { class: 'note' }, 'Your data, who can see it, and fixing titles, genres and covers.')),
      out),
    nav, body);

  // ---------- what sections draw with ----------
  async function call(method, url, body, type) {
    const opts = { method, cache: 'no-store', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = type || 'application/json';
      opts.body = type ? body : JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    let j = {}; try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const when = (s) => {
    if (!s) return '—';
    const d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d) ? String(s) : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  };
  function ago(s) {
    if (!s) return '';
    const d = new Date(String(s).replace(' ', 'T')), mins = Math.round((Date.now() - d) / 60000);
    if (isNaN(mins)) return '';
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.round(hrs / 24);
    return `${days} days ago`;
  }
  const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  // Waits for the rebuild a change started, then reloads the dashboard's data.
  async function waitForBuild(before, say) {
    const startErr = before.last_error;
    for (let i = 0; i < 150; i++) {
      await sleep(1500);
      let s; try { s = await call('GET', 'api/admin/status'); } catch (e) { continue; }
      if (s.building) { say('Rebuilding your stats…'); continue; }
      if (s.meta && s.meta.generated && s.meta.generated !== (before.meta || {}).generated) {
        say(`Done. Data now from ${s.meta.backup_file}.`);
        await window.dash.reload();
        return s;
      }
      if (s.last_error && s.last_error !== startErr) { say(`The backup couldn't be read: ${s.last_error}`); return s; }
    }
    say('Still rebuilding. Reload the page in a minute.');
    return null;
  }

  const api = {
    h,
    config: () => config,
    get: (url) => call('GET', url),
    post: (url, b) => call('POST', url, b ?? {}),
    put: (url, b, type) => call('PUT', url, b, type),
    // a titled block inside a section
    block: (title, note, ...kids) => h('div', { class: 'ad-block' }, title && h('h3', {}, title), note && h('p', { class: 'up-note' }, note), ...kids),
    msg: () => h('p', { class: 'up-msg', role: 'status' }),
    status: () => call('GET', 'api/admin/status'),
    waitForBuild,
    when, ago, size,
    // draw the open section again
    refresh: () => { shown = null; draw(); },
  };

  // ---------- the page ----------
  const sectionId = () => (location.hash.match(/^#admin\/([\w-]+)/) || [])[1];
  function current() {
    const all = rh.adminSections();
    return all.find((s) => s.id === sectionId()) || all[0];
  }
  function drawNav(active) {
    nav.replaceChildren(...rh.adminSections().map((s) => h('button', {
      type: 'button', class: 'ad-pill', 'aria-current': s.id === active.id ? 'page' : null,
      onclick: () => { if (s.id === active.id) return; history.pushState({ admin: true }, '', '#admin/' + s.id); draw(); },
    }, s.title)));
  }
  function draw() {
    out.hidden = !config || config.role !== 'admin';
    if (!config) { body.replaceChildren(h('p', { class: 'note' }, 'Loading…')); return; }
    if (config.role !== 'admin') {
      shown = null; nav.replaceChildren();
      if (!config.admin) { history.replaceState(null, '', location.pathname + location.search); rh.show('overview'); return; }
      body.replaceChildren(h('div', { class: 'rh-card wide' }, h('p', { class: 'note' }, 'Sign in as the admin to see this page.'),
        h('button', { class: 'up-primary ad-auto', type: 'button', onclick: () => window.rhAuth?.openSignIn() }, 'Sign in')));
      return;
    }
    document.title = 'Admin · Reading history';
    const s = current();
    if (!s) return;
    drawNav(s);
    if (shown === s.id && body.firstChild) return;
    shown = s.id;
    const box = h('div', { class: 'rh-card wide ad-section', id: 'admin-' + s.id, role: 'region', 'aria-label': s.title });
    body.replaceChildren(box);
    try { s.draw(box, api); } catch (e) { console.error(s.id, e); box.append(h('div', { class: 'fail' }, 'Failed to load')); }
  }
  window.addEventListener('dash:config', (e) => { config = e.detail || {}; if (rh.current() === 'admin') draw(); });
  // a section registered after the page was drawn shows up in the menu
  window.addEventListener('rh:admin-section', () => { if (rh.current() === 'admin' && config?.role === 'admin') drawNav(current()); });

  // ---------- Data ----------
  rh.adminSection({ id: 'data', title: 'Data', order: 10, draw(box, a) {
    const info = h('div', { class: 'ad-facts' }, h('p', { class: 'note' }, 'Loading…'));
    const rebuildMsg = a.msg();
    const rebuild = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Rebuild now');
    const kept = h('div', {});
    let last = null;
    async function load() {
      try { last = await a.status(); } catch (e) { info.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }
      const m = last.meta || {};
      const fact = (k, v, cls) => h('div', { class: 'ad-fact' + (cls ? ' ' + cls : '') }, h('dt', {}, k), h('dd', {}, v));
      info.replaceChildren(h('dl', {},
        fact('Backup', m.backup_file || 'None yet'),
        fact('Built', m.generated ? `${when(m.generated)} (${ago(m.generated)})` : '—'),
        fact('Synced positions', m.synced_positions != null ? String(m.synced_positions) : '—'),
        fact('Untagged files', m.untagged != null ? String(m.untagged) : '—'),
        last.building ? fact('Now', 'Rebuilding…') : null,
        last.last_error ? fact('Last error', last.last_error, 'ad-bad') : null));
      rebuild.disabled = !last.backups.some((b) => !b.failed);
      kept.replaceChildren(last.backups.length
        ? h('ul', { class: 'ad-list' }, last.backups.map((b) => h('li', {},
          h('span', { class: 'ad-name' }, b.name),
          h('span', { class: 'ad-meta' }, `${size(b.size)} · ${when(b.modified)}`, b.failed ? h('span', { class: 'ad-tag ad-bad' }, "couldn't be read") : null))))
        : h('p', { class: 'note' }, 'No backups yet.'));
    }
    rebuild.addEventListener('click', async () => {
      rebuild.disabled = true; rebuildMsg.textContent = 'Starting…';
      try {
        const before = last || await a.status();
        await a.post('api/admin/rebuild');
        rebuildMsg.textContent = 'Rebuilding your stats…';
        await waitForBuild(before, (t) => (rebuildMsg.textContent = t));
      } catch (e) { rebuildMsg.textContent = e.message; }
      await load();
    });

    // upload, with a progress bar
    const file = h('input', { type: 'file', accept: '.mrpro', id: 'ad-file' });
    const bar = h('progress', { max: '1', value: '0', hidden: true });
    const msg = a.msg();
    const go = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Upload');
    go.addEventListener('click', async () => {
      const f = file.files[0];
      if (!f) { msg.textContent = 'Choose a .mrpro backup file first.'; return; }
      const before = last || await a.status().catch(() => ({}));
      const x = new XMLHttpRequest();
      x.open('PUT', 'upload?name=' + encodeURIComponent(f.name));
      x.upload.onprogress = (e) => { if (e.lengthComputable) bar.value = e.loaded / e.total; };
      x.onload = async () => {
        bar.hidden = true;
        let r = {}; try { r = JSON.parse(x.responseText); } catch (e) { /* not JSON */ }
        if (x.status !== 200) { go.disabled = false; msg.textContent = r.error || `Upload failed (HTTP ${x.status}).`; return; }
        msg.textContent = 'Uploaded. Rebuilding your stats…';
        await waitForBuild(before, (t) => (msg.textContent = t));
        go.disabled = false; file.value = '';
        await load();
      };
      x.onerror = () => { go.disabled = false; bar.hidden = true; msg.textContent = 'Upload failed: network error. If you use a reverse proxy, check its upload size limit.'; };
      go.disabled = true; bar.hidden = false; bar.value = 0; msg.textContent = 'Uploading…';
      x.send(f);
    });

    const davUrl = new URL('dav/', document.baseURI).href;
    const copy = h('button', { class: 'up-copy', type: 'button', onclick: () => {
      navigator.clipboard?.writeText(davUrl).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1500); });
    } }, 'Copy');

    box.append(
      a.block('Current data', null, info, h('div', { class: 'ad-actions' }, rebuild), rebuildMsg),
      a.block('Upload a backup', 'In Moon+ Reader, go to Options → Backup & Restore → Backup, then choose the .mrpro file here. The stats rebuild in a few seconds.',
        h('label', { for: 'ad-file' }, 'Backup file'), file, h('div', { class: 'ad-actions' }, go), bar, msg),
      a.block('Or sync straight from Moon+', 'Moon+ can sync reading positions to a WebDAV server, and this dashboard is one. Use these details in Moon+ (see the README for where):',
        h('div', { class: 'up-dav' }, h('code', {}, davUrl), copy),
        h('p', { class: 'up-note' }, 'Username: anything. Password: your upload token. Synced positions keep progress and "On the go" current between backups; a backup sent to this WebDAV address is picked up like an upload.')),
      a.block('Kept backups', null, kept));
    load().then(() => {
      if (last) kept.before(h('p', { class: 'up-note' }, `The newest ${last.keep_backups} in inbox/ and in dav/ are kept; older ones are removed after each rebuild.`));
    });
  } });

  // Sync & logs: admin-logs.js

  // ---------- Access & privacy ----------
  rh.adminSection({ id: 'access', title: 'Access & privacy', order: 30, draw(box, a) {
    const cfg = a.config();
    const radio = (value, text) => h('label', { class: 'up-radio' },
      h('input', { type: 'radio', name: 'ad-access', value, checked: cfg.access === value }), text);
    const pw = h('input', { type: 'password', id: 'ad-readpw', autocomplete: 'new-password' });
    const hint = h('p', { class: 'up-note up-hint' });
    const pwRow = h('div', {}, h('label', { for: 'ad-readpw' }, 'Read password'), pw, hint);
    const msg = a.msg();
    const save = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save');
    const form = h('form', { class: 'ad-form', onsubmit: async (e) => {
      e.preventDefault();
      const access = form.querySelector('input[name=ad-access]:checked').value;
      save.disabled = true; msg.textContent = 'Saving…';
      try {
        await a.post('api/access', { access, password: access === 'password' ? pw.value : '' });
        cfg.access = access; pw.value = ''; sync();
        msg.textContent = access === 'public' ? 'Saved. Anyone with the link can see the dashboard.' : 'Saved. Visitors now need the read password.';
      } catch (err) { msg.textContent = err.message; }
      save.disabled = false;
    } },
    radio('public', 'Anyone with the link'),
    radio('password', 'Only people with the read password'),
    pwRow, h('div', { class: 'ad-actions' }, save), msg);
    function sync() {
      pwRow.hidden = form.querySelector('input[name=ad-access]:checked').value !== 'password';
      hint.textContent = cfg.access === 'password'
        ? 'Leave blank to keep the current one. Changing it signs out everyone using the old one.'
        : 'Share this with the people you want to see your reading.';
    }
    form.addEventListener('change', sync); sync();
    box.append(a.block('Who can see this dashboard', null, form), privacyBlock(a));
  } });

  // What visitors may see (enforced on the server, src/privacy): a policy per role, private
  // books and genres, and previewing the dashboard as a visitor.
  function privacyBlock(a) {
    const ROLES = [['public', 'Anyone with the link'], ['reader', 'People with the read password']];
    const PRESET_NAMES = { everything: 'Everything', no_dates: 'Everything but exact dates', taste: 'Taste only' };
    const FLAGS = [
      ['diary', 'Day-by-day reading: the diary, heatmaps and timeline'],
      ['current', "What I'm reading now and when I last read"],
      ['streaks', 'Streaks and quiet spells'],
      ['highlights', 'Highlights and notes'],
      ['money', 'Prices and spending'],
      ['ratings', 'My ratings and shelves (from Goodreads or StoryGraph)'],
    ];
    const wrap = h('div', {}, h('p', { class: 'note' }, 'Loading…'));
    const block = a.block('What visitors can see', "You always see everything. Anything hidden here is taken out of the data on the server, so visitors can't get at it; cards that need it are left out of their page.", wrap);
    let settings = null, presets = {};
    const books = () => (dash.data('books').data || []).slice().sort((x, y) => x.title.localeCompare(y.title));
    const same = (p, q) => Object.keys(q).every((k) => p[k] === q[k]);
    function role(id, title) {
      const p = settings[id];
      const preset = h('select', { 'aria-label': `${title}: preset` },
        Object.entries(PRESET_NAMES).map(([k, t]) => h('option', { value: k }, t)), h('option', { value: 'custom' }, 'Custom'));
      const dates = h('select', { 'aria-label': `${title}: dates` },
        h('option', { value: 'day' }, 'Exact days'), h('option', { value: 'week' }, 'Weeks only'), h('option', { value: 'month' }, 'Months only'));
      const boxes = FLAGS.map(([k, t]) => {
        const c = h('input', { type: 'checkbox', name: k });
        return [k, c, h('label', { class: 'pv-check' }, c, t)];
      });
      function show() {
        dates.value = p.dates;
        boxes.forEach(([k, c]) => (c.checked = p[k]));
        preset.value = Object.keys(PRESET_NAMES).find((k) => presets[k] && same(p, presets[k])) || 'custom';
      }
      preset.addEventListener('change', () => { if (presets[preset.value]) { Object.assign(p, presets[preset.value]); show(); } });
      dates.addEventListener('change', () => { p.dates = dates.value; show(); });
      boxes.forEach(([k, c]) => c.addEventListener('change', () => { p[k] = c.checked; show(); }));
      show();
      return h('fieldset', { class: 'pv-role' }, h('legend', {}, title),
        h('label', {}, 'Preset'), preset, h('label', {}, 'Dates'), dates, h('div', { class: 'pv-checks' }, boxes.map((b) => b[2])));
    }
    function privateBooks() {
      const chips = h('div', { class: 'pv-chips' });
      const search = h('input', { type: 'search', placeholder: 'Add a book…', 'aria-label': 'Add a private book', list: 'pv-books' });
      const list = h('datalist', { id: 'pv-books' }, books().map((b) => h('option', { value: b.title })));
      const draw = () => chips.replaceChildren(...settings.private_books.map((id) => {
        const b = books().find((x) => x.id === id);
        return h('span', { class: 'pv-chip' }, b ? b.title : id,
          h('button', { type: 'button', 'aria-label': 'Remove', onclick: () => { settings.private_books = settings.private_books.filter((x) => x !== id); draw(); } }, '×'));
      }));
      search.addEventListener('change', () => {
        const b = books().find((x) => x.title === search.value);
        if (b && !settings.private_books.includes(b.id)) { settings.private_books.push(b.id); draw(); }
        search.value = '';
      });
      draw();
      return h('div', {}, h('label', {}, 'Private books'), search, list, chips);
    }
    function privateGenres() {
      const genres = [...new Set(books().flatMap((b) => [b.genre]).filter(Boolean))].sort();
      const lower = () => new Set(settings.private_genres.map((g) => g.toLowerCase()));
      const box = h('div', { class: 'pv-chips' });
      const draw = () => box.replaceChildren(...genres.map((g) => h('button', {
        type: 'button', class: 'pv-genre', 'aria-pressed': String(lower().has(g.toLowerCase())),
        onclick: () => {
          settings.private_genres = lower().has(g.toLowerCase()) ? settings.private_genres.filter((x) => x.toLowerCase() !== g.toLowerCase()) : [...settings.private_genres, g];
          draw();
        },
      }, g)));
      draw();
      return h('div', {}, h('label', {}, 'Private genres'), box);
    }
    // the book list comes from the page's own data, which may still be loading
    const booksLoaded = () => new Promise((resolve) => {
      let done = false;
      dash.onData(() => { if (!done && dash.data('books').status !== 'loading') { done = true; resolve(); } });
    });
    async function load() {
      let r;
      await booksLoaded();
      try { r = await a.get('api/admin/privacy'); } catch (e) { wrap.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }
      settings = r.privacy; presets = r.presets;
      const mode = (v, t) => h('label', { class: 'up-radio' }, h('input', { type: 'radio', name: 'pv-mode', value: v, checked: settings.private_mode === v,
        onchange: () => (settings.private_mode = v) }), t);
      const msg = a.msg();
      const save = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Save');
      save.addEventListener('click', async () => {
        save.disabled = true; msg.textContent = 'Saving…';
        try { settings = (await a.put('api/admin/privacy', settings)).privacy; msg.textContent = 'Saved. Visitors see the change on their next visit.'; }
        catch (e) { msg.textContent = e.message; }
        save.disabled = false;
      });
      const preview = (as, t) => h('button', { class: 'up-copy', type: 'button', onclick: async () => {
        try { await a.post('api/admin/preview', { as }); location.href = location.pathname + location.search + '#overview'; location.reload(); }
        catch (e) { msg.textContent = e.message; }
      } }, t);
      wrap.replaceChildren(
        h('div', { class: 'pv-roles' }, ROLES.map(([id, t]) => role(id, t))),
        h('div', { class: 'pv-private' },
          h('h4', {}, 'Private books and genres'),
          h('p', { class: 'up-note' }, 'Only you see these. Choose whether visitors see nothing of them, or see them counted as "A private book" with no title, author or cover.'),
          privateBooks(), privateGenres(),
          mode('hide', 'Leave them out'), mode('anonymise', 'Show them as "A private book"')),
        h('div', { class: 'ad-actions' }, save, preview('public', 'Preview as a public visitor'), preview('reader', 'Preview with the read password')),
        msg);
    }
    load();
    return block;
  }

  // ---------- Catalogue ----------
  rh.adminSection({ id: 'catalogue', title: 'Catalogue', order: 40, draw(box, a) {
    let books = [], filter = 'untagged', query = '', limit = 30, flash = '';
    const search = h('input', { type: 'search', placeholder: 'Search titles, authors, files', 'aria-label': 'Search books' });
    const which = h('select', { 'aria-label': 'Which books' }, h('option', { value: 'untagged' }, 'Untagged'), h('option', { value: 'all' }, 'All books'));
    const count = h('p', { class: 'up-note' });
    const list = h('ul', { class: 'ad-list ad-books' });
    const more = h('button', { class: 'up-link', type: 'button', hidden: true, onclick: () => { limit += 30; render(); } }, 'Show more');
    const lists = h('div', {});
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); limit = 30; render(); });
    which.addEventListener('change', () => { filter = which.value; limit = 30; render(); });
    box.append(h('p', { class: 'up-note' }, 'Books Moon+ knows by file name only show as "Untagged". Give them a title, author, series and genre here; it is saved to catalogue.json and the stats rebuild.'),
      h('div', { class: 'ad-toolbar' }, which, search), count, list, more, lists);

    function datalist(id, values) {
      return h('datalist', { id }, [...new Set(values.filter(Boolean))].sort().map((v) => h('option', { value: v })));
    }
    async function load() {
      count.textContent = 'Loading…';
      try { books = (await a.get('api/admin/catalogue')).books; } catch (e) { count.textContent = e.message; return; }
      if (!books.some((b) => b.untagged) && filter === 'untagged') { filter = 'all'; which.value = 'all'; }
      lists.replaceChildren(
        datalist('ad-authors', books.map((b) => b.author)), datalist('ad-series', books.map((b) => b.series)),
        datalist('ad-genres', books.map((b) => b.genre).filter((g) => g !== 'Untagged')),
        datalist('ad-subgenres', books.map((b) => b.subgenre).filter((g) => g !== 'Untagged')));
      render();
    }
    function render() {
      const rows = books.filter((b) => (filter === 'all' || b.untagged) &&
        (!query || [b.title, b.author, b.series, ...b.files].some((s) => s && s.toLowerCase().includes(query))));
      const untagged = books.filter((b) => b.untagged).length;
      count.textContent = !books.length ? 'No books yet: upload a backup first.'
        : flash + `${rows.length} book${rows.length === 1 ? '' : 's'} shown · ${untagged} untagged of ${books.length}`;
      flash = '';
      list.replaceChildren(...rows.slice(0, limit).map(row));
      more.hidden = rows.length <= limit;
    }
    function row(b) {
      const item = h('li', { class: 'ad-book' });
      const edit = h('button', { class: 'up-copy', type: 'button', 'aria-expanded': 'false' }, 'Edit');
      item.append(h('div', { class: 'ad-book-head' },
        h('div', { class: 'ad-book-text' },
          h('div', {}, rh.linkBook(h('span', { class: 'ad-name' }, b.title), b.id), b.untagged ? h('span', { class: 'ad-tag' }, 'Untagged') : null),
          rh.byline('div', 'ad-meta', b, ['author', 'series', ...(b.genre === 'Untagged' ? [] : ['genre', 'subgenre'])])),
        edit));
      edit.addEventListener('click', () => {
        const open = item.querySelector('form');
        if (open) { open.remove(); edit.setAttribute('aria-expanded', 'false'); return; }
        edit.setAttribute('aria-expanded', 'true');
        item.append(editor(b));
      });
      return item;
    }
    function editor(b) {
      const id = 'ad-' + b.id;
      const field = (name, label, value, attrs = {}) => h('div', { class: 'ad-field' + (attrs.wide ? ' ad-wide' : '') },
        h('label', { for: `${id}-${name}` }, label),
        h('input', { id: `${id}-${name}`, name, value: value ?? '', ...attrs, wide: null }));
      const msg = a.msg();
      const save = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save');
      const notBook = h('button', { class: 'up-link', type: 'button' }, 'Not a book: hide it');
      const keepGenre = (g) => (g === 'Untagged' ? '' : g);
      const form = h('form', { class: 'ad-edit' },
        field('title', 'Title', b.title, { required: true, wide: true }),
        field('author', 'Author', b.author, { list: 'ad-authors' }),
        field('series', 'Series', b.series, { list: 'ad-series' }),
        field('series_no', 'Number in series', b.series_no, { type: 'number', step: 'any', min: '0', inputmode: 'decimal' }),
        field('genre', 'Genre', keepGenre(b.genre), { list: 'ad-genres' }),
        field('subgenre', 'Subgenre', keepGenre(b.subgenre), { list: 'ad-subgenres' }),
        field('isbn', 'ISBN', b.isbn13, { inputmode: 'numeric', placeholder: 'ISBN-13 or ISBN-10' }),
        h('p', { class: 'up-note ad-wide ad-files' }, `File${b.files.length === 1 ? '' : 's'}: ${b.files.join(', ')}`),
        h('div', { class: 'ad-actions ad-wide' }, save, notBook), msg);
      async function send(body, done) {
        save.disabled = notBook.disabled = true; msg.textContent = 'Saving…';
        try {
          const before = await a.status();
          await a.put('api/admin/catalogue', { files: b.files, ...body });
          msg.textContent = `${done} Rebuilding…`;
          const built = await waitForBuild(before, (t) => (msg.textContent = t));
          flash = built ? `${done.replace('.', '')}: "${b.title}". ` : '';
          await load();
        } catch (e) { msg.textContent = e.message; save.disabled = notBook.disabled = false; }
      }
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(form));
        send({ ...v, series_no: v.series_no === '' ? null : Number(v.series_no) }, 'Saved.');
      });
      notBook.addEventListener('click', () => { if (confirm(`Hide "${b.title}" from the dashboard? It is listed under exclude in catalogue.json.`)) send({ exclude: true }, 'Hidden.'); });
      return form;
    }
    load();
  } });

  // ---------- Covers ----------
  rh.adminSection({ id: 'covers', title: 'Covers', order: 50, draw(box, a) {
    const summary = h('div', {});
    const list = h('ul', { class: 'ad-list ad-books' });
    const msg = a.msg();
    const all = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Look up missing covers again');
    let data = null, limit = 40;
    const more = h('button', { class: 'up-link', type: 'button', hidden: true, onclick: () => { limit = Infinity; load(); } }, 'Show all');
    async function load() {
      try { data = await a.get('api/admin/covers'); } catch (e) { summary.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }
      all.disabled = !data.lookup || !data.missing.length;
      summary.replaceChildren(
        h('p', { class: 'note' }, `${data.with_cover} of ${data.total} books have a cover.` + (data.running ? ' Looking up covers now…' : '')),
        h('p', { class: 'up-note' }, data.lookup
          ? 'Missing covers are looked up on Open Library after each rebuild; books it doesn\'t know are tried again after 30 days. You can also choose an image yourself.'
          : 'Cover lookup is turned off on this server (COVER_LOOKUP=off). You can still choose an image for a book.'));
      list.replaceChildren(...data.missing.slice(0, limit).map(row));
      more.hidden = data.missing.length <= limit;
      if (!data.missing.length && data.total) list.replaceChildren(h('li', { class: 'note' }, 'Every book has a cover.'));
    }
    function row(b) {
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png', hidden: true });
      const status = h('span', { class: 'ad-meta' }, b.missed ? `Not found on Open Library (${when(b.missed).replace(/,.*/, '')})` : 'Not looked up yet');
      const again = h('button', { class: 'up-copy', type: 'button', disabled: !data.lookup }, 'Try again');
      const choose = h('button', { class: 'up-copy', type: 'button' }, 'Choose image');
      again.addEventListener('click', async () => {
        again.disabled = true;
        try { await a.post('api/admin/covers/lookup', { ids: [b.id] }); status.textContent = 'Looking it up…'; setTimeout(load, 4000); }
        catch (e) { status.textContent = e.message; again.disabled = false; }
      });
      choose.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files[0]; if (!f) return;
        status.textContent = 'Saving…';
        try { await a.put('api/admin/covers/' + encodeURIComponent(b.id), f, f.type || 'application/octet-stream'); await window.dash.reload(); await load(); }
        catch (e) { status.textContent = e.message; }
      });
      return h('li', { class: 'ad-book' }, h('div', { class: 'ad-book-head' },
        h('div', { class: 'ad-book-text' }, rh.linkBook(h('span', { class: 'ad-name' }, b.title), b.id), rh.byline('div', 'ad-meta', b, ['author']), status),
        h('div', { class: 'ad-buttons' }, again, choose, file)));
    }
    all.addEventListener('click', async () => {
      all.disabled = true; msg.textContent = 'Starting…';
      try { await a.post('api/admin/covers/lookup', {}); msg.textContent = 'Looking up covers. This takes about a second a book.'; setTimeout(load, 5000); }
      catch (e) { msg.textContent = e.message; all.disabled = false; }
    });
    box.append(summary, h('div', { class: 'ad-actions' }, all), msg, list, more);
    load();
  } });
})();
