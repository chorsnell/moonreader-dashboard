// Holidays, trips and life events (BOO-86): date ranges marked in admin or read from a
// calendar, shaded on the heatmap, the reading timeline and the diary, with "holiday
// reading vs normal" on Timeline & habits. data/life_events.json is served empty to
// visitors unless the owner ticks "Holidays and life events" for them.
(() => {
  const { el, fmt, fDay, pDate, mins, C } = rh;
  const KINDS = {
    holiday: { label: 'Holiday', many: 'Holidays', c: 1 },
    trip: { label: 'Trip', many: 'Trips', c: 3 },
    job: { label: 'New job', many: 'New jobs', c: 4 },
    baby: { label: 'Baby', many: 'Babies', c: 5 },
    move: { label: 'Moving house', many: 'Moves', c: 2 },
    other: { label: 'Other', many: 'Other', c: 6 },
  };
  const kindColor = (k) => C[(KINDS[k] || KINDS.other).c] || C[0];

  dash.file('life_events', 'data/life_events.json', { optional: true });

  // minutes, reading days and calendar days in [s, e] (within the log), from day_totals
  const DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z');
  const daysIn = (s, e) => Math.round((t(e) - t(s)) / DAY) + 1;

  dash.calc('life_event_reading', {
    inputs: ['life_events', 'day_totals', 'as_of'],
    title: 'Reading during life events',
    description: 'For each holiday, trip or life event that overlaps the reading log: its days in the log, minutes read, days with reading, minutes a day and the share of days read, against the same figures for days outside every event. Events are clipped to the log.',
    fn: (events, day_totals, as_of) => {
      if (!events.length || !day_totals.length) return [];
      const first = day_totals[0].date, last = as_of[0].date;
      const byDate = new Map(day_totals.map((d) => [d.date, d.minutes || 0]));
      const total = (s, e) => {
        let m = 0, read = 0;
        for (const [d, v] of byDate) if (d >= s && d <= e) { m += v; if (v > 0) read++; }
        return { m, read };
      };
      // every day covered by an event, for "normal"
      const covered = new Set();
      const rows = [];
      events.filter((ev) => ev.end >= first && ev.start <= last).forEach((ev) => {
        const s = ev.start < first ? first : ev.start, e = ev.end > last ? last : ev.end;
        for (let x = t(s); x <= t(e); x += DAY) covered.add(new Date(x).toISOString().slice(0, 10));
        const { m, read } = total(s, e), days = daysIn(s, e);
        rows.push({ id: ev.id, title: ev.title, kind: ev.kind, start: ev.start, end: ev.end, days, minutes: Math.round(m),
          reading_days: read, per_day: Math.round(m / days), share_read: Math.round((read / days) * 100) / 100 });
      });
      if (!rows.length) return [];
      let nm = 0, nread = 0;
      for (const [d, v] of byDate) if (!covered.has(d)) { nm += v; if (v > 0) nread++; }
      const ndays = daysIn(first, last) - [...covered].filter((d) => d >= first && d <= last).length;
      rows.push({ id: null, title: 'Normal days', kind: 'normal', start: first, end: last, days: ndays, minutes: Math.round(nm),
        reading_days: nread, per_day: ndays ? Math.round(nm / ndays) : 0, share_read: ndays ? Math.round((nread / ndays) * 100) / 100 : 0 });
      return rows;
    },
  });

  dash.calc('life_event_kinds', {
    inputs: ['life_event_reading'],
    title: 'Reading by kind of life event',
    description: 'Minutes a day and share of days read on holidays, trips, a new job and so on (each kind\'s events together; days in two events of a kind count once per event), against normal days.',
    fn: (rows) => {
      const out = new Map();
      rows.forEach((r) => {
        const o = out.get(r.kind) || { kind: r.kind, events: 0, days: 0, minutes: 0, reading_days: 0 };
        o.events += r.kind === 'normal' ? 0 : 1; o.days += r.days; o.minutes += r.minutes; o.reading_days += r.reading_days;
        out.set(r.kind, o);
      });
      return [...out.values()].map((o) => ({ ...o, per_day: o.days ? Math.round(o.minutes / o.days) : 0, share_read: o.days ? Math.round((o.reading_days / o.days) * 100) / 100 : 0 }))
        .sort((a, b) => (a.kind === 'normal') - (b.kind === 'normal') || b.days - a.days);
    },
  });

  // shading on the heatmap, the reading timeline and the diary
  rh.markDays(() => {
    const r = rh.D('life_events');
    return r.status === 'ok' ? r.data.map((e) => ({ start: e.start, end: e.end, title: e.title, color: kindColor(e.kind) })) : [];
  });

  const pctTxt = (v) => `${Math.round(v * 100)}%`;
  const vs = (v, n) => {
    if (!n) return '';
    const d = (v - n) / n;
    return Math.abs(d) < 0.05 ? 'about the same as normal' : `${Math.round(Math.abs(d) * 100)}% ${d > 0 ? 'more' : 'less'} than normal`;
  };

  rh.card({
    tab: 'timeline',
    id: 'life-events',
    title: 'Holidays and life events',
    note: 'How much you read on holidays, trips and around life events, against normal days. They are shaded on the heatmap, the timeline above and the diary.',
    calc: 'life_event_kinds',
    after: 'card-gantt',
    privacy: 'life_events',
    hidden: () => { const d = rh.D('life_event_kinds'); return d.status !== 'ok' || !d.data.length; },
    draw(box, kinds, parts) {
      parts.card.classList.add('le-card');
      const normal = kinds.find((k) => k.kind === 'normal');
      const max = Math.max(1, ...kinds.map((k) => k.per_day));
      const tiles = el('div', 'le-kinds');
      kinds.forEach((k) => {
        const tile = el('div', 'le-kind' + (k.kind === 'normal' ? ' le-normal' : ''));
        const name = el('div', 'le-name');
        const sw = el('span', 'sw'); sw.style.background = k.kind === 'normal' ? 'var(--cds-chart-muted)' : kindColor(k.kind);
        name.append(sw, k.kind === 'normal' ? 'Normal days' : `${KINDS[k.kind]?.many || k.kind} (${fmt(k.events)})`);
        const val = el('div', 'le-val'); val.append(el('b', null, fmt(k.per_day)), el('small', null, ' min a day'));
        const bar = el('div', 'le-bar'), fill = el('i');
        fill.style.width = (k.per_day / max) * 100 + '%';
        fill.style.background = k.kind === 'normal' ? 'var(--cds-chart-muted)' : kindColor(k.kind);
        bar.append(fill);
        const sub = el('div', 'le-sub', `read on ${pctTxt(k.share_read)} of ${fmt(k.days)} days` + (k.kind !== 'normal' && normal ? ` · ${vs(k.per_day, normal.per_day)}` : ''));
        tile.append(name, val, bar, sub);
        tiles.append(tile);
      });
      // each event, newest first
      const events = (rh.D('life_event_reading').data || []).filter((r) => r.kind !== 'normal').slice().reverse();
      const list = el('ul', 'le-list');
      events.slice(0, 12).forEach((r) => {
        const li = el('li', 'le-ev');
        li.setAttribute('data-day', r.start < (normal?.start || '') ? normal.start : r.start);
        li.title = 'Open in the diary';
        const sw = el('span', 'sw'); sw.style.background = kindColor(r.kind);
        const what = el('div', 'le-what');
        what.append(el('div', 'le-t', r.title), el('small', null, r.start === r.end ? fDay(pDate(r.start)) : `${fDay(pDate(r.start))} – ${fDay(pDate(r.end))} · ${KINDS[r.kind]?.label || r.kind}`));
        const m = el('div', 'le-m', r.minutes ? `${mins(r.per_day)} a day` : 'no reading');
        li.append(sw, what, m);
        list.append(li);
      });
      const more = events.length > 12 ? el('p', 'note', `And ${fmt(events.length - 12)} earlier.`) : null;
      box.replaceChildren(tiles, list, ...(more ? [more] : []));
    },
  });

  // ---------- admin: Life events ----------
  if (!rh.adminSection) return;
  rh.adminSection({ id: 'life-events', title: 'Life events', order: 47, draw(box, a) {
    const { h } = a;
    let data = null;
    const evBox = h('div', {}), calBox = h('div', {});
    box.append(h('p', { class: 'up-note' }, 'Holidays, trips and life events (a new job, a baby, moving house), shaded on the heatmap, the timeline and the diary and compared with normal days. They are personal: visitors only see them if you tick "Holidays and life events" for them under Access & privacy.'), evBox, calBox);
    const reload = () => window.dash.reload && window.dash.reload();
    async function load() {
      try { data = await a.get('api/admin/life-events'); } catch (e) { evBox.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }
      drawEvents(); drawCalendar();
    }
    const kindSel = (v) => h('select', { 'aria-label': 'Kind' }, data.kinds.map((k) => h('option', { value: k, selected: k === v }, KINDS[k]?.label || k)));
    function drawEvents() {
      const out = a.msg();
      const title = h('input', { type: 'text', placeholder: 'Summer in Cornwall', 'aria-label': 'Name', maxlength: '120' });
      const kind = kindSel('holiday');
      const start = h('input', { type: 'date', 'aria-label': 'First day' });
      const end = h('input', { type: 'date', 'aria-label': 'Last day' });
      start.addEventListener('change', () => { if (!end.value || end.value < start.value) end.value = start.value; });
      const add = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Add');
      add.addEventListener('click', async () => {
        add.disabled = true; out.textContent = 'Saving…';
        try {
          await a.post('api/admin/life-events', { title: title.value, kind: kind.value, start: start.value, end: end.value || start.value });
          out.textContent = 'Added.'; reload(); await load();
        } catch (e) { out.textContent = e.message; }
        add.disabled = false;
      });
      const list = h('ul', { class: 'ad-list le-admin-list' }, data.events.slice().sort((x, y) => (x.start < y.start ? 1 : -1)).map((e) =>
        h('li', {}, h('span', {}, `${e.title} · ${KINDS[e.kind]?.label || e.kind} · ${e.start === e.end ? e.start : `${e.start} – ${e.end}`}`),
          h('button', { class: 'up-link', type: 'button', 'aria-label': `Remove ${e.title}`, onclick: async () => {
            try { await a.del(`api/admin/life-events/${encodeURIComponent(e.id)}`); reload(); await load(); } catch (err) { out.textContent = err.message; }
          } }, 'Remove'))));
      evBox.replaceChildren(a.block('Marked by hand', data.events.length ? null : 'None yet.',
        h('div', { class: 'le-add' }, title, kind, start, end), h('div', { class: 'ad-actions' }, add), out, list));
    }
    function drawCalendar() {
      const c = data.calendar, out = a.msg();
      const url = h('input', { type: 'url', placeholder: c.set ? `Set (${c.host})` : 'https://… or webcal://…/calendar.ics', 'aria-label': 'Calendar address' });
      const save = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Save');
      save.addEventListener('click', async () => {
        save.disabled = true; out.textContent = 'Reading the calendar…';
        try {
          const r = await a.put('api/admin/life-events/calendar', { url: url.value });
          out.textContent = r.error || (url.value ? `Read ${r.read} event(s).` : 'Removed.'); reload(); data = r; drawCalendar(); return;
        } catch (e) { out.textContent = e.message; }
        save.disabled = false;
      });
      const actions = [];
      if (c.set) {
        actions.push(h('button', { class: 'up-copy', type: 'button', onclick: async () => {
          out.textContent = 'Reading the calendar…';
          try { const r = await a.post('api/admin/life-events/calendar/refresh', {}); data = r; drawCalendar(); reload(); } catch (e) { out.textContent = e.message; }
        } }, 'Read it now'), h('button', { class: 'up-link', type: 'button', onclick: async () => {
          try { data = await a.put('api/admin/life-events/calendar', { url: '' }); drawCalendar(); reload(); } catch (e) { out.textContent = e.message; }
        } }, 'Remove the calendar'));
      }
      const status = !c.set ? 'No calendar.' : c.error ? `Last try failed: ${c.error}` + (c.pulled ? ` (events from ${a.when(c.pulled)} kept)` : '')
        : c.pulled ? `${c.events.length} event(s), read ${a.ago(c.pulled)}.` : 'Not read yet.';
      calBox.replaceChildren(a.block('From a calendar', 'An iCal (.ics) address, such as a shared holiday calendar or Google Calendar\'s "secret address in iCal format". All-day events and anything lasting 20 hours or more are marked; shorter appointments are skipped, and repeating events count once. It is read on the server every few hours; the address is never shown to visitors.',
        h('div', { class: 'le-cal' }, url), h('div', { class: 'ad-actions' }, save, ...actions), h('p', { class: 'up-note' }, status), out));
    }
    load();
  } });
})();
