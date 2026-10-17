// Self-hosted extras: the "Update data" button and dialog (upload a Moon+ backup,
// or see the WebDAV address for syncing), and a first-run screen when there's no data yet.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (n.className = v) : k.startsWith('on') ? n.addEventListener(k.slice(2), v) : n.setAttribute(k, v)));
    kids.flat().forEach((k) => n.append(k instanceof Node ? k : document.createTextNode(k)));
    return n;
  };
  const TOKEN_KEY = 'moonreader-dashboard:token';
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* private mode */ } };
  let config = null, dialog = null, wired = false;

  function davUrl() { return new URL('dav/', document.baseURI).href; }

  function buildDialog() {
    const file = h('input', { type: 'file', accept: '.mrpro', id: 'up-file' });
    const token = h('input', { type: 'password', id: 'up-token', autocomplete: 'current-password', placeholder: 'Upload token' });
    token.value = getToken();
    const bar = h('progress', { max: '1', value: '0', hidden: '' });
    const msg = h('p', { class: 'up-msg', role: 'status' });
    const go = h('button', { class: 'up-primary', type: 'button' }, 'Upload');
    const url = h('code', {}, davUrl());
    const copy = h('button', { class: 'up-copy', type: 'button', onclick: () => {
      navigator.clipboard?.writeText(davUrl()).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1500); });
    } }, 'Copy');

    go.addEventListener('click', () => {
      const f = file.files[0], t = token.value.trim();
      if (!f) { msg.textContent = 'Choose a .mrpro backup file first.'; return; }
      if (!t) { msg.textContent = 'Enter the upload token.'; return; }
      setToken(t);
      const before = config && config.meta ? config.meta.generated : null;
      const x = new XMLHttpRequest();
      x.open('PUT', 'upload?name=' + encodeURIComponent(f.name));
      x.setRequestHeader('X-Upload-Token', t);
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
        h('label', { for: 'up-token' }, 'Upload token'), token,
        go, bar, msg),
      h('section', {},
        h('h3', {}, 'Or sync straight from Moon+'),
        h('p', { class: 'up-note' }, 'Moon+ can sync reading positions to a WebDAV server, and this dashboard is one. Use these details in Moon+ (see the README for where):'),
        h('div', { class: 'up-dav' }, url, copy),
        h('p', { class: 'up-note' }, 'Username: anything. Password: your upload token. Synced positions keep progress and "On the go" current between backups; a backup sent to this WebDAV address is picked up like an upload.')));
    document.body.append(dialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { if (location.hash === '#upload') history.replaceState(null, '', location.pathname + location.search); });
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

  function firstRun() {
    const tabs = $('.rh-tabs'), take = $('#takeaway');
    if (tabs) tabs.hidden = true;
    document.querySelectorAll('.rh-page').forEach((p) => (p.hidden = true));
    if (take) { take.classList.remove('dash-skeleton'); take.textContent = ''; }
    if ($('#rh-empty')) return;
    const box = h('div', { class: 'rh-card wide', id: 'rh-empty' },
      h('h2', {}, 'No reading data yet'),
      config.uploads
        ? h('p', { class: 'note' }, 'Upload a Moon+ Reader backup (.mrpro) to build your dashboard.')
        : h('p', { class: 'note' }, 'Put a Moon+ Reader backup (.mrpro) in the library/inbox folder on the server, or set UPLOAD_TOKEN to upload one from here.'));
    if (config.uploads) box.append(h('button', { class: 'up-primary', type: 'button', style: 'max-width:14rem', onclick: openDialog }, 'Upload a backup'));
    $('.rh-tabs').after(box);
  }

  window.addEventListener('dash:config', (e) => {
    config = e.detail || {};
    if (config.uploads && !wired) {
      wired = true;
      const head = $('.rh-head'), h1 = $('h1', head);
      const bar = h('div', { class: 'rh-titlebar' });
      h1.replaceWith(bar);
      bar.append(h1, h('button', { class: 'rh-update', type: 'button', onclick: openDialog }, 'Update data'));
      if (location.hash === '#upload') openDialog();
    }
    if (config.has_data === false) firstRun();
    else { $('#rh-empty')?.remove(); const tabs = $('.rh-tabs'); if (tabs) tabs.hidden = false; }
  });
})();
