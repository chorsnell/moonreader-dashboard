(() => {
  // Anonymous usage analytics with Mixpanel, only when the server has MIXPANEL_TOKEN set
  // (/api/config then carries `analytics`). It counts which views are opened and which
  // controls are used, never what's in them: no titles, authors, friends or dates leave the
  // page, only tab and page kinds, card ids and control names. Do Not Track is respected.

  // events wait in `queue` until the library loads; it's dropped when analytics is off
  let mp = null, queue = [], last = '';

  function track(event, props) {
    const view = window.rh ? rh.current() : null;
    // Mixpanel would send the whole address, and a link such as #book/<id> names the book
    const p = { ...props, view, $current_url: location.origin + location.pathname + (view ? '#' + view : '') };
    if (mp) mp.track(event, p); else if (queue) queue.push([event, p]);
  }

  function start(cfg, props) {
    const options = {
      api_host: cfg.api_host,
      persistence: 'localStorage',
      ip: false, // no geolocation from the visitor's address
      track_pageview: false, // views are sent below, as the page's own tabs and pages
      autocapture: false,
      record_sessions_percent: 0,
      loaded: (lib) => {
        lib.register(props); // rides on every event, the queued ones too
        mp = lib;
        queue.forEach(([e, p]) => mp.track(e, p));
        queue = null;
      },
    };
    // what Mixpanel's snippet leaves behind: the library starts the instances listed in _i
    // (an array of queued calls, like the snippet's, with nothing queued)
    window.mixpanel = Object.assign([], { __SV: 1.2, people: [], _i: [[cfg.mixpanel_token, options, 'mixpanel']] });
    const s = document.createElement('script');
    s.src = 'vendor/mixpanel.min.js';
    s.async = true;
    s.onerror = () => { queue = null; };
    document.head.append(s);
  }

  window.addEventListener('dash:config', (e) => {
    const cfg = e.detail || {}, a = cfg.analytics;
    if (window.mixpanel) return; // already started (the config comes again after a sign-in)
    if (!a || !a.mixpanel_token) { queue = null; return; }
    start(a, { role: cfg.role || 'visitor', access: cfg.access || null, demo: !!cfg.demo });
  });

  // a tab, a book page or an entity page (author, series, genre, year…) came on screen
  window.addEventListener('rh:view', (e) => {
    const { view, kind } = e.detail || {};
    const key = view + '|' + kind + '|' + location.hash;
    if (key === last) return;
    last = key;
    track('Page View', { view, page_kind: kind || null });
  });

  // what a control is called: its id, tab, name or first class; never its text
  const nameOf = (t) => t.id || t.dataset.tab || t.getAttribute('name') || (t.classList && t.classList[0]) || t.tagName.toLowerCase();
  const cardOf = (t) => { const c = t.closest('.rh-card'); return c ? c.id.replace(/^card-/, '') : null; };

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-link],[data-day],[data-read],button,a,summary,[role="tab"]');
    if (!t) return;
    const base = { card: cardOf(t) };
    if (t.hasAttribute('data-link')) track('Open Link', { ...base, link_kind: t.getAttribute('data-link') });
    else if (t.hasAttribute('data-day')) track('Open Day', base);
    else if (t.hasAttribute('data-read')) track('Pick Read', base);
    else if (t.getAttribute('role') === 'tab') track('Click Tab', { ...base, tab: t.dataset.tab || nameOf(t) });
    else track('Click', { ...base, control: nameOf(t), type: t.tagName.toLowerCase() });
  }, true);

  // settings in cards and pages: which one changed, not to what
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('select,input[type="checkbox"],input[type="radio"],input[type="range"]')) return;
    // form controls' labels are fixed words ("Measure", "Compare with"), unlike some links'
    track('Change Setting', { card: cardOf(t), control: t.getAttribute('aria-label') || nameOf(t), type: t.type || t.tagName.toLowerCase() });
  }, true);
})();
