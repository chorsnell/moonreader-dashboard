// Reading and the weather (BOO-85): does rain, cold, heat or a short day change how much
// you read or watch? Daily weather at the owner's home comes from Open-Meteo through the
// server (data/weather.json, no location in it); visitors without exact days get none.
(() => {
  const { el, fmt, C } = rh;

  dash.file('weather', 'data/weather.json', { optional: true });

  // the buckets, in the order they're shown
  const FACTORS = [
    { id: 'rain', title: 'Rain', of: (w) => (w.precip_mm == null ? null : w.precip_mm < 1 ? 'dry' : w.precip_mm < 5 ? 'showery' : 'wet'),
      buckets: [['dry', 'Dry (under 1 mm)', 'dry days'], ['showery', 'Showers (1–5 mm)', 'showery days'], ['wet', 'Wet (5 mm or more)', 'wet days']] },
    { id: 'temp', title: 'Temperature', of: (w) => { if (w.t_max == null || w.t_min == null) return null; const t = (w.t_max + w.t_min) / 2; return t < 5 ? 'cold' : t < 12 ? 'cool' : t < 18 ? 'mild' : 'warm'; },
      buckets: [['cold', 'Cold (under 5 °C)', 'cold days'], ['cool', 'Cool (5–12 °C)', 'cool days'], ['mild', 'Mild (12–18 °C)', 'mild days'], ['warm', 'Warm (18 °C or more)', 'warm days']] },
    { id: 'daylight', title: 'Daylight', of: (w) => (w.daylight_h == null ? null : w.daylight_h < 10 ? 'short' : w.daylight_h < 14 ? 'medium' : 'long'),
      buckets: [['short', 'Short days (under 10 h)', 'short winter days'], ['medium', '10–14 hours', 'spring and autumn days (10–14 hours of daylight)'], ['long', 'Long days (14 h or more)', 'long summer days']] },
  ];

  dash.calc('weather_reading', {
    inputs: ['weather', 'daily', 'media_daily'],
    title: 'Reading and the weather',
    description: 'Days with weather, from the first to the last day anything was logged, grouped by rain (dry under 1 mm, showers, wet 5 mm+), daily mean temperature (cold under 5 °C, cool, mild, warm 18 °C+) and daylight hours (under 10, 10–14, 14+). For each group: days, reading minutes a day, share of days read, and TV and film minutes a day.',
    fn: (weather, daily, mediaDaily) => {
      const read = new Map(), watch = new Map();
      daily.forEach((d) => { if (d.minutes > 0) read.set(d.date, (read.get(d.date) || 0) + d.minutes); });
      (Array.isArray(mediaDaily) ? mediaDaily : []).forEach((d) => {
        if ((d.media === 'tv' || d.media === 'film') && d.minutes > 0) watch.set(d.date, (watch.get(d.date) || 0) + d.minutes);
      });
      const dates = [...read.keys(), ...watch.keys()].sort();
      if (!dates.length || !weather.length) return [];
      const first = dates[0], last = dates[dates.length - 1], hasWatch = watch.size > 0;
      const days = weather.filter((w) => w.date >= first && w.date <= last);
      if (!days.length) return [];
      const row = (factor, bucket, ws) => {
        const mins = ws.reduce((a, w) => a + (read.get(w.date) || 0), 0), tv = ws.reduce((a, w) => a + (watch.get(w.date) || 0), 0);
        const r1 = (v) => Math.round(v * 10) / 10;
        return { factor, bucket, days: ws.length, read_per_day: ws.length ? r1(mins / ws.length) : null,
          share_read: ws.length ? Math.round((ws.filter((w) => read.has(w.date)).length / ws.length) * 100) / 100 : null,
          watch_per_day: hasWatch && ws.length ? r1(tv / ws.length) : null };
      };
      const out = [row('all', 'all', days)];
      FACTORS.forEach((f) => f.buckets.forEach(([b]) => out.push(row(f.id, b, days.filter((w) => f.of(w) === b)))));
      return out;
    },
  });

  // what stands out most: the bucket (with 20+ days) furthest from the average, for reading
  function takeaway(rows) {
    const all = rows.find((r) => r.factor === 'all');
    if (!all || !all.read_per_day) return '';
    let best = null;
    rows.filter((r) => r.factor !== 'all' && r.days >= 20 && r.read_per_day != null).forEach((r) => {
      const d = (r.read_per_day - all.read_per_day) / all.read_per_day;
      if (!best || Math.abs(d) > Math.abs(best.d)) best = { r, d };
    });
    if (!best || Math.abs(best.d) < 0.1) return 'The weather makes little difference to how much you read.';
    const f = FACTORS.find((x) => x.id === best.r.factor), phrase = f.buckets.find(([b]) => b === best.r.bucket)[2];
    return `You read ${Math.round(Math.abs(best.d) * 100)}% ${best.d > 0 ? 'more' : 'less'} on ${phrase} than on average.`;
  }

  rh.card({
    tab: 'patterns',
    id: 'weather',
    title: 'Reading and the weather',
    note: 'Minutes a day by the weather at home that day, against your average (the line). Seasons, weekends and holidays mix in, so this shows what goes together, not what causes what.',
    calc: 'weather_reading',
    privacy: ['exact_dates', 'diary'],
    hidden: () => { const d = rh.D('weather_reading'); return d.status !== 'ok' || !d.data.length; },
    draw(box, rows, parts) {
      if (!rows.length) return;
      parts.card.classList.add('wx-card');
      const all = rows.find((r) => r.factor === 'all'), watch = all.watch_per_day != null;
      const max = Math.max(1, ...rows.map((r) => Math.max(r.read_per_day || 0, r.watch_per_day || 0)));
      const legend = el('div', 'legend wx-leg');
      const key = (c, t) => { const s = el('span'); const sw = el('i', 'sw'); sw.style.background = c; s.append(sw, t); return s; };
      legend.append(key(C[0], 'Reading'));
      if (watch) legend.append(key(C[3], 'TV and film'));
      const panels = el('div', 'wx-panels');
      FACTORS.forEach((f) => {
        const p = el('div', 'wx-panel');
        p.append(el('h3', null, f.title));
        f.buckets.forEach(([b, label]) => {
          const r = rows.find((x) => x.factor === f.id && x.bucket === b);
          if (!r || !r.days) return;
          const line = el('div', 'wx-row');
          line.title = `${label}: ${fmt(r.days)} days, read on ${Math.round(r.share_read * 100)}% of them`;
          const name = el('div', 'wx-lbl'); name.append(el('span', null, label), el('small', null, `${fmt(r.days)} days`));
          const bars = el('div', 'wx-bars');
          const bar = (v, avg, c, what) => {
            const track = el('div', 'wx-track'), fill = el('i'), ref = el('b', 'wx-ref');
            fill.style.width = (v / max) * 100 + '%'; fill.style.background = c;
            ref.style.left = (avg / max) * 100 + '%';
            track.append(fill, ref);
            const val = el('span', 'wx-val', `${fmt(Math.round(v))} min`); val.setAttribute('aria-label', `${what}: ${Math.round(v)} minutes a day`);
            const w = el('div', 'wx-bar'); w.append(track, val); return w;
          };
          bars.append(bar(r.read_per_day, all.read_per_day, C[0], 'Reading'));
          if (watch) bars.append(bar(r.watch_per_day || 0, all.watch_per_day, C[3], 'TV and film'));
          line.append(name, bars);
          p.append(line);
        });
        panels.append(p);
      });
      box.replaceChildren(el('p', 'wx-take', takeaway(rows)), legend, panels);
    },
  });

  // ---------- admin: Weather ----------
  if (!rh.adminSection) return;
  rh.adminSection({ id: 'weather', title: 'Weather', order: 48, draw(box, a) {
    const { h } = a;
    const out = a.msg(), status = h('p', { class: 'up-note' });
    const place = h('input', { type: 'text', placeholder: 'Leeds, or 53.80, -1.55', 'aria-label': 'Home location' });
    const save = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Save');
    const fetchNow = h('button', { class: 'up-copy', type: 'button' }, 'Fetch now');
    const reload = () => window.dash.reload && window.dash.reload();
    function show(s) {
      place.placeholder = s.location ? s.location.name : 'Leeds, or 53.80, -1.55';
      fetchNow.hidden = !s.location || !s.enabled;
      status.textContent = !s.enabled ? 'Weather lookups are off (WEATHER_LOOKUP=off).'
        : !s.location ? 'No home location yet.'
        : `${s.location.name} (${s.location.lat.toFixed(2)}, ${s.location.lon.toFixed(2)}): ${fmt(s.days)} days` + (s.first ? `, ${s.first} to ${s.last}` : '') +
          (s.error ? `. Last try failed: ${s.error}` : s.pulled ? `, checked ${a.ago(s.pulled)}.` : '.');
    }
    async function run(p) {
      save.disabled = fetchNow.disabled = true; out.textContent = 'Fetching the weather…';
      try { const r = await p; show(r); out.textContent = r.error ? '' : r.added ? `Added ${fmt(r.added)} days.` : 'Up to date.'; reload(); }
      catch (e) { out.textContent = e.message; }
      save.disabled = fetchNow.disabled = false;
    }
    save.addEventListener('click', () => run(a.put('api/admin/weather/location', { place: place.value })));
    fetchNow.addEventListener('click', () => run(a.post('api/admin/weather/refresh')));
    box.append(a.block('Home location', 'For "Reading and the weather" on Patterns: the daily weather where you live, from Open-Meteo (free, no account). Enter a town or "latitude, longitude"; leave it empty and save to remove it. The location itself is never shown to visitors, and visitors without exact days get no weather.',
      h('div', { class: 'ad-toolbar' }, place, save), h('div', { class: 'ad-actions' }, fetchNow), status, out));
    a.get('api/admin/weather').then(show, (e) => { out.textContent = e.message; });
  } });
})();
