// The admin's "TV & film" section: upload a Netflix export and pick your profiles, connect
// Plex through Tautulli (test, save, sync now), the optional TMDB key, and the media build's status.
(() => {
  const URL_ = 'api/admin/media';

  rh.adminSection({ id: 'media', title: 'TV & film', order: 25, draw(box, a) {
    const { h, block, msg, when, ago } = a;
    let st = null;

    // waits for the media build a change started, then reloads the dashboard's data
    async function waitForMedia(before, say) {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        let s; try { s = await a.get(URL_); } catch (e) { continue; }
        if (s.building || s.tautulli.pulling) { say('Building your TV and film stats…'); continue; }
        if (s.last_build !== before.last_build || s.last_error !== before.last_error) {
          say(s.last_error ? `The media build failed: ${s.last_error}` : `Done. ${(s.last_lines || []).slice(-1)[0] || ''}`);
          await window.dash.reload();
          st = s; render();
          return s;
        }
      }
      say('Still building. Reload the page in a minute.');
      return null;
    }

    // ---------- status ----------
    const facts = h('div', { class: 'ad-facts' }, h('p', { class: 'note' }, 'Loading…'));
    const rebuildMsg = msg();
    const rebuild = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Rebuild now');
    rebuild.addEventListener('click', async () => {
      rebuild.disabled = true; rebuildMsg.textContent = 'Starting…';
      try { const before = st; await a.post(`${URL_}/rebuild`); await waitForMedia(before, (t) => (rebuildMsg.textContent = t)); }
      catch (e) { rebuildMsg.textContent = e.message; }
      rebuild.disabled = false;
    });

    // ---------- Netflix ----------
    const file = h('input', { type: 'file', accept: '.csv,.zip', id: 'ad-netflix-file' });
    const bar = h('progress', { max: '1', value: '0', hidden: true });
    const upMsg = msg();
    const go = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Upload');
    const profiles = h('div', {});
    const profMsg = msg();
    go.addEventListener('click', () => {
      const f = file.files[0];
      if (!f) { upMsg.textContent = 'Choose ViewingActivity.csv or the zip from Netflix first.'; return; }
      const before = st;
      const x = new XMLHttpRequest();
      x.open('PUT', 'upload?source=netflix&name=' + encodeURIComponent(f.name));
      x.upload.onprogress = (e) => { if (e.lengthComputable) bar.value = e.loaded / e.total; };
      x.onload = async () => {
        bar.hidden = true; go.disabled = false;
        let r = {}; try { r = JSON.parse(x.responseText); } catch (e) { /* not JSON */ }
        if (x.status !== 200) { upMsg.textContent = r.error || `Upload failed (HTTP ${x.status}).`; return; }
        file.value = '';
        const chosen = (st?.netflix.profiles || []).filter((p) => (r.profiles || []).includes(p));
        if ((r.profiles || []).length > 1 && !chosen.length) {
          upMsg.textContent = `Uploaded. It has ${r.profiles.length} profiles: tick yours below to import it.`;
          st = await a.get(URL_); render();
          return;
        }
        upMsg.textContent = 'Uploaded. Building…';
        await waitForMedia(before, (t) => (upMsg.textContent = t));
      };
      x.onerror = () => { go.disabled = false; bar.hidden = true; upMsg.textContent = 'Upload failed: network error.'; };
      go.disabled = true; bar.hidden = false; bar.value = 0; upMsg.textContent = 'Uploading…';
      x.send(f);
    });

    function drawProfiles() {
      const n = st.netflix;
      if (n.profiles_found.length < 2) {
        profiles.replaceChildren(n.files.length ? h('p', { class: 'up-note' },
          n.profiles_found.length === 1 ? `Profile: ${n.profiles_found[0]} (imported).` : 'A viewing history file: no profiles to choose.') : '');
        return;
      }
      const boxes = n.profiles_found.map((p) => h('label', { class: 'up-radio' },
        h('input', { type: 'checkbox', value: p, checked: n.profiles.includes(p) }), p));
      const save = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save profiles');
      profiles.replaceChildren(h('form', { class: 'ad-form', onsubmit: async (e) => {
        e.preventDefault();
        const pick = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
        save.disabled = true; profMsg.textContent = 'Saving…';
        try { const before = st; await a.post(`${URL_}/netflix`, { profiles: pick }); await waitForMedia(before, (t) => (profMsg.textContent = t)); }
        catch (err) { profMsg.textContent = err.message; }
        save.disabled = false;
      } }, h('p', { class: 'up-note' }, 'Netflix accounts are shared: which profiles are yours?'), ...boxes, h('div', { class: 'ad-actions' }, save), profMsg));
    }

    // ---------- Plex through Tautulli ----------
    const tUrl = h('input', { id: 'ad-tautulli-url', type: 'url', placeholder: 'http://tautulli:8181', autocomplete: 'off' });
    const tKey = h('input', { id: 'ad-tautulli-key', type: 'password', autocomplete: 'off' });
    const tUser = h('select', { id: 'ad-tautulli-user' }, h('option', { value: '' }, 'Everyone'));
    const tMsg = msg();
    const tFacts = h('p', { class: 'up-note' });
    const test = h('button', { class: 'up-copy', type: 'button' }, 'Test');
    const saveT = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save');
    const sync = h('button', { class: 'up-copy', type: 'button' }, 'Sync Plex now');
    const conn = () => ({ url: tUrl.value.trim(), api_key: tKey.value.trim(), user_id: tUser.value });
    test.addEventListener('click', async () => {
      test.disabled = true; tMsg.textContent = 'Testing…';
      try {
        const r = await a.post(`${URL_}/tautulli/test`, conn());
        const keep = tUser.value || st?.tautulli.user_id || '';
        tUser.replaceChildren(h('option', { value: '' }, 'Everyone'), ...r.users.map((u) => h('option', { value: u.user_id, selected: u.user_id === keep }, u.name)));
        tMsg.textContent = `Connected. ${r.users.length} Plex user${r.users.length === 1 ? '' : 's'}: choose yours, then Save.`;
      } catch (e) { tMsg.textContent = e.message; }
      test.disabled = false;
    });
    const tForm = h('form', { class: 'ad-form', onsubmit: async (e) => {
      e.preventDefault();
      saveT.disabled = true; tMsg.textContent = 'Saving…';
      try { const before = st; await a.post(`${URL_}/tautulli`, conn()); tKey.value = ''; tMsg.textContent = 'Saved. Pulling your Plex history…'; await waitForMedia(before, (t) => (tMsg.textContent = t)); }
      catch (err) { tMsg.textContent = err.message; }
      saveT.disabled = false;
    } },
    h('label', { for: tUrl.id }, 'Tautulli address'), tUrl,
    h('label', { for: tKey.id }, 'API key'), tKey,
    h('label', { for: tUser.id }, 'Plex user'), tUser,
    h('div', { class: 'ad-actions' }, saveT, test, sync), tMsg, tFacts);
    sync.addEventListener('click', async () => {
      sync.disabled = true; tMsg.textContent = 'Pulling new plays…';
      try {
        const before = st;
        const r = await a.post(`${URL_}/tautulli/sync`);
        if (r.new_rows) { tMsg.textContent = `${r.new_rows} new play${r.new_rows === 1 ? '' : 's'}. Building…`; await waitForMedia(before, (t) => (tMsg.textContent = t)); }
        else tMsg.textContent = `Nothing new (${r.total} plays so far).`;
      } catch (e) { tMsg.textContent = e.message; }
      sync.disabled = false;
    });

    // ---------- TMDB ----------
    const key = h('input', { id: 'ad-tmdb', type: 'password', autocomplete: 'off' });
    const kMsg = msg();
    const saveK = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save key');
    const kForm = h('form', { class: 'ad-form', onsubmit: async (e) => {
      e.preventDefault();
      saveK.disabled = true; kMsg.textContent = 'Saving…';
      try { const before = st; await a.post(`${URL_}/tmdb`, { api_key: key.value.trim() }); key.value = ''; await waitForMedia(before, (t) => (kMsg.textContent = t)); }
      catch (err) { kMsg.textContent = err.message; }
      saveK.disabled = false;
    } }, h('label', { for: key.id }, 'TMDB API key or read access token'), key, h('div', { class: 'ad-actions' }, saveK), kMsg);

    function render() {
      if (!st) return;
      const fact = (k, v, cls) => h('div', { class: 'ad-fact' + (cls ? ' ' + cls : '') }, h('dt', {}, k), h('dd', {}, v));
      const c = (st.meta && st.meta.counts) || {};
      facts.replaceChildren(h('dl', {},
        fact('Built', st.last_build ? `${when(st.last_build)} (${ago(st.last_build)})` : (st.meta.generated ? when(st.meta.generated) : '—')),
        fact('Seasons and films', c.items != null ? String(c.items) : '—'),
        fact('Sittings', c.sessions != null ? String(c.sessions) : '—'),
        st.building ? fact('Now', 'Building…') : null,
        st.last_error ? fact('Last error', st.last_error, 'ad-bad') : null));
      drawProfiles();
      const t = st.tautulli;
      if (document.activeElement !== tUrl) tUrl.value = t.url || '';
      tKey.placeholder = t.has_key ? 'Saved (leave blank to keep it)' : 'Settings → Web Interface in Tautulli';
      if (t.user_id && !tUser.querySelector(`option[value="${t.user_id}"]`)) tUser.append(h('option', { value: t.user_id, selected: true }, `User ${t.user_id}`));
      sync.disabled = !(t.url && t.has_key);
      tFacts.textContent = (t.from_env ? 'Set with TAUTULLI_URL. ' : '') +
        (t.last_pull ? `Last pulled ${ago(t.last_pull)}; new plays are pulled every ${t.poll_minutes} minutes.` : t.url ? 'Not pulled yet.' : '') +
        (t.last_error ? ` Last error: ${t.last_error}` : '');
      key.placeholder = st.tmdb.configured ? (st.tmdb.from_env ? 'Set with TMDB_API_KEY' : 'Saved (save blank to remove it)') : 'Optional';
    }

    box.append(
      block('TV and film data', 'Your Netflix and Plex history, built beside your books. It rebuilds by itself after an upload or a pull.',
        facts, h('div', { class: 'ad-actions' }, rebuild), rebuildMsg),
      block('Netflix', 'On Netflix, go to Account → Security & privacy → Download your personal information. Upload the zip it sends (or its CONTENT_INTERACTION/ViewingActivity.csv). A profile\'s "Download all" file also works, but has dates only.',
        h('label', { for: file.id }, 'Netflix export'), file, h('div', { class: 'ad-actions' }, go), bar, upMsg, profiles),
      block('Plex (through Tautulli)', 'Tautulli keeps every Plex play with how long you watched. The dashboard reads its API with the key, never your Plex password.', tForm),
      block('Posters and genres (TMDB)', 'Optional: a free key from themoviedb.org adds genres, episode counts and posters to Netflix titles. Everything works without it.', kForm));

    a.get(URL_).then((s) => { st = s; render(); }).catch((e) => facts.replaceChildren(h('p', { class: 'up-msg' }, e.message)));
  } });
})();
