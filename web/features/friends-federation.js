// Admin → Friends, federation (BOO-59): follow a friend's own dashboard by its address, and
// approve (or stop) the dashboards that follow yours, choosing what each one gets.
(() => {
  const SCOPES = [['everything', 'Everything friends can see'], ['stats', 'Stats only: what you read, no day-by-day'], ['views', 'Let me choose…']];
  const VIEWS = [['reads', 'What I read (taste match, favourites)'], ['daily', 'My days (buddy reads, heatmaps, book clubs)'], ['leaderboards', 'Leaderboards'], ['highlights', 'Highlights']];
  const SHORT = { reads: 'what you read', daily: 'your days', leaderboards: 'leaderboards', highlights: 'highlights' };
  const STATUS = { pending: 'Waiting for them to approve', approved: 'Following', offline: 'Offline: showing what they last shared', revoked: 'They stopped sharing', rejected: 'They turned it down' };
  const blocks = Array.isArray(rh.friendsAdmin) ? rh.friendsAdmin : (rh.friendsAdmin = []);

  async function del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  }

  blocks.push((box, a) => {
    const { h, block, msg } = a;
    const follow = h('div', {}, h('p', { class: 'note' }, 'Loading…'));
    const followers = h('div', {}, h('p', { class: 'note' }, 'Loading…'));
    const books = () => (dash.data('books').data || []).slice().sort((x, y) => x.title.localeCompare(y.title));

    // what a follower gets: a scope, views when choosing, and books kept from them
    function scopeEditor(f, idp) {
      const sel = h('select', { 'aria-label': 'What they get' }, SCOPES.map(([v, t]) => h('option', { value: v }, t)));
      sel.value = f.scope || 'everything';
      const checks = VIEWS.map(([v, t]) => { const c = h('input', { type: 'checkbox', name: v, checked: (f.views || []).includes(v) }); return [v, c, h('label', { class: 'pv-check' }, c, t)]; });
      const viewBox = h('div', { class: 'pv-checks', hidden: sel.value !== 'views' }, checks.map((x) => x[2]));
      sel.addEventListener('change', () => (viewBox.hidden = sel.value !== 'views'));
      let hidden = [...(f.hidden_books || [])];
      const chips = h('div', { class: 'pv-chips' });
      const listId = `fd-books-${idp}`;
      const search = h('input', { type: 'search', placeholder: 'Hide a book from them…', 'aria-label': 'Hide a book', list: listId });
      const drawChips = () => chips.replaceChildren(...hidden.map((id) => h('span', { class: 'pv-chip' }, (books().find((b) => b.id === id) || {}).title || id,
        h('button', { type: 'button', 'aria-label': 'Show again', onclick: () => { hidden = hidden.filter((x) => x !== id); drawChips(); } }, '×'))));
      search.addEventListener('change', () => { const b = books().find((x) => x.title === search.value); if (b && !hidden.includes(b.id)) { hidden.push(b.id); drawChips(); } search.value = ''; });
      drawChips();
      return {
        node: h('div', { class: 'fd-scope' }, sel, viewBox, search, h('datalist', { id: listId }, books().map((b) => h('option', { value: b.title }))), chips),
        value: () => ({ scope: sel.value, views: checks.filter(([, c]) => c.checked).map(([v]) => v), hidden_books: hidden }),
      };
    }

    async function load() {
      let o;
      try { o = await a.get('api/admin/federation'); } catch (e) { follow.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }

      // ---- following ----
      const input = h('input', { type: 'url', id: 'fd-url', placeholder: 'https://their-reading.example.com' });
      const out = msg();
      const go = h('button', { class: 'up-primary ad-auto', type: 'button', onclick: async () => {
        go.disabled = true; out.textContent = 'Asking…';
        try { await a.post('api/admin/federation/following', { url: input.value }); out.textContent = 'Asked. Once they approve, their reading appears under Friends.'; input.value = ''; await load(); }
        catch (e) { out.textContent = e.message; }
        go.disabled = false;
      } }, 'Follow');
      const refreshAll = h('button', { class: 'up-copy', type: 'button', onclick: async () => {
        refreshAll.disabled = true; out.textContent = 'Refreshing…';
        try { await a.post('api/admin/federation/refresh', {}); out.textContent = 'Refreshed.'; rh.friends?.reload(); await load(); }
        catch (e) { out.textContent = e.message; refreshAll.disabled = false; }
      } }, 'Refresh now');
      const list = o.following.length ? h('ul', { class: 'ad-list' }, o.following.map((f) => h('li', {},
        h('span', { class: 'ad-name' }, f.name, h('span', { class: 'ad-meta' }, ` · ${f.url}`),
          h('br'), h('span', { class: 'ad-meta' + (f.status === 'offline' || f.status === 'revoked' ? ' ad-bad' : '') },
            STATUS[f.status] || f.status, f.updated ? ` · updated ${a.when(f.updated)}` : '', f.status === 'offline' && f.last_error ? ` (${f.last_error})` : '')),
        h('button', { class: 'up-link', type: 'button', onclick: async () => {
          if (!confirm(`Stop following ${f.name}? Their reading leaves your dashboard.`)) return;
          try { await del('api/admin/federation/following/' + encodeURIComponent(f.slug)); rh.friends?.reload(); await load(); } catch (e) { out.textContent = e.message; }
        } }, 'Unfollow'))))
        : h('p', { class: 'note' }, 'You don’t follow anyone yet.');
      follow.replaceChildren(
        h('label', { for: 'fd-url' }, 'Their dashboard’s address'), input, h('div', { class: 'ad-actions' }, go, o.following.length ? refreshAll : null), out, list,
        h('p', { class: 'up-note' }, o.refresh_minutes ? `Friends you follow are refreshed every ${o.refresh_minutes} minutes.` : 'Friends you follow are refreshed when you press Refresh now.'));

      // ---- followers ----
      const fout = msg();
      const accept = h('input', { type: 'checkbox', checked: o.accept_follows, onchange: async () => {
        try { await a.put('api/admin/friends/settings', { accept_follows: accept.checked }); fout.textContent = 'Saved.'; } catch (e) { fout.textContent = e.message; }
      } });
      const act = async (fn) => { try { await fn(); await load(); } catch (e) { fout.textContent = e.message; } };
      const rows = o.followers.slice().sort((x, y) => ['pending', 'approved', 'revoked', 'rejected'].indexOf(x.status) - ['pending', 'approved', 'revoked', 'rejected'].indexOf(y.status));
      const flist = rows.length ? h('ul', { class: 'ad-list fd-list' }, rows.map((f, i) => {
        const head = h('span', { class: 'ad-name' }, h('b', {}, f.name), h('span', { class: 'ad-meta' }, ` · ${f.url}`));
        const li = h('li', { class: 'fd-item' }, head);
        if (f.status === 'pending') {
          const ed = scopeEditor(f, i);
          li.append(h('p', { class: 'ad-meta' }, `Asked ${a.when(f.requested)}. Choose what they get:`), ed.node, h('div', { class: 'ad-actions' },
            h('button', { class: 'up-primary ad-auto', type: 'button', onclick: () => act(() => a.post(`api/admin/federation/followers/${f.id}/approve`, ed.value())) }, 'Approve'),
            h('button', { class: 'up-link', type: 'button', onclick: () => act(() => a.post(`api/admin/federation/followers/${f.id}/reject`)) }, 'Turn down')));
        } else if (f.status === 'approved') {
          const what = f.scope === 'everything' ? 'everything friends can see' : f.scope === 'stats' ? 'stats only' : VIEWS.filter(([v]) => f.views.includes(v)).map(([v]) => SHORT[v]).join(', ') || 'only your books';
          const ed = scopeEditor(f, i), edit = h('div', { class: 'fd-edit', hidden: true }, ed.node,
            h('div', { class: 'ad-actions' }, h('button', { class: 'up-copy', type: 'button', onclick: () => act(() => a.put(`api/admin/federation/followers/${f.id}`, ed.value())) }, 'Save')));
          li.append(h('p', { class: 'ad-meta' }, `Gets ${what}${f.hidden_books.length ? `, less ${f.hidden_books.length} hidden book${f.hidden_books.length === 1 ? '' : 's'}` : ''}. ${f.last_pull ? `Last fetched ${a.ago(f.last_pull)}.` : f.collected ? '' : 'Not connected yet.'}`),
            h('div', { class: 'ad-actions' },
              h('button', { class: 'up-copy', type: 'button', onclick: () => (edit.hidden = !edit.hidden) }, 'Change'),
              h('button', { class: 'up-link', type: 'button', onclick: () => { if (confirm(`Stop sharing with ${f.name}? It takes effect at once.`)) act(() => a.post(`api/admin/federation/followers/${f.id}/revoke`)); } }, 'Stop sharing')),
            edit);
        } else {
          li.append(h('p', { class: 'ad-meta' }, f.status === 'revoked' ? 'You stopped sharing with them.' : 'You turned them down.'),
            h('div', { class: 'ad-actions' }, h('button', { class: 'up-link', type: 'button', onclick: () => act(() => del(`api/admin/federation/followers/${f.id}`)) }, 'Forget')));
        }
        return li;
      })) : h('p', { class: 'note' }, 'Nobody follows you yet. Give a friend this dashboard’s address to follow from theirs.');
      followers.replaceChildren(h('label', { class: 'up-radio' }, accept, 'Let other dashboards ask to follow mine'), flist, fout);
    }
    load();
    return h('div', {},
      block('Follow a friend’s dashboard', 'If a friend runs their own reading dashboard, follow it: they approve, choose what you see, and their reading stays up to date here. They can stop sharing at any time.', follow),
      block('Dashboards that follow you', 'Each friend sees only what you approve, within what “Friends you share with” allows under Access & privacy. Stopping sharing takes effect at once.', followers));
  });
})();
