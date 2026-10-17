// What the owner keeps from visitors (BOO-62). The server already leaves the data out
// (see src/privacy); this hides the cards that would otherwise show empty or misleading
// charts, and shows the admin a banner while previewing as a visitor.
//
// A card is hidden when:
// - its chart's calc needs a data file the viewer gets empty (daily with the diary hidden,
//   highlights…), found through dash.needs();
// - it's listed below for a hidden category;
// - or it says so itself: rh.card({ privacy: 'streaks' }) or data-privacy="streaks".
(() => {
  // data files served empty when a category is hidden
  const EMPTY = { diary: ['daily'], highlights: ['highlights'], money: ['prices'] };
  // cards that need exact days, or show a category, by id
  const DAY_PRECISE = ['#tab-diary', '#card-diary', '#card-heat', '#card-week', '#card-bk-days', '#kpi-streak',
    '#card-heat-explorer', '#card-sprint', '#card-hangover', '#card-records', '#card-juggling', '#card-seasons-grid', '#card-clock'];
  const BY_CATEGORY = {
    exact_dates: DAY_PRECISE,
    diary: [...DAY_PRECISE, '#kpi-daily', '#kpi-hours-ytd', '#kpi-speed', '#kpi-avg-wpm', '#kpi-fastest', '#kpi-slowest'],
    streaks: ['#kpi-streak', '#card-records'],
    current: ['#card-current', '#card-stalled', '#card-forecast'],
    highlights: ['#card-bk-highlights', '#card-bk-hl-density', '#card-bk-hl-cloud', '#card-quote', '#card-clock'],
    money: [],
  };
  const OFF = 'rh-privacy-off';
  const NOTE = 'Some details are kept private by the owner.';
  let hidden = [], empty = new Set(), note = false;

  function apply() {
    // runtime.js writes the data line just after the data loads
    if (note) setTimeout(() => { const src = document.getElementById('rh-source'); if (src && !src.textContent.includes(NOTE)) src.append(' ' + NOTE); }, 0);
    if (!hidden.length) return;
    const sel = hidden.flatMap((c) => [...(BY_CATEGORY[c] || []), `[data-privacy~="${c}"]`]).join(',');
    document.querySelectorAll(sel).forEach((n) => n.classList.add(OFF));
    if (empty.size) {
      document.querySelectorAll('.rh-card [data-source]:not([data-field])').forEach((n) => {
        const needs = dash.needs(n.dataset.source);
        if ([...needs].some((f) => empty.has(f))) n.closest('.rh-card')?.classList.add(OFF);
      });
    }
    // an open tab that's now hidden: go to the overview
    const tab = rh.current && rh.current();
    if (tab && document.getElementById('tab-' + tab)?.classList.contains(OFF)) rh.show('overview');
  }

  function banner(as) {
    const who = as === 'reader' ? 'someone with the read password' : as === 'friends' ? 'a friend you share with' : 'a public visitor';
    const stop = document.createElement('button');
    stop.type = 'button'; stop.className = 'up-link'; stop.textContent = 'Stop previewing';
    stop.addEventListener('click', async () => {
      stop.disabled = true;
      await fetch('api/admin/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      location.reload();
    });
    const bar = document.createElement('div');
    bar.className = 'pv-banner'; bar.setAttribute('role', 'status');
    bar.append(`Previewing as ${who}: this is what they see.`, stop);
    document.querySelector('.rh-top')?.prepend(bar);
  }

  window.addEventListener('dash:config', (e) => {
    const c = e.detail || {};
    const p = c.privacy;
    if (c.preview && !document.querySelector('.pv-banner')) banner(c.preview);
    if (!p) return;
    hidden = p.hidden || [];
    dash.dates = p.dates; // charts.js shows rounded dates as a week or month
    empty = new Set(hidden.flatMap((h) => EMPTY[h] || []));
    document.documentElement.dataset.privacyHidden = hidden.join(' ');
    note = hidden.length > 0 || p.private_books;
    apply();
  });
  dash.onData(apply);
  // feature cards are added when their tab is first shown
  let queued = false;
  new MutationObserver(() => {
    if (queued || !hidden.length) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }).observe(document.body, { childList: true, subtree: true });
})();
