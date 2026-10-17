// The admin page's Sync & logs section: health at a glance (last sync, a warning when syncing
// seems to have stopped, last rebuild) and the activity log, filtered by type, date and text.
(() => {
  const TYPES = { sync: 'Sync', rebuild: 'Rebuild', upload: 'Upload', import: 'Imports', request: 'Requests', cover: 'Covers', metadata: 'Metadata', prune: 'Old backups', settings: 'Settings', export: 'Exports' };
  const secs = (ms) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`);
  const label = (k) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const show = (v) => (v == null || v === '' ? '—' : Array.isArray(v) ? (v.length ? v.join('\n') : '—') : typeof v === 'object' ? JSON.stringify(v) : String(v));

  rh.adminSection({ id: 'logs', title: 'Sync & logs', order: 20, draw(box, a) {
    const { h } = a;
    let limit = 200, timer = null;
    const health = h('div', { class: 'lg-health' }, h('p', { class: 'note' }, 'Loading…'));
    const type = h('select', { 'aria-label': 'Type' }, h('option', { value: '' }, 'Everything'),
      Object.entries(TYPES).map(([v, t]) => h('option', { value: v }, t)));
    const outcome = h('select', { 'aria-label': 'Outcome' }, h('option', { value: '' }, 'All outcomes'), h('option', { value: 'failed' }, 'Failures only'));
    const from = h('input', { type: 'date', 'aria-label': 'From' });
    const to = h('input', { type: 'date', 'aria-label': 'To' });
    const q = h('input', { type: 'search', placeholder: 'Search the log', 'aria-label': 'Search the log' });
    const count = h('p', { class: 'up-note' });
    const list = h('ul', { class: 'ad-list lg-list' });
    const more = h('button', { class: 'up-link', type: 'button', hidden: true, onclick: () => { limit += 200; load(); } }, 'Show more');
    const reload = () => { limit = 200; load(); };
    [type, outcome, from, to].forEach((x) => x.addEventListener('change', reload));
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(reload, 250); });

    box.append(health,
      a.block('Activity', 'Every sync from Moon+, rebuild, upload, cover lookup and removed backup, newest first. Kept up to about 4 MB.',
        h('div', { class: 'lg-filters' }, type, outcome, from, to, q),
        h('div', { class: 'lg-row' }, count, h('span', { class: 'lg-dl' }, 'Download: ',
          h('a', { href: 'api/admin/logs/download', download: 'activity.jsonl' }, 'activity.jsonl'), ' · ',
          h('a', { href: 'api/admin/logs/download?file=update', download: 'update.log' }, 'update.log'))),
        list, more));

    function tile(title, value, sub, cls) {
      return h('div', { class: 'lg-tile' + (cls ? ' ' + cls : '') }, h('div', { class: 'lg-k' }, title), h('div', { class: 'lg-v' }, value), sub ? h('div', { class: 'lg-sub' }, sub) : null);
    }
    function drawHealth(s) {
      const kids = [];
      kids.push(s.last_sync
        ? tile('Last synced', a.ago(s.last_sync), a.when(s.last_sync) + (s.usual_gap_hours ? ` · usually every ${s.usual_gap_hours < 36 ? s.usual_gap_hours + ' hours' : Math.round(s.usual_gap_hours / 24) + ' days'}` : ''), s.sync_stopped ? 'lg-warn' : '')
        : tile('Last synced', 'Never', 'Set up WebDAV sync in Moon+ (see the Data section).'));
      const r = s.last_rebuild;
      kids.push(r ? tile('Last rebuild', a.ago(r.time), `${r.outcome === 'failed' ? 'Failed' : 'OK'}${r.trigger ? ' · ' + r.trigger : ''}`, r.outcome === 'failed' ? 'lg-bad' : '') : tile('Last rebuild', '—'));
      kids.push(tile('Last upload', s.last_upload ? a.ago(s.last_upload) : '—', s.last_upload ? a.when(s.last_upload) : null));
      const warnings = [];
      if (s.sync_stopped) warnings.push(h('p', { class: 'lg-alert' }, `Syncing seems to have stopped: nothing for ${a.ago(s.last_sync).replace(' ago', '')}. That's normal if you haven't been reading; otherwise check the WebDAV settings in Moon+.`));
      if (s.last_sync_failure) warnings.push(h('p', { class: 'lg-alert lg-alert-bad' }, `The last sync attempt failed ${a.ago(s.last_sync_failure.time)}: ${s.last_sync_failure.error || 'unknown error'}.`));
      health.replaceChildren(h('div', { class: 'lg-tiles' }, kids), ...warnings);
    }
    function entry(e) {
      const extra = Object.entries(e.details || {}).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length));
      const head = h('div', { class: 'lg-head' },
        h('span', { class: 'lg-type lg-' + e.type }, TYPES[e.type] || e.type),
        e.outcome === 'failed' ? h('span', { class: 'ad-tag ad-bad' }, 'failed') : null,
        h('time', { class: 'ad-meta', datetime: e.time }, a.when(e.time)));
      const meta = [e.trigger && `trigger: ${e.trigger}`, e.duration_ms != null && `took ${secs(e.duration_ms)}`].filter(Boolean).join(' · ');
      const body = [h('div', { class: 'lg-msg' }, e.message), meta ? h('div', { class: 'ad-meta' }, meta) : null,
        e.error ? h('div', { class: 'lg-err' }, e.error) : null];
      if (!extra.length) return h('li', { class: 'lg-item' }, head, ...body);
      return h('li', { class: 'lg-item' }, h('details', {}, h('summary', {}, head, ...body),
        h('dl', { class: 'lg-details' }, extra.flatMap(([k, v]) => [h('dt', {}, label(k)), h('dd', {}, show(v))]))));
    }
    async function load() {
      const p = new URLSearchParams({ limit: String(limit) });
      if (type.value) p.set('type', type.value);
      if (outcome.value) p.set('outcome', outcome.value);
      if (from.value) p.set('from', from.value);
      if (to.value) p.set('to', to.value);
      if (q.value.trim()) p.set('q', q.value.trim());
      let r;
      try { r = await a.get('api/admin/logs?' + p); } catch (e) { count.textContent = e.message; return; }
      drawHealth(r.health);
      count.textContent = r.total ? `${r.entries.length < r.total ? `${r.entries.length} of ` : ''}${r.total} entr${r.total === 1 ? 'y' : 'ies'}` : 'Nothing logged that matches.';
      list.replaceChildren(...r.entries.map(entry));
      more.hidden = r.entries.length >= r.total;
    }
    load();
  } });
})();
