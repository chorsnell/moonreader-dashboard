// Admin → Friends (BOO-30): share your reading as a file, add friends' share files, and
// choose who sees your friends here. Federation (following a friend's dashboard) adds its
// own blocks through rh.friendsAdmin.
(() => {
  const VISIBLE = [
    ['admin', 'Only me'],
    ['reader', 'Me and people with the read password'],
    ['public', 'Everyone who can see this dashboard'],
  ];
  // other scripts add blocks to this section: rh.friendsAdmin.push((box, a, state) => node)
  const extra = (rh.friendsAdmin = rh.friendsAdmin || []);

  rh.adminSection({ id: 'friends', title: 'Friends', order: 35, draw(box, a) {
    const { h, block, msg } = a;
    const wrap = h('div', {}, h('p', { class: 'note' }, 'Loading…'));
    box.append(wrap);
    let state = null;

    async function load() {
      try { state = await a.get('api/admin/friends'); } catch (e) { wrap.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }
      const s = state.settings;

      // ---- sharing yours ----
      const name = h('input', { type: 'text', id: 'fr-name', maxlength: '60', placeholder: 'e.g. Sam', value: s.share_name });
      const saveMsg = msg();
      const saveName = h('button', { class: 'up-copy fr-save', type: 'button', onclick: async () => {
        try { await a.put('api/admin/friends/settings', { share_name: name.value }); saveMsg.textContent = 'Saved.'; }
        catch (e) { saveMsg.textContent = e.message; }
      } }, 'Save name');
      const download = h('a', { class: 'up-primary ad-auto', href: 'api/admin/share', download: '' }, 'Download your share file');
      const share = block('Share your reading', 'A share file holds your reading as friends see it: what "Friends you share with" allows under Access & privacy, without your private books. Send it to a friend to add to their dashboard.',
        h('label', { for: 'fr-name' }, 'The name friends see you as'), h('div', { class: 'up-dav' }, name, saveName), saveMsg,
        h('div', { class: 'ad-actions' }, download, h('a', { class: 'up-link', href: '#admin/access' }, 'Choose what friends see')));

      // ---- adding a friend's ----
      const file = h('input', { type: 'file', accept: '.json,application/json', id: 'fr-file' });
      const as = h('input', { type: 'text', id: 'fr-as', maxlength: '60', placeholder: 'The name in the file' });
      const upMsg = msg();
      const up = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Add');
      up.addEventListener('click', async () => {
        const f = file.files[0];
        if (!f) { upMsg.textContent = "Choose a friend's share file first."; return; }
        up.disabled = true; upMsg.textContent = 'Adding…';
        try {
          const r = await a.put('api/admin/friends/upload' + (as.value.trim() ? '?name=' + encodeURIComponent(as.value.trim()) : ''), f, 'application/octet-stream');
          upMsg.textContent = `Added ${r.friend.name}: ${r.friend.books} books.`;
          file.value = ''; as.value = '';
          rh.friends?.reload();
          await load();
        } catch (e) { upMsg.textContent = e.message; }
        up.disabled = false;
      });
      const add = block("Add a friend's reading", 'Choose the share file a friend sent you. Adding a file with the same name again replaces their reading with the newer one.',
        h('label', { for: 'fr-file' }, 'Share file'), file, h('label', { for: 'fr-as' }, 'Their name (optional)'), as,
        h('div', { class: 'ad-actions' }, up), upMsg);

      // ---- the list ----
      const listMsg = msg();
      const list = block('Your friends', null, state.friends.length
        ? h('ul', { class: 'ad-list' }, state.friends.map((f) => h('li', {},
          h('span', { class: 'ad-name' }, f.name, h('span', { class: 'ad-meta' }, ` · ${f.books} books · ${f.source === 'federation' ? 'follows their dashboard' : 'from a share file'}${f.updated ? ' · updated ' + a.when(f.updated) : ''}`)),
          f.source === 'upload' ? h('button', { class: 'up-link', type: 'button', onclick: async () => {
            if (!confirm(`Remove ${f.name}'s reading from your dashboard?`)) return;
            try {
              const r = await fetch('api/admin/friends/' + encodeURIComponent(f.slug), { method: 'DELETE' });
              if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
              rh.friends?.reload();
              await load();
            } catch (e) { listMsg.textContent = e.message; }
          } }, 'Remove') : null)))
        : h('p', { class: 'note' }, 'No friends yet.'), listMsg);

      // ---- who sees them ----
      const visMsg = msg();
      const vis = block('Who sees your friends here', "Friends' reading is theirs, shared with you. Choose who else can see it on this dashboard.",
        ...VISIBLE.map(([v, t]) => h('label', { class: 'up-radio' }, h('input', { type: 'radio', name: 'fr-vis', value: v, checked: s.visible_to === v, onchange: async () => {
          try { await a.put('api/admin/friends/settings', { visible_to: v }); visMsg.textContent = 'Saved.'; } catch (e) { visMsg.textContent = e.message; }
        } }), t)), visMsg);

      wrap.replaceChildren(share, ...extra.map((fn) => { try { return fn(box, a, state, load); } catch (e) { console.error(e); return null; } }).filter(Boolean), add, list, vis);
    }
    load();
  } });
})();
