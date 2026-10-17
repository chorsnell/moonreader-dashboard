// Admin → Notifications (BOO-72): where events go (ntfy, Gotify, Discord, a webhook) and
// which ones. The server keeps the addresses and tokens and never sends them back: a channel
// shows only its type, name and host. Events are found after each rebuild, and every 10
// minutes for "streak at risk".
(() => {
  const TYPES = {
    ntfy: { label: 'ntfy', url: 'Topic address', ph: 'https://ntfy.sh/my-reading-alerts', token: 'Access token (optional)', note: 'The topic’s full address, on ntfy.sh or your own server. Anyone who knows a public topic’s name can read it, so pick a long one or use a token.' },
    gotify: { label: 'Gotify', url: 'Server address', ph: 'https://gotify.example.com', token: 'Application token', note: 'In Gotify: Apps → Create application, then copy its token.' },
    discord: { label: 'Discord', url: 'Webhook URL', ph: 'https://discord.com/api/webhooks/…', token: null, note: 'In Discord: channel settings → Integrations → Webhooks → New webhook → Copy webhook URL.' },
    webhook: { label: 'Webhook', url: 'URL', ph: 'https://example.com/hooks/reading', token: 'Bearer token (optional)', note: 'Gets a JSON POST: {event, title, message, url, tags, priority, data, time}.' },
  };
  const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

  rh.adminSection({ id: 'notify', title: 'Notifications', order: 57, draw(box, a) {
    const { h, block, msg } = a;
    const wrap = h('div', {}, h('p', { class: 'note' }, 'Loading…'));
    box.append(wrap);

    async function load() {
      let s;
      try { s = await a.get('api/admin/notify'); } catch (e) { wrap.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }

      // ---- channels ----
      const listMsg = msg();
      const channels = s.channels.length
        ? h('ul', { class: 'ad-list' }, s.channels.map((c) => {
          const said = h('span', { class: 'ad-meta nt-said' });
          return h('li', {},
            h('span', { class: 'ad-name' }, c.name, h('span', { class: 'ad-meta' }, ` · ${TYPES[c.type]?.label || c.type} · ${c.host}${c.has_token ? ' · with token' : ''}`), said),
            h('span', { class: 'ad-actions' },
              h('button', { class: 'up-link', type: 'button', onclick: async (e) => {
                e.target.disabled = true; said.textContent = ' · sending…';
                try { const r = await a.post(`api/admin/notify/channels/${encodeURIComponent(c.id)}/test`, {}); said.textContent = r.ok ? ' · test sent' : ` · failed: ${r.error}`; }
                catch (err) { said.textContent = ` · ${err.message}`; }
                e.target.disabled = false;
              } }, 'Send test'),
              h('button', { class: 'up-link', type: 'button', onclick: async () => {
                if (!confirm(`Stop sending notifications to ${c.name}?`)) return;
                try {
                  const r = await fetch(`api/admin/notify/channels/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
                  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
                  load();
                } catch (err) { listMsg.textContent = err.message; }
              } }, 'Remove')));
        }))
        : h('p', { class: 'note' }, 'No channels yet: nothing is sent.');

      const type = h('select', { id: 'nt-type' }, Object.entries(TYPES).map(([v, t]) => h('option', { value: v }, t.label)));
      const url = h('input', { type: 'url', id: 'nt-url', autocomplete: 'off' });
      const tokenLabel = h('label', { for: 'nt-token' });
      const token = h('input', { type: 'password', id: 'nt-token', autocomplete: 'off' });
      const name = h('input', { type: 'text', id: 'nt-name', maxlength: '60', placeholder: 'e.g. My phone' });
      const note = h('p', { class: 'up-note' });
      const urlLabel = h('label', { for: 'nt-url' });
      const sync = () => {
        const t = TYPES[type.value];
        urlLabel.textContent = t.url; url.placeholder = t.ph; note.textContent = t.note;
        tokenLabel.textContent = t.token || ''; tokenLabel.hidden = token.hidden = !t.token;
      };
      type.addEventListener('change', sync);
      sync();
      const addMsg = msg();
      const add = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Add');
      const form = h('form', { class: 'ad-form', onsubmit: async (e) => {
        e.preventDefault();
        add.disabled = true; addMsg.textContent = '';
        try {
          await a.post('api/admin/notify/channels', { type: type.value, url: url.value.trim(), token: token.hidden ? '' : token.value.trim(), name: name.value.trim() });
          url.value = token.value = name.value = '';
          load();
        } catch (err) { addMsg.textContent = err.message; }
        add.disabled = false;
      } }, h('label', { for: 'nt-type' }, 'Service'), type, urlLabel, url, tokenLabel, token, note,
      h('label', { for: 'nt-name' }, 'Name (optional)'), name, h('div', { class: 'ad-actions' }, add), addMsg);

      // ---- which events ----
      const evMsg = msg();
      const save = async (body) => { try { await a.put('api/admin/notify', body); evMsg.textContent = 'Saved.'; } catch (e) { evMsg.textContent = e.message; } };
      const toggles = s.kinds.map((k) => h('label', { class: 'up-radio nt-toggle' },
        h('input', { type: 'checkbox', checked: s.events[k.kind] !== false, onchange: (e) => save({ events: { [k.kind]: e.target.checked } }) }),
        h('span', {}, h('span', {}, k.label), k.note ? h('span', { class: 'ad-meta nt-note' }, k.note) : null)));
      const hour = h('select', { id: 'nt-hour', onchange: () => save({ streak_hour: Number(hour.value) }) },
        Array.from({ length: 24 }, (_, i) => h('option', { value: String(i), selected: i === s.streak_hour }, hourLabel(i))));
      const min = h('input', { type: 'number', id: 'nt-min', min: '1', max: '365', step: '1', value: String(s.streak_min), onchange: () => save({ streak_min: Number(min.value) }) });
      const goal = h('input', { type: 'number', id: 'nt-goal', min: '1', max: '10000', step: '1', placeholder: 'No goal', value: s.year_goal ?? '', onchange: () => save({ year_goal: goal.value ? Number(goal.value) : null }) });
      const checkMsg = msg();
      const check = h('button', { class: 'up-link', type: 'button', onclick: async () => {
        checkMsg.textContent = 'Looking…';
        try {
          const r = await a.post('api/admin/notify/check', {});
          checkMsg.textContent = r.sent.length ? `Sent: ${r.sent.map((x) => x.title).join('; ')}.` : 'Nothing new to tell.';
        } catch (e) { checkMsg.textContent = e.message; }
      } }, 'Look for news now');

      wrap.replaceChildren(
        block('Where they go', 'Get a message on your phone or in a chat when something happens. The addresses and tokens stay on this server: they’re never shown again, only where each one goes.', channels, listMsg),
        block('Add a channel', null, form),
        block('What to send', 'Checked after every sync. Nothing old is sent: the first check only takes note of where things stand, and private books are never named.',
          ...toggles,
          h('div', { class: 'nt-grid' },
            h('div', {}, h('label', { for: 'nt-hour' }, 'Streak at risk: from'), hour),
            h('div', {}, h('label', { for: 'nt-min' }, 'for streaks of at least (days)'), min),
            h('div', {}, h('label', { for: 'nt-goal' }, 'Books to finish this year'), goal)),
          evMsg, h('div', { class: 'ad-actions nt-check' }, check), checkMsg));
    }
    load();
  } });
})();
