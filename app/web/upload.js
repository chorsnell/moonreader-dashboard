// Self-hosted extras: signing in (as the admin, or with the read password when the
// dashboard is private), the admin's "Update data" dialog (upload a Moon+ backup, see the
// WebDAV address, choose who can see the dashboard), and a first-run screen when there's no data yet.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (n.className = v) : k.startsWith('on') ? n.addEventListener(k.slice(2), v) : n.setAttribute(k, v)));
    kids.flat().forEach((k) => n.append(k instanceof Node ? k : document.createTextNode(k)));
    return n;
  };
  try { localStorage.removeItem('moonreader-dashboard:token'); } catch (e) { /* the old way of remembering the token */ }
  let config = null, dialog = null, signInDialog = null, wired = false;

  function davUrl() { return new URL('dav/', document.baseURI).href; }

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    let j = {}; try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  const signOut = () => post('api/logout').finally(() => location.reload());

  // A password box that signs in and reloads; used by the lock screen and the admin sign-in.
  function passwordForm(label, button, idSuffix) {
    const pw = h('input', { type: 'password', id: 'pw-' + idSuffix, autocomplete: 'current-password' });
    const msg = h('p', { class: 'up-msg', role: 'status' });
    const go = h('button', { class: 'up-primary', type: 'submit' }, button);
    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (!pw.value) { msg.textContent = 'Enter the password.'; return; }
      go.disabled = true; msg.textContent = 'Checking…';
      try {
        await post('api/login', { password: pw.value });
        location.reload();
      } catch (err) { go.disabled = false; msg.textContent = err.message; pw.select(); }
    } }, h('label', { for: pw.id }, label), pw, go, msg);
    return { form, pw };
  }

  function buildSignIn() {
    const { form, pw } = passwordForm('Admin password (your UPLOAD_TOKEN)', 'Sign in', 'admin');
    signInDialog = h('dialog', { class: 'up-dialog', 'aria-labelledby': 'si-title' },
      h('div', { class: 'up-head' }, h('h2', { id: 'si-title' }, 'Admin sign-in'),
        h('button', { class: 'up-close', type: 'button', 'aria-label': 'Close', onclick: () => signInDialog.close() }, '×')),
      h('section', {}, h('p', { class: 'up-note' }, 'Sign in to upload backups and choose who can see this dashboard.'), form));
    document.body.append(signInDialog);
    signInDialog.addEventListener('click', (e) => { if (e.target === signInDialog) signInDialog.close(); });
    signInDialog.addEventListener('close', clearHash);
    signInDialog.pw = pw;
  }

  function openSignIn() { if (!signInDialog) buildSignIn(); if (!signInDialog.open) { signInDialog.showModal(); signInDialog.pw.focus(); } }

  function clearHash() { if (location.hash === '#upload') history.replaceState(null, '', location.pathname + location.search); }

  function accessSection() {
    const radio = (value, text) => h('label', { class: 'up-radio' },
      h('input', { type: 'radio', name: 'up-access', value, ...(config.access === value ? { checked: '' } : {}) }), text);
    const pw = h('input', { type: 'password', id: 'up-readpw', autocomplete: 'new-password' });
    const pwRow = h('div', {}, h('label', { for: 'up-readpw' }, 'Read password'), pw,
      h('p', { class: 'up-note up-hint' }, config.access === 'password'
        ? 'Leave blank to keep the current one. Changing it signs out everyone using the old one.'
        : 'Share this with the people you want to see your reading.'));
    const msg = h('p', { class: 'up-msg', role: 'status' });
    const save = h('button', { class: 'up-primary', type: 'submit' }, 'Save');
    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const access = form.querySelector('input[name=up-access]:checked').value;
      save.disabled = true; msg.textContent = 'Saving…';
      try {
        await post('api/access', { access, password: access === 'password' ? pw.value : '' });
        config.access = access; pw.value = '';
        msg.textContent = access === 'public' ? 'Saved. Anyone with the link can see the dashboard.' : 'Saved. Visitors now need the read password.';
      } catch (err) { msg.textContent = err.message; }
      save.disabled = false;
    } },
      radio('public', 'Anyone with the link'),
      radio('password', 'Only people with the read password'),
      pwRow, save, msg);
    const sync = () => { pwRow.hidden = form.querySelector('input[name=up-access]:checked').value !== 'password'; };
    form.addEventListener('change', sync); sync();
    return h('section', {}, h('h3', {}, 'Who can see this dashboard'), form);
  }

  function buildDialog() {
    const file = h('input', { type: 'file', accept: '.mrpro', id: 'up-file' });
    const bar = h('progress', { max: '1', value: '0', hidden: '' });
    const msg = h('p', { class: 'up-msg', role: 'status' });
    const go = h('button', { class: 'up-primary', type: 'button' }, 'Upload');
    const url = h('code', {}, davUrl());
    const copy = h('button', { class: 'up-copy', type: 'button', onclick: () => {
      navigator.clipboard?.writeText(davUrl()).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1500); });
    } }, 'Copy');

    go.addEventListener('click', () => {
      const f = file.files[0];
      if (!f) { msg.textContent = 'Choose a .mrpro backup file first.'; return; }
      const before = config && config.meta ? config.meta.generated : null;
      const x = new XMLHttpRequest();
      x.open('PUT', 'upload?name=' + encodeURIComponent(f.name));
      x.upload.onprogress = (e) => { if (e.lengthComputable) bar.value = e.loaded / e.total; };
      x.onload = () => {
        bar.hidden = true;
        let r = {}; try { r = JSON.parse(x.responseText); } catch (e) { /* not JSON */ }
        if (x.status !== 200) { go.disabled = false; msg.textContent = r.error || `Upload failed (HTTP ${x.status}).`; return; }
        msg.textContent = 'Uploaded. Rebuilding your stats…';
        waitForBuild(before, msg, go);
      };
      x.onerror = () => { go.disabled = false; bar.hidden = true; msg.textContent = 'Upload failed: network error. If you use a reverse proxy, check its upload size limit.'; };
      go.disabled = true; bar.hidden = false; bar.value = 0; msg.textContent = 'Uploading…';
      x.send(f);
    });

    dialog = h('dialog', { class: 'up-dialog', id: 'upload-dialog', 'aria-labelledby': 'up-title' },
      h('div', { class: 'up-head' }, h('h2', { id: 'up-title' }, 'Update your reading data'),
        h('button', { class: 'up-close', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, '×')),
      h('section', {},
        h('h3', {}, 'Upload a backup'),
        h('p', { class: 'up-note' }, 'In Moon+ Reader, go to Options → Backup & Restore → Backup, then choose the .mrpro file here. The stats rebuild in a few seconds.'),
        h('label', { for: 'up-file' }, 'Backup file'), file,
        go, bar, msg),
      h('section', {},
        h('h3', {}, 'Or sync straight from Moon+'),
        h('p', { class: 'up-note' }, 'Moon+ can sync reading positions to a WebDAV server, and this dashboard is one. Use these details in Moon+ (see the README for where):'),
        h('div', { class: 'up-dav' }, url, copy),
        h('p', { class: 'up-note' }, 'Username: anything. Password: your upload token. Synced positions keep progress and "On the go" current between backups; a backup sent to this WebDAV address is picked up like an upload.')),
      accessSection(),
      h('section', { class: 'up-foot' }, h('button', { class: 'up-link', type: 'button', onclick: signOut }, 'Sign out')));
    document.body.append(dialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', clearHash);
  }

  async function waitForBuild(before, msg, go) {
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      let c; try { c = await (await fetch('api/config', { cache: 'no-store' })).json(); } catch (e) { continue; }
      if (c.building) continue;
      if (c.meta && c.meta.generated && c.meta.generated !== before) {
        go.disabled = false;
        msg.textContent = `Done. Data now from ${c.meta.backup_file}.`;
        config = c;
        if (!document.querySelector('.rh-tabs')?.hidden) await window.dash.reload(); else location.reload();
        return;
      }
      if (c.last_error) { go.disabled = false; msg.textContent = `The backup couldn't be read: ${c.last_error}`; return; }
    }
    go.disabled = false;
    msg.textContent = 'Still rebuilding. Reload the page in a minute.';
  }

  function openDialog() { if (!dialog) buildDialog(); if (!dialog.open) dialog.showModal(); }

  // Hide the tabs and pages, and show one card in their place.
  function replacePage(id, ...kids) {
    const tabs = $('.rh-tabs'), take = $('#takeaway');
    if (tabs) tabs.hidden = true;
    document.querySelectorAll('.rh-page').forEach((p) => (p.hidden = true));
    if (take) { take.classList.remove('dash-skeleton'); take.textContent = ''; }
    if ($('#' + id)) return;
    $('.rh-top').after(h('div', { class: 'rh-card wide rh-gate', id }, ...kids));
  }

  function lockScreen() {
    const { form, pw } = passwordForm('Password', 'Open', 'read');
    replacePage('rh-locked', h('h2', {}, 'This reading history is private'),
      h('p', { class: 'note' }, 'Enter the password you were given to see it.'), form);
    pw.focus();
  }

  function firstRun() {
    const admin = config.uploads;
    replacePage('rh-empty', h('h2', {}, 'No reading data yet'),
      h('p', { class: 'note' }, admin ? 'Upload a Moon+ Reader backup (.mrpro) to build your dashboard.'
        : config.admin ? 'Nothing has been uploaded yet. If this is your dashboard, sign in as the admin to upload a backup.'
          : 'Put a Moon+ Reader backup (.mrpro) in the library/inbox folder on the server, or set UPLOAD_TOKEN to upload one from here.'),
      admin ? h('button', { class: 'up-primary', type: 'button', style: 'max-width:14rem', onclick: openDialog }, 'Upload a backup') : '');
  }

  function titleBar() {
    const action = config.role === 'admin'
      ? h('button', { class: 'rh-update', type: 'button', onclick: openDialog }, 'Update data')
      : config.role === 'reader' ? h('button', { class: 'up-link', type: 'button', onclick: signOut }, 'Sign out')
        : config.admin ? h('button', { class: 'up-link', type: 'button', onclick: openSignIn }, 'Admin') : null;
    if (!action) return;
    const head = $('.rh-head'), h1 = $('h1', head);
    const bar = h('div', { class: 'rh-titlebar' });
    h1.replaceWith(bar);
    bar.append(h1, action);
  }

  window.addEventListener('dash:config', (e) => {
    config = e.detail || {};
    if (!wired) {
      wired = true;
      titleBar();
      if (location.hash === '#upload') config.role === 'admin' ? openDialog() : config.admin && openSignIn();
    }
    if (config.can_read === false) lockScreen();
    else if (config.has_data === false) firstRun();
    else { $('#rh-empty')?.remove(); const tabs = $('.rh-tabs'); if (tabs) tabs.hidden = false; }
  });
})();
