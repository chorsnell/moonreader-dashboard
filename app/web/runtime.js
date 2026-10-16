// A small stand-in for the Claude dashboard runtime, so the same calcs.js and
// charts.js run on a self-hosted server: loads data/*.json, runs the calculations,
// keeps the page's filters, and redraws when data, filters or the width change.
window.dash = (() => {
  const files = { books: 'data/books.json', reads: 'data/reads.json', daily: 'data/daily.json' };
  const state = {};
  const calcs = [];
  const subs = [];
  const PARAMS_KEY = 'moonreader-dashboard:params';
  let params = {};
  try { params = JSON.parse(localStorage.getItem(PARAMS_KEY) || '{}') || {}; } catch (e) { params = {}; }
  const setAll = (status, extra) => Object.keys(files).concat(calcs.map(([id]) => id)).forEach((k) => (state[k] = { status, data: [], ...extra }));
  Object.keys(files).forEach((k) => (state[k] = { status: 'loading', data: [] }));

  const notify = () => subs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  async function load() {
    let config = { has_data: true };
    try { config = await (await fetch('api/config', { cache: 'no-store' })).json(); } catch (e) { /* static hosting: no API */ }
    window.dispatchEvent(new CustomEvent('dash:config', { detail: config }));
    if (config.has_data === false) { setAll('missing'); notify(); return config; }
    try {
      const v = '?v=' + Date.now();
      const entries = await Promise.all(Object.entries(files).map(async ([id, url]) => {
        const r = await fetch(url + v);
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return [id, await r.json()];
      }));
      entries.forEach(([id, rows]) => (state[id] = { status: 'ok', data: rows }));
    } catch (e) {
      console.error(e);
      setAll('error', { message: String(e) });
      notify();
      return config;
    }
    for (const [id, o] of calcs) {
      if (o.inputs.some((i) => !state[i] || state[i].status !== 'ok')) { state[id] = { status: 'error', data: [] }; continue; }
      try { state[id] = { status: 'ok', data: o.fn(...o.inputs.map((i) => state[i].data)) }; }
      catch (e) { console.error(id, e); state[id] = { status: 'error', data: [], message: String(e) }; }
    }
    notify();
    const m = config.meta || {};
    const el = document.getElementById('rh-source');
    if (el && m.backup_file) {
      const when = new Date(m.generated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      el.textContent = `Data from ${m.backup_file}, updated ${when}` + (m.synced_positions ? `, plus ${m.synced_positions} position${m.synced_positions === 1 ? '' : 's'} synced from Moon+.` : '.');
    }
    return config;
  }

  let lastW = window.innerWidth, t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (Math.abs(window.innerWidth - lastW) > 4) { lastW = window.innerWidth; notify(); } }, 150);
  });

  const api = {
    calc: (id, o) => { calcs.push([id, o]); state[id] = { status: 'loading', data: [] }; },
    data: (id) => state[id] || { status: 'missing', data: [] },
    onData: (fn) => { subs.push(fn); try { fn(); } catch (e) { console.error(e); } },
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
