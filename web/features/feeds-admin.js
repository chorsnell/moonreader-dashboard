// Admin → Feeds (BOO-74): an Atom feed of finished books and an iCal calendar of reading
// days, finishes and book club check-ins, each at its own secret address. A feed is built
// from what one audience may see (Access & privacy), never from everything. The address is
// shown once, when it's made or given a new one; the server keeps only a hash of it.
(() => {
  const KINDS = [
    ['atom', 'Atom: finished books', 'For a feed reader: each finished book with its cover and rating.'],
    ['ical', 'iCal: reading calendar', 'For a calendar app: reading days, finishes and book club check-ins.'],
  ];
  const AUDIENCES = [
    ['public', 'The public'],
    ['reader', 'People with the read password'],
    ['friends', 'Friends you share with'],
  ];
  const label = (list, v) => (list.find((x) => x[0] === v) || [, v])[1];

  rh.adminSection({ id: 'feeds', title: 'Feeds', order: 55, draw(box, a) {
    const { h, block, msg } = a;
    const out = msg();
    // the address just made, shown until the section is drawn again
    const fresh = h('div', { class: 'fd-fresh', hidden: true });
    const list = h('div', {}, h('p', { class: 'note' }, 'Loading…'));

    function show(r, what) {
      const input = h('input', { type: 'text', readonly: true, value: r.url, 'aria-label': 'Feed address', onfocus: (e) => e.target.select() });
      const copy = h('button', { class: 'up-copy', type: 'button', onclick: () => {
        navigator.clipboard?.writeText(r.url).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1500); });
      } }, 'Copy');
      fresh.replaceChildren(
        h('p', { class: 'fd-say' }, `${what} Copy the address now: it isn't shown again (give the feed a new address if you lose it).`),
        h('div', { class: 'up-dav' }, input, copy));
      fresh.hidden = false;
    }

    async function load() {
      let r;
      try { r = await a.get('api/admin/feeds'); } catch (e) { list.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }
      list.replaceChildren(r.feeds.length
        ? h('ul', { class: 'ad-list' }, r.feeds.map((f) => h('li', {},
          h('span', { class: 'ad-name' }, f.name, h('span', { class: 'ad-meta' },
            ` · ${f.kind === 'atom' ? 'Atom' : 'iCal'} · for ${label(AUDIENCES, f.audience).toLowerCase()} · made ${a.when(f.created)}${f.rotated ? ` · new address ${a.when(f.rotated)}` : ''} · ${f.last_used ? `last fetched ${a.ago(f.last_used)}` : 'not fetched yet'}`)),
          h('span', { class: 'ad-actions' },
            h('button', { class: 'up-link', type: 'button', onclick: async () => {
              if (!confirm(`Give "${f.name}" a new address? Whoever has the old one stops getting it.`)) return;
              try { show(await a.post(`api/admin/feeds/${encodeURIComponent(f.id)}/rotate`, {}), 'New address made.'); load(); } catch (e) { out.textContent = e.message; }
            } }, 'New address'),
            h('button', { class: 'up-link', type: 'button', onclick: async () => {
              if (!confirm(`Revoke "${f.name}"? Its address stops working.`)) return;
              try {
                const res = await fetch(`api/admin/feeds/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
                fresh.hidden = true; out.textContent = 'Revoked.'; load();
              } catch (e) { out.textContent = e.message; }
            } }, 'Revoke')))))
        : h('p', { class: 'note' }, 'No feeds yet.'));
    }

    const kind = h('select', { id: 'fd-kind' }, KINDS.map(([v, t]) => h('option', { value: v }, t)));
    const kindNote = h('p', { class: 'up-note' }, KINDS[0][2]);
    kind.addEventListener('change', () => (kindNote.textContent = (KINDS.find((k) => k[0] === kind.value) || KINDS[0])[2]));
    const audience = h('select', { id: 'fd-audience' }, AUDIENCES.map(([v, t]) => h('option', { value: v }, t)));
    const name = h('input', { type: 'text', id: 'fd-name', maxlength: '60', placeholder: 'e.g. For my blog' });
    const make = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Make the feed');
    const form = h('form', { class: 'ad-form', onsubmit: async (e) => {
      e.preventDefault();
      make.disabled = true; out.textContent = '';
      try {
        show(await a.post('api/admin/feeds', { kind: kind.value, audience: audience.value, name: name.value.trim() }), 'Feed made.');
        name.value = ''; load();
      } catch (err) { out.textContent = err.message; }
      make.disabled = false;
    } },
    h('label', { for: 'fd-kind' }, 'Kind'), kind, kindNote,
    h('label', { for: 'fd-audience' }, 'Built from what this audience may see'), audience,
    h('label', { for: 'fd-name' }, 'Name (to tell them apart)'), name,
    h('div', { class: 'ad-actions' }, make, h('a', { class: 'up-link', href: '#admin/access' }, 'Choose what each audience sees')), out);

    box.append(
      block('New feed', 'Follow your reading from a feed reader or a calendar app. Anyone with a feed’s address can read it, even when the dashboard needs a password, so it only ever holds what the audience you choose may see: private books never appear, dates are rounded as theirs are, and reading days are only in the calendar when that audience sees exact days, the diary and streaks. Book clubs are only in it when that audience may see friends and what you’re reading now.', form, fresh),
      block('Your feeds', 'Give a feed a new address if it got out; the old one stops working at once.', list));
    load();
  } });
})();
