// Admin → Widgets & devices (EP-12): the year's reading goal, the device token that Home
// Assistant and other small devices use to read api/now, and copyable setup for them.
(() => {
  const URL_ = 'api/admin/outbound';
  const AUDIENCES = [
    ['admin', 'Everything, as you see it'],
    ['public', 'What the public sees'],
    ['reader', 'What read-password visitors see'],
    ['friends', 'What friends see'],
  ];

  rh.adminSection({ id: 'outbound', title: 'Widgets & devices', order: 55, draw(box, a) {
    const { h, block, msg } = a;
    const base = new URL('.', document.baseURI).href;
    const copyBtn = (text) => {
      const b = h('button', { class: 'up-copy', type: 'button', onclick: () => {
        navigator.clipboard?.writeText(text()).then(() => { b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1500); });
      } }, 'Copy');
      return b;
    };

    // ---------- goal ----------
    const goal = h('input', { type: 'number', id: 'ob-goal', min: '1', max: '1000', step: '1', inputmode: 'numeric', placeholder: 'No goal' });
    const goalMsg = msg();
    const goalSave = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save goal');
    const goalForm = h('form', { class: 'ad-form', onsubmit: async (e) => {
      e.preventDefault();
      goalSave.disabled = true; goalMsg.textContent = 'Saving…';
      try {
        const r = await a.put(`${URL_}/goal`, { goal: goal.value.trim() ? Number(goal.value) : null });
        goalMsg.textContent = r.goal ? `Saved: ${r.goal} books this year.` : 'Saved: no goal.';
      } catch (err) { goalMsg.textContent = err.message; }
      goalSave.disabled = false;
    } }, h('label', { for: 'ob-goal' }, 'Books to finish this year'), goal, h('div', { class: 'ad-actions' }, goalSave), goalMsg);

    // ---------- device token ----------
    const tokenInfo = h('p', { class: 'up-note' }, 'Loading…');
    const shown = h('div', { class: 'up-dav', hidden: true });
    const tokenMsg = msg();
    let token = '';
    const make = h('button', { class: 'up-primary ad-auto', type: 'button', onclick: async () => {
      if (st?.device_token && !confirm('Make a new token? Devices using the old one stop working until you give them the new one.')) return;
      make.disabled = true;
      try {
        token = (await a.post(`${URL_}/token`)).token;
        shown.replaceChildren(h('code', {}, token), copyBtn(() => token));
        shown.hidden = false;
        tokenMsg.textContent = 'Copy it now: it is shown only this once.';
        await load(); drawYaml(); drawEink();
      } catch (err) { tokenMsg.textContent = err.message; }
      make.disabled = false;
    } }, 'Make a token');
    const revoke = h('button', { class: 'up-link', type: 'button', hidden: true, onclick: async () => {
      if (!confirm('Revoke the device token? Devices using it stop working.')) return;
      try { await call('DELETE', `${URL_}/token`); token = ''; shown.hidden = true; tokenMsg.textContent = 'Revoked.'; await load(); drawYaml(); drawEink(); }
      catch (err) { tokenMsg.textContent = err.message; }
    } }, 'Revoke');
    const audience = h('select', { id: 'ob-audience', onchange: async () => {
      try { await a.put(`${URL_}/audience`, { audience: audience.value }); tokenMsg.textContent = 'Saved.'; }
      catch (err) { tokenMsg.textContent = err.message; }
    } }, AUDIENCES.map(([v, t]) => h('option', { value: v }, t)));

    // ---------- Home Assistant ----------
    const yaml = h('pre', { class: 'ob-yaml' });
    const nowUrl = `${base}api/now`;
    function drawYaml() {
      yaml.textContent = haYaml(nowUrl, token || 'YOUR_DEVICE_TOKEN');
    }

    // ---------- e-ink ----------
    const preview = h('img', { class: 'ob-eink', alt: 'The e-ink view as it is now', width: '800', height: '480' });
    const einkUrls = h('div', {});
    function drawEink() {
      const q = token ? `?token=${encodeURIComponent(token)}` : '';
      const line = (label, url) => h('div', {}, h('label', {}, label), h('div', { class: 'up-dav' }, h('code', {}, url), copyBtn(() => url)));
      einkUrls.replaceChildren(
        line('Picture (800 × 480, black and white PNG)', `${base}eink.png${q}`),
        line('TRMNL polling URL (send the token as an Authorization header)', `${base}api/trmnl`));
      preview.src = `eink.png?t=${Date.now()}`;
    }

    async function call(method, url) {
      const r = await fetch(url, { method, cache: 'no-store' });
      let j = {}; try { j = await r.json(); } catch (e) { /* not JSON */ }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    }

    let st = null;
    async function load() {
      try { st = await a.get(URL_); } catch (e) { tokenInfo.textContent = e.message; return; }
      goal.value = st.goal || '';
      audience.value = st.device_audience || 'admin';
      revoke.hidden = !st.device_token;
      make.textContent = st.device_token ? 'Make a new token' : 'Make a token';
      tokenInfo.textContent = st.device_token
        ? `A token is set (made ${a.when(st.device_token_created)}). It only opens the device endpoints below, not the dashboard or the admin page.`
        : 'No token yet. Without one, devices see what anyone opening the dashboard would (nothing, when it has a read password).';
    }

    box.append(
      block('Reading goal', 'Books to finish this year (re-reads count). Home Assistant, badges and the e-ink view show how you’re doing against it.', goalForm),
      block('Device token', 'A secret for Home Assistant and other devices. Send it as “Authorization: Bearer …” (or ?token=… where a device can’t set headers).',
        tokenInfo, h('label', { for: 'ob-audience' }, 'What a device with the token sees'), audience,
        h('div', { class: 'ad-actions' }, make, revoke), shown, tokenMsg),
      block('Home Assistant', 'A REST sensor that reads api/now every 5 minutes, with template sensors for the rest. Put it in configuration.yaml (the token is best kept in secrets.yaml). The README has an automation that nudges you at 9pm if you haven’t read.',
        h('div', { class: 'ad-actions' }, copyBtn(() => yaml.textContent)), yaml),
      block('E-ink display', 'An always-on picture for a shelf: the book you’re reading with its cover, your streak, this week, the year and a quote. Point any e-ink frame that shows an image URL at the picture, or add a TRMNL private plugin that polls the JSON (the README has the steps and markup). Below: what it shows now, as you see it.',
        einkUrls, preview));
    drawYaml();
    drawEink();
    load();
  } });

  function haYaml(url, token) {
    return `rest:
  - resource: ${url}
    headers:
      Authorization: "Bearer ${token}"
    scan_interval: 300
    sensor:
      - name: "Reading now"
        unique_id: reading_now
        value_template: "{{ value_json.reading[0].title if value_json.reading else 'Nothing' }}"
        json_attributes_path: "$.reading[0]"
        json_attributes: [author, progress, cover, last_read]
      - name: "Reading progress"
        unique_id: reading_progress
        unit_of_measurement: "%"
        value_template: "{{ value_json.reading[0].progress if value_json.reading else none }}"
      - name: "Reading today"
        unique_id: reading_today
        unit_of_measurement: "min"
        value_template: "{{ value_json.today_minutes }}"
      - name: "Reading this week"
        unique_id: reading_week
        unit_of_measurement: "min"
        value_template: "{{ value_json.week_minutes }}"
      - name: "Reading streak"
        unique_id: reading_streak
        unit_of_measurement: "days"
        value_template: "{{ value_json.streak.current if value_json.streak else none }}"
      - name: "Books this year"
        unique_id: reading_books_year
        value_template: "{{ value_json.year.finished }}"
        json_attributes_path: "$.year"
        json_attributes: [goal, percent, expected, ahead]
    binary_sensor:
      - name: "Reading streak at risk"
        unique_id: reading_streak_at_risk
        value_template: "{{ value_json.streak.at_risk if value_json.streak else false }}"`;
  }
})();
