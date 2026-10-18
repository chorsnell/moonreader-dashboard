// Daily highlight review (BOO-83): a few old highlights each day on the Overview. The owner
// answers keep / less often / never and the server spaces them out (src/review); visitors see
// today's list read-only, and nothing when highlights are hidden. On the static demo there's
// no server, so the page picks a few itself.
(() => {
  const { el, ref, byline, cover, fDay, pDate } = rh;
  let got = null, loading = null, admin = false, server = true;
  const notes = {}; // key → what an answer said, until the next load

  window.addEventListener('dash:config', (e) => {
    const c = e.detail || {};
    admin = c.role === 'admin' && !c.preview;
    server = !c.demo; // the static demo has no API
    got = null;
  });

  // the static demo: a few highlights at least a month old, the same all day
  const hash = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.codePointAt(0), 16777619); return x >>> 0; };
  function localPick() {
    const hl = rh.D('highlights'), bk = rh.D('books');
    if (hl.status !== 'ok' || bk.status !== 'ok') return null;
    const byId = new Map(bk.data.map((b) => [b.id, b]));
    const d = new Date(), date = rh.iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
    const cut = rh.iso(new Date(Date.parse(date) - 30 * 864e5));
    const seen = new Set();
    const items = hl.data.filter((h) => h.kind !== 'bookmark' && byId.has(h.book_id) && (!h.date || h.date <= cut))
      .map((h) => { const b = byId.get(h.book_id); return { ...h, key: String(h.id), title: b.title, author: b.author, genre: b.genre }; })
      .sort((a, b) => hash(date + a.key) - hash(date + b.key))
      .filter((h) => (seen.has(h.book_id) ? false : seen.add(h.book_id)))
      .slice(0, 3);
    return { date, items, can_review: false, local: true };
  }

  function load() {
    if (loading) return loading;
    if (!server) { got = localPick(); if (got) rh.redraw(); return null; }
    loading = fetch('api/review/today', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .catch(() => localPick())
      .then((r) => { got = r; })
      .finally(() => { loading = null; rh.redraw(); });
    return loading;
  }

  async function act(item, action, li) {
    li.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const r = await fetch('api/admin/review/' + item.key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      notes[item.key] = action === 'never' ? 'You won’t see this one again.' : `Next ${j.next.when}.`;
      item.card = j.card;
    } catch (e) { notes[item.key] = e.message; }
    rh.redraw();
  }

  function itemEl(item, canReview) {
    const li = el('li', 'hr-item');
    if (item.text) li.append(el('blockquote', 'hl-text', item.text));
    if (item.note) li.append(el('p', 'hl-note', item.note));
    const src = el('div', 'hr-src');
    src.append(rh.linkBook(cover(item.book_id, item.title, item.genre, 'hr-cv'), item.book_id));
    const t = el('div', 'hr-srct');
    t.append(ref(item, 'title'), byline('div', 'hr-by', item, ['author'], item.date ? `Highlighted ${fDay(pDate(item.date))}` : null));
    src.append(t);
    li.append(src);
    if (canReview) {
      const bar = el('div', 'hr-acts');
      if (notes[item.key]) bar.append(el('span', 'hr-said', notes[item.key]));
      else {
        for (const [action, label, title] of [['keep', 'Keep', 'Show it again in a while'], ['less', 'Less often', 'Show it much later'], ['never', 'Never', 'Don’t show it again']]) {
          const b = el('button', 'rng-sel hr-btn', label);
          b.type = 'button'; b.title = title; b.setAttribute('aria-label', `${label}: ${title}`);
          b.addEventListener('click', () => act(item, action, li));
          bar.append(b);
        }
      }
      li.append(bar);
    }
    return li;
  }

  rh.card({
    tab: 'overview', id: 'hl-review', title: 'Today’s highlights', calc: 'highlights', privacy: 'highlights',
    after: 'card-quote',
    hidden: () => !!got && !got.items.length,
    draw(box, rows, parts) {
      if (!got) { load(); return; }
      const canReview = admin && got.can_review && !got.local;
      parts.note.hidden = false;
      parts.note.textContent = canReview
        ? 'A few older highlights to read again. Keep brings one back in a while, Less often much later, Never not at all.'
        : 'A few older highlights, picked again each day.';
      const list = el('ul', 'hr-list');
      list.append(...got.items.map((i) => itemEl(i, canReview)));
      box.replaceChildren(list);
    },
  });

  // ---------- Admin → Daily review ----------
  rh.adminSection({ id: 'review', title: 'Daily review', order: 18, draw(box, a) {
    const { h } = a;
    const perDay = h('input', { type: 'number', id: 'rv-per-day', min: '1', max: '20', step: '1' });
    const notify = h('input', { type: 'checkbox', id: 'rv-notify' });
    const hour = h('select', { id: 'rv-hour' }, Array.from({ length: 24 }, (_, i) => h('option', { value: String(i) }, `${String(i).padStart(2, '0')}:00`)));
    const state = h('p', { class: 'up-note' });
    const msg = a.msg();
    const save = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save');
    const form = h('form', { class: 'ad-form', onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await a.put('api/admin/review/settings', { per_day: Number(perDay.value), notify: notify.checked, hour: Number(hour.value) });
        msg.textContent = 'Saved.'; got = null;
      } catch (err) { msg.textContent = err.message; }
      save.disabled = false;
      load2();
    } }, h('label', { for: 'rv-per-day' }, 'Highlights a day'), perDay,
      h('label', { class: 'pv-check', for: 'rv-notify' }, notify, ' Send them to me each morning'),
      h('label', { for: 'rv-hour' }, 'From'), hour, state, h('div', { class: 'ad-actions' }, save), msg);
    const counts = h('p', { class: 'note' }, 'Loading…');
    async function load2() {
      try {
        const [s, t] = await Promise.all([a.get('api/admin/review/settings'), a.get('api/review/today')]);
        perDay.value = s.per_day; notify.checked = s.notify; hour.value = String(s.hour);
        state.textContent = s.notifier
          ? 'Sent through your notification channels (Admin → Notifications, “Daily highlights”).'
          : 'Set up a channel in Admin → Notifications (and leave “Daily highlights” on) for the morning send.';
        counts.textContent = `${t.highlights} highlights and notes to review: ${t.due} due, ${t.reviewed} answered, ${t.never} set to never.`;
      } catch (e) { counts.textContent = e.message; }
    }
    box.append(
      a.block('Today’s highlights', 'A few highlights at least a month old come back on the Overview each day. Keep brings one back after a week, then twice as long each time; Less often after a month, then four times as long; Never retires it. Visitors who may see highlights get today’s list without the buttons.', counts),
      a.block('Settings', 'How many a day, and whether to get them as a notification each morning.', form),
      a.block('Anki', 'Every highlight (except those set to never) as a text file Anki imports: File → Import, with the passage on the front and your note and the book on the back.',
        h('div', { class: 'ad-actions' }, h('a', { class: 'up-primary ad-auto ad-download', href: 'api/admin/review/anki.txt', download: 'highlights-anki.txt' }, 'Download for Anki'))),
    );
    load2();
  } });
})();
