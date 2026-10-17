// Self-hosted extras: signing in (as the admin, or with the read password when the
// dashboard is private), the title-bar button to the admin page (web/features/admin.js),
// and a first-run screen when there's no data yet.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (n.className = v) : k.startsWith('on') ? n.addEventListener(k.slice(2), v) : n.setAttribute(k, v)));
    kids.flat().forEach((k) => n.append(k instanceof Node ? k : document.createTextNode(k)));
    return n;
  };
  try { localStorage.removeItem('moonreader-dashboard:token'); } catch (e) { /* the old way of remembering the token */ }
  let config = null, signInDialog = null, wired = false;

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
      h('section', {}, h('p', { class: 'up-note' }, 'Sign in to upload backups, fix titles and genres, and choose who can see this dashboard.'), form));
    document.body.append(signInDialog);
    signInDialog.addEventListener('click', (e) => { if (e.target === signInDialog) signInDialog.close(); });
    signInDialog.addEventListener('close', clearHash);
    signInDialog.pw = pw;
  }

  function openSignIn() { if (!signInDialog) buildSignIn(); if (!signInDialog.open) { signInDialog.showModal(); signInDialog.pw.focus(); } }

  // closing the sign-in on the admin page goes back to the dashboard
  function clearHash() {
    if (config && config.role === 'admin') return;
    if (/^#(admin|upload)\b/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); window.rh?.show('overview'); }
  }
  const openAdmin = () => { if (location.hash.startsWith('#admin')) window.rh?.show('admin'); else location.hash = 'admin'; };

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
      admin ? h('button', { class: 'up-primary', type: 'button', style: 'max-width:14rem', onclick: () => { $('#rh-empty')?.remove(); openAdmin(); } }, 'Upload a backup') : '');
  }

  function titleBar() {
    const action = config.role === 'admin'
      ? h('button', { class: 'rh-update', type: 'button', onclick: openAdmin }, 'Admin')
      : config.role === 'reader' ? h('button', { class: 'up-link', type: 'button', onclick: signOut }, 'Sign out')
        : config.admin ? h('button', { class: 'up-link', type: 'button', onclick: openSignIn }, 'Admin') : null;
    if (!action) return;
    const head = $('.rh-head'), h1 = $('h1', head);
    const bar = h('div', { class: 'rh-titlebar' });
    h1.replaceWith(bar);
    bar.append(h1, action);
  }

  // for the admin page
  window.rhAuth = { post, signOut, openSignIn, replacePage };

  window.addEventListener('dash:config', (e) => {
    config = e.detail || {};
    if (!wired) {
      wired = true;
      titleBar();
      if (/^#(admin|upload)\b/.test(location.hash) && config.role !== 'admin' && config.admin) openSignIn();
    }
    if (config.can_read === false) lockScreen();
    // the admin with no data yet goes straight to the admin page to upload
    else if (config.has_data === false && !(config.role === 'admin' && location.hash.startsWith('#admin'))) firstRun();
    else { $('#rh-empty')?.remove(); const tabs = $('.rh-tabs'); if (tabs) tabs.hidden = config.has_data === false; }
  });
})();
