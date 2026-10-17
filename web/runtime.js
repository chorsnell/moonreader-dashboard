// A small stand-in for the Claude dashboard runtime, so the same calcs.js and
// charts.js run on a self-hosted server: loads data/*.json, runs the calculations,
// keeps the page's filters, and redraws when data, filters or the width change.
window.dash = (() => {
  const files = { books: 'data/books.json', reads: 'data/reads.json', daily: 'data/daily.json' };
  // files a feature can do without (dash.file(id, url, {optional: true})): a 404 loads as []
  const optional = new Set();
  const state = {};
  const calcs = [];
  const subs = [];
  const PARAMS_KEY = 'moonreader-dashboard:params';
  let params = {}, covers = {}, server = null;
  try { params = JSON.parse(localStorage.getItem(PARAMS_KEY) || '{}') || {}; } catch (e) { params = {}; }
  const setAll = (status, extra) => Object.keys(files).concat(calcs.map(([id]) => id)).forEach((k) => (state[k] = { status, data: [], ...extra }));
  Object.keys(files).forEach((k) => (state[k] = { status: 'loading', data: [] }));

  const notify = () => subs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  async function load() {
    let config = { has_data: true };
    try { config = await (await fetch('api/config', { cache: 'no-store' })).json(); } catch (e) { /* static hosting: no API */ }
    window.dispatchEvent(new CustomEvent('dash:config', { detail: config }));
    showBuild(config);
    if (config.has_data === false || config.can_read === false) { setAll('missing'); notify(); return config; }
    // only other media so far (say, a Netflix upload): the book files load as empty
    const skip = new Set(config.has_books === false ? ['books', 'reads', 'daily'] : []);
    // likewise the media_*.json files (TV and film) when there are none
    if (config.has_media === false) Object.keys(files).filter((k) => k.startsWith('media_')).forEach((k) => skip.add(k));
    // covers are optional: without them the page shows placeholders
    const coverList = fetch('api/covers', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    // calcs the server has already worked out for this viewer: those aren't run here. Without
    // them (static hosting, an older server, ?stats=client) every calc runs in the page
    const precomputed = stats();
    try {
      const v = '?v=' + Date.now();
      const entries = await Promise.all(Object.entries(files).map(async ([id, url]) => {
        if (skip.has(id)) return [id, []];
        const r = await fetch(url + v);
        if (!r.ok && optional.has(id)) return [id, []];
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return [id, await r.json()];
      }));
      entries.forEach(([id, rows]) => (state[id] = { status: 'ok', data: rows }));
      covers = await coverList;
      server = await precomputed;
    } catch (e) {
      console.error(e);
      setAll('error', { message: String(e) });
      notify();
      return config;
    }
    for (const [id, o] of calcs) {
      if (server && Object.hasOwn(server, id)) { state[id] = { status: 'ok', data: server[id] }; continue; }
      if (o.inputs.some((i) => !state[i] || state[i].status !== 'ok')) { state[id] = { status: 'error', data: [] }; continue; }
      try { state[id] = { status: 'ok', data: o.fn(...o.inputs.map((i) => state[i].data)) }; }
      catch (e) { console.error(id, e); state[id] = { status: 'error', data: [], message: String(e) }; }
    }
    notify();
    const m = config.meta || {};
    const el = document.getElementById('rh-source');
    if (el && config.demo) {
      el.textContent = 'A demo with a made-up reading history of public-domain classics. ';
      const a = document.createElement('a');
      a.href = 'https://github.com/chorsnell/moonreader-dashboard';
      a.textContent = 'Run it on your own Moon+ Reader data';
      el.append(a, '.');
    } else if (el && (m.backup_file || (m.imports && m.imports.length))) {
      // with no Moon+ backup, the data is from the imports (a Kobo, a Kindle…)
      const from = m.backup_file || m.imports.map((i) => i.file).join(', ');
      // without a time when the owner shows visitors rounded dates only
      const when = new Date(m.generated).toLocaleString('en-GB', String(m.generated).includes('T') ? { dateStyle: 'medium', timeStyle: 'short' } : api.dates === 'month' ? { month: 'long', year: 'numeric' } : { dateStyle: 'medium' });
      el.textContent = `Data from ${from}, updated ${when}` + (m.synced_positions ? `, plus ${m.synced_positions} position${m.synced_positions === 1 ? '' : 's'} synced from Moon+.` : '.');
    }
    return config;
  }

  // which build is running, at the foot of the page: "v2.0.0 · a1b2c3d", the hash linking to the commit
  function showBuild({ version, commit }) {
    const el = document.getElementById('rh-build');
    if (!el || (!version && !commit)) return;
    el.replaceChildren();
    if (version) el.append('v' + version);
    if (version && commit) el.append(' · ');
    if (commit) {
      const a = document.createElement('a');
      a.href = 'https://github.com/chorsnell/moonreader-dashboard/commit/' + commit;
      a.textContent = commit;
      el.append(a);
    }
    el.hidden = false;
  }

  async function stats() {
    server = null;
    try {
      if (new URLSearchParams(location.search).get('stats') === 'client') return null;
      const r = await fetch('api/stats/page', { cache: 'no-cache' });
      const body = r.ok ? await r.json() : null;
      return body && body.calcs && typeof body.calcs === 'object' ? body.calcs : null;
    } catch (e) {
      return null;
    }
  }

  let lastW = window.innerWidth, t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (Math.abs(window.innerWidth - lastW) > 4) { lastW = window.innerWidth; notify(); } }, 150);
  });

  const api = {
    // another data file to load; register it before the page loads (from a feature script)
    file: (id, url, o = {}) => { files[id] = url; state[id] = { status: 'loading', data: [] }; if (o.optional) optional.add(id); },
    calc: (id, o) => { calcs.push([id, o]); state[id] = { status: 'loading', data: [] }; },
    // the same calculation over other inputs, e.g. dash.reuse('tv_per_month', 'per_month', ['tv_daily'])
    reuse: (id, from, inputs) => {
      const base = calcs.find(([k]) => k === from);
      if (!base) throw new Error(`dash.reuse: no calc ${from}`);
      api.calc(id, { ...base[1], inputs });
    },
    data: (id) => state[id] || { status: 'missing', data: [] },
    // the data files a calc is worked out from, through any calcs it uses
    needs: (id) => {
      const out = new Set(), seen = new Set();
      const visit = (k) => {
        if (seen.has(k)) return;
        seen.add(k);
        if (files[k]) out.add(k);
        const c = calcs.find(([x]) => x === k);
        if (c) c[1].inputs.forEach(visit);
      };
      visit(id);
      return out;
    },
    // a calc worked out from other data (a friend's): `given` stands in for the page's files,
    // and any calc in between is worked out again from it
    calcWith: (id, given) => {
      const memo = new Map(Object.entries(given));
      const get = (k) => {
        if (memo.has(k)) return memo.get(k);
        const c = calcs.find(([x]) => x === k);
        const v = c ? c[1].fn(...c[1].inputs.map(get)) : files[k] ? [] : undefined;
        memo.set(k, v);
        return v;
      };
      return get(id);
    },
    // ids of the calcs the server worked out for this load (for checks and timing)
    precomputed: () => Object.keys(server || {}),
    onData: (fn) => { subs.push(fn); try { fn(); } catch (e) { console.error(e); } },
    cover: (id) => covers[id] || null,
    params: () => ({ ...params }),
    setParams: (p) => {
      params = { ...params, ...p };
      Object.keys(params).forEach((k) => params[k] == null && delete params[k]);
      try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch (e) { /* private mode */ }
      notify();
    },
    resetParams: () => { params = {}; try { localStorage.removeItem(PARAMS_KEY); } catch (e) { /* ignore */ } notify(); },
    setLink: (name) => history.replaceState(null, '', '#' + name),
    reload: () => load(),
    colors: Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`),
  };
  document.addEventListener('DOMContentLoaded', load);
  return api;
})();
