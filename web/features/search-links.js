// Search links: the admin's own "look this book up on…" links (src/search-links), on book
// pages, the to-read pile and What to read next. /api/config sends the ones this viewer may
// see: all of them to the admin, the ones marked for visitors to anyone else. Each is a URL
// template; {query} (title and author), {title}, {author} and {isbn} are filled in here.
(() => {
  const { el } = rh;
  let links = [];
  window.addEventListener('dash:config', (e) => {
    const c = e.detail || {};
    const next = Array.isArray(c.search_links) ? c.search_links : [];
    if (JSON.stringify(next) !== JSON.stringify(links)) { links = next; rh.redraw(); }
  });

  // the same rules as fillTemplate in src/search-links/search-links.ts
  function fill(url, b) {
    const title = String(b.title || '').trim();
    const author = String(b.author || '').split(/\s*(?:&|,| and )\s*/)[0].trim();
    const values = { '{query}': [title, author].filter(Boolean).join(' '), '{title}': title, '{author}': author, '{isbn}': String(b.isbn13 || b.isbn || '').trim() };
    return url.replace(/\{(query|title|author|isbn)\}/g, (m) => encodeURIComponent(values[m]));
  }

  // a row of small links for a book, or null when there are none (or it's a private book)
  rh.searchLinks = (b, size) => {
    if (!links.length || !b || !b.title || b.genre === 'Private') return null;
    // an {isbn}-only link needs an ISBN
    const usable = links.filter((l) => /\{(query|title|author)\}/.test(l.url) || b.isbn13 || b.isbn);
    if (!usable.length) return null;
    const box = el('span', 'sl-links' + (size === 'small' ? ' sl-small' : ''));
    box.append(el('span', 'sl-lbl', 'Search'));
    usable.forEach((l) => {
      const a = el('a', 'sl-link', l.name);
      a.href = fill(l.url, b); a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.title = `Search ${l.name} for ${b.title}`;
      // links sit inside rows that open the book page
      a.addEventListener('click', (e) => e.stopPropagation());
      box.append(a);
    });
    return box;
  };

  // ---------- Admin → Search links ----------
  rh.adminSection({ id: 'search-links', title: 'Search links', order: 43, draw(box, a) {
    const { h, block, msg } = a;
    const out = msg(), rowsBox = h('div', { class: 'sl-admin' });
    let rows = [];
    const add = h('button', { class: 'up-link', type: 'button' }, 'Add a link');
    const save = h('button', { class: 'up-primary ad-auto', type: 'button', id: 'search-links-save' }, 'Save');
    box.append(block('Search links', 'Links on book pages, the to-read pile and What to read next that search another site for the book: a library, a bookshop, or anywhere else you look for books. Put {query} (title and author), {title}, {author} or {isbn} in the address where the book goes, for example https://openlibrary.org/search?q={query}. Untick “Visitors too” to keep a link to yourself.',
      rowsBox, h('div', { class: 'ad-actions' }, add, save), out));

    function draw() {
      rowsBox.replaceChildren(...rows.map((r, i) => {
        const name = h('input', { type: 'text', value: r.name, placeholder: 'Name', 'aria-label': `Link ${i + 1} name`, maxlength: '40', class: 'sl-name' });
        const url = h('input', { type: 'url', value: r.url, placeholder: 'https://…{query}', 'aria-label': `Link ${i + 1} address`, maxlength: '500', class: 'sl-url' });
        const vis = h('input', { type: 'checkbox', id: `sl-vis-${i}` });
        vis.checked = !!r.visitors;
        const del = h('button', { class: 'up-link', type: 'button', 'aria-label': `Remove link ${i + 1}` }, 'Remove');
        name.addEventListener('input', () => { r.name = name.value; });
        url.addEventListener('input', () => { r.url = url.value; });
        vis.addEventListener('change', () => { r.visitors = vis.checked; });
        del.addEventListener('click', () => { rows.splice(i, 1); draw(); });
        return h('div', { class: 'sl-row' }, name, url, h('label', { class: 'sl-vis', for: `sl-vis-${i}` }, vis, ' Visitors too'), del);
      }));
      if (!rows.length) rowsBox.append(h('p', { class: 'note' }, 'No search links yet.'));
    }
    add.addEventListener('click', () => { rows.push({ name: '', url: '', visitors: false }); draw(); rowsBox.querySelector('.sl-row:last-child .sl-name')?.focus(); });
    save.addEventListener('click', async () => {
      save.disabled = true; out.textContent = 'Saving…';
      try {
        const keep = rows.filter((r) => r.name.trim() || r.url.trim());
        const r = await fetch('api/admin/search-links', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: keep }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        rows = j.links.map((l) => ({ ...l }));
        links = j.links;
        draw(); rh.redraw();
        out.textContent = rows.length ? 'Saved.' : 'Saved: no search links.';
      } catch (e) { out.textContent = e.message; }
      save.disabled = false;
    });
    (async () => {
      try {
        const r = await a.get('api/admin/search-links');
        rows = r.links.map((l) => ({ ...l }));
      } catch (e) { out.textContent = e.message; }
      draw();
    })();
  } });
})();
