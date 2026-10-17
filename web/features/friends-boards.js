// Overlaid heatmaps and opt-in leaderboards (BOO-34). The heatmap lays everyone's last 12
// months over one calendar, each day split into a band per person. The leaderboards rank
// friends per stat over their own last 12 months; each person only appears on the boards
// they opted into (in their own share settings: profile.leaderboards in their share file,
// and yours under Admin → Friends).
(() => {
  const DAY = 864e5;
  const dayNo = (s) => Math.round(Date.parse(String(s).slice(0, 10)) / DAY);

  // each stat over the 365 days up to the person's latest day of reading
  dash.calc('leaderboard_stats', {
    inputs: ['reads', 'daily', 'as_of'],
    title: 'Leaderboard stats',
    description: 'Over the last 12 months: books finished, hours, words, longest streak of days, average words per minute and reading days. Null when the data can’t say (no day-by-day reading).',
    fn: (reads, daily, as_of) => {
      const end = dayNo(as_of[0].date), from = end - 364;
      const inYear = (s) => { const d = dayNo(s); return d >= from && d <= end; };
      const days = daily.filter((d) => d.date && inYear(d.date) && (d.minutes > 0 || d.words > 0));
      const has = daily.length > 0;
      const dates = [...new Set(days.map((d) => dayNo(d.date)))].sort((a, b) => a - b);
      let best = 0, run = 0;
      dates.forEach((d, i) => { run = i && d - dates[i - 1] === 1 ? run + 1 : 1; best = Math.max(best, run); });
      const timed = days.filter((d) => d.minutes > 0 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800);
      const m = timed.reduce((a, d) => a + d.minutes, 0);
      return [
        { stat: 'books', value: reads.filter((r) => r.finished === true && r.end && inYear(r.end)).length },
        { stat: 'hours', value: has ? Math.round(days.reduce((a, d) => a + (d.minutes || 0), 0) / 6) / 10 : null },
        { stat: 'words', value: has ? days.reduce((a, d) => a + (d.words || 0), 0) : null },
        { stat: 'streak', value: has ? best : null },
        { stat: 'speed', value: m >= 60 ? Math.round(timed.reduce((a, d) => a + d.words, 0) / m) : null },
        { stat: 'days', value: has ? dates.length : null },
      ];
    },
  });

  const { el, fmt, svgIn, showTip, hideTip, tipLines, plural } = rh;
  const STATS = {
    books: { name: 'Books finished', unit: (v) => plural(v, 'book') },
    hours: { name: 'Hours read', unit: (v) => `${fmt(Math.round(v))} h` },
    words: { name: 'Words read', unit: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : `${fmt(Math.round(v / 1000))}k`) },
    streak: { name: 'Longest streak', unit: (v) => plural(v, 'day') },
    speed: { name: 'Reading speed', unit: (v) => `${fmt(v)} wpm` },
    days: { name: 'Reading days', unit: (v) => plural(v, 'day') },
  };
  const DAY_STATS = new Set(['streak']);

  // everyone, you first: { slug, name, color, daily, stats, opted, dates }
  function people() {
    const fr = rh.friends;
    const me = {
      slug: 'me', name: 'You', color: fr.color('me'), daily: dash.data('daily').data || [],
      stats: dash.data('leaderboard_stats').data || [], opted: fr.me().leaderboards || [], dates: dash.dates || 'day',
    };
    return [me, ...fr.list().map((f) => ({
      slug: f.slug, name: f.name, color: fr.color(f.slug), daily: f.daily || [],
      stats: fr.calc(f.slug, 'leaderboard_stats') || [], opted: f.leaderboards || [], dates: (f.privacy && f.privacy.dates) || 'day',
    }))];
  }

  // ---------- overlaid heatmap ----------
  const off = new Set();
  rh.card({
    tab: 'friends', id: 'friends-heat', title: 'Reading days, side by side', calc: 'as_of',
    note: 'The last 12 months, a square per day. Each square is split into a band per person, darker for more minutes. Click a name to leave them out.',
    draw(box, asOf, parts) {
      box.replaceChildren();
      const fr = rh.friends;
      if (!fr || fr.status() !== 'ok' || !fr.list().length) { parts.card.hidden = true; return; }
      parts.card.hidden = false;
      const all = people(), withDays = all.filter((p) => p.daily.length);
      const shown = withDays.filter((p) => !off.has(p.slug));
      const pick = el('div', 'fr-pick');
      withDays.forEach((p) => {
        const b = el('button', 'fr-pill');
        b.type = 'button'; b.setAttribute('aria-pressed', String(!off.has(p.slug)));
        const sw = el('i', 'sw'); sw.style.background = p.color;
        b.append(sw, p.name);
        b.addEventListener('click', () => { if (off.has(p.slug)) off.delete(p.slug); else if (shown.length > 1) off.add(p.slug); rh.redraw(); });
        pick.append(b);
      });
      box.append(pick);
      const without = all.filter((p) => !p.daily.length);
      if (without.length) box.append(el('p', 'fr-note', `${without.map((p) => p.name).join(' and ')} ${without.length > 1 ? 'keep' : 'keeps'} their day-by-day reading private.`));

      // minutes per person per day
      const end = Math.max(dayNo(asOf[0].date), ...shown.map((p) => Math.max(...p.daily.map((d) => dayNo(d.date))))), start = end - 364;
      const per = shown.map((p) => {
        const m = new Map();
        p.daily.forEach((d) => { const n = dayNo(d.date); if (n >= start && n <= end && d.minutes > 0) m.set(n, (m.get(n) || 0) + d.minutes); });
        return m;
      });
      const top = d3.quantile(per.flatMap((m) => [...m.values()]).sort(d3.ascending), 0.95) || 60;
      const first = start - ((new Date(start * DAY).getUTCDay() + 6) % 7); // back to Monday
      const weeks = Math.ceil((end - first + 1) / 7);
      const wrap = el('div', 'fh-wrap');
      box.append(wrap);
      const lw = 26, cw = Math.max(11, Math.min(18, (Math.max(280, wrap.clientWidth || box.clientWidth) - lw) / weeks)), gap = cw > 11 ? 2 : 1, h = cw * 7 + 18;
      const { svg, tip } = svgIn(wrap, h);
      svg.attr('viewBox', `0 0 ${lw + cw * weeks} ${h}`).attr('width', lw + cw * weeks);
      ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((t, i) => t && svg.append('text').attr('class', 'axl').attr('x', 0).attr('y', 16 + i * cw + cw / 2).attr('dy', '0.35em').text(t));
      let lastMonth = -1;
      for (let wk = 0; wk < weeks; wk++) {
        const d = new Date((first + wk * 7) * DAY);
        if (d.getUTCMonth() !== lastMonth && wk < weeks - 1) { lastMonth = d.getUTCMonth(); svg.append('text').attr('class', 'axl').attr('x', lw + wk * cw).attr('y', 10).text(d3.utcFormat('%b')(d)); }
      }
      const g = svg.append('g').attr('transform', `translate(${lw},16)`);
      const band = (cw - gap) / shown.length;
      let together = 0, run = 0, bestRun = 0;
      for (let n = first; n <= end; n++) {
        const wk = Math.floor((n - first) / 7), wd = (n - first) % 7;
        if (n < start) continue;
        const cell = g.append('g').attr('transform', `translate(${wk * cw},${wd * cw})`);
        cell.append('rect').attr('width', cw - gap).attr('height', cw - gap).attr('rx', 2).attr('class', 'fh-empty');
        per.forEach((m, i) => {
          const v = m.get(n);
          if (!v) return;
          cell.append('rect').attr('x', i * band).attr('width', band).attr('height', cw - gap).attr('rx', shown.length === 1 ? 2 : 0)
            .attr('fill', shown[i].color).attr('fill-opacity', 0.25 + 0.75 * Math.min(1, v / top));
        });
        const all3 = per.every((m) => m.get(n));
        if (all3 && shown.length > 1) { together++; run++; bestRun = Math.max(bestRun, run); } else run = 0;
        cell.append('rect').attr('class', 'hit').attr('width', cw - gap).attr('height', cw - gap).attr('fill', 'transparent')
          .on('mousemove', (e) => showTip(tip, wrap, e, (t) => tipLines(t, rh.fDay(new Date(n * DAY)), shown.map((p, i) => [p.color, p.name, per[i].get(n) ? rh.mins(per[i].get(n)) : '—']))))
          .on('mouseleave', () => hideTip(tip));
      }
      // on a narrow screen it scrolls: start at the latest weeks
      requestAnimationFrame(() => (wrap.scrollLeft = wrap.scrollWidth));
      if (shown.length > 1) {
        const names = shown.length === 2 ? `${shown[0].name === 'You' ? 'you' : shown[0].name} and ${shown[1].name}` : 'all of you';
        const take = el('p', 'fp-take', `${names[0].toUpperCase() + names.slice(1)} read on the same day ${plural(together, 'time')} in the last 12 months` + (bestRun > 1 ? `, at best ${plural(bestRun, 'day')} running.` : '.'));
        box.prepend(take);
      }
    },
  });

  // ---------- leaderboards ----------
  rh.card({
    tab: 'friends', id: 'friends-boards', title: 'Leaderboards', after: 'card-friends-heat', calc: 'leaderboard_stats',
    note: 'The last 12 months of each person’s reading. Everyone chooses which boards they’re on; a board needs two people.',
    draw(box, _rows, parts) {
      box.replaceChildren();
      const fr = rh.friends;
      if (!fr || fr.status() !== 'ok' || !fr.list().length) { parts.card.hidden = true; return; }
      parts.card.hidden = false;
      const all = people();
      const grid = el('div', 'lb-grid');
      let shownBoards = 0;
      Object.entries(STATS).forEach(([k, s]) => {
        const rows = all
          .filter((p) => p.opted.includes(k) && !(DAY_STATS.has(k) && p.dates !== 'day'))
          .map((p) => ({ p, v: (p.stats.find((r) => r.stat === k) || {}).value }))
          .filter((r) => r.v != null)
          .sort((a, b) => b.v - a.v);
        const board = el('div', 'lb-board');
        board.append(el('h3', 'lb-h', s.name));
        if (rows.length < 2) {
          const out = all.filter((p) => !p.opted.includes(k)).map((p) => p.name);
          board.append(el('p', 'fr-note', rows.length ? `Only ${rows[0].p.name === 'You' ? 'you' : rows[0].p.name} so far.` : 'Nobody’s on this one yet.'));
          if (out.includes('You') && fr.me().leaderboards) board.append(el('p', 'fr-note', 'Join it under Admin → Friends.'));
          board.classList.add('lb-quiet');
          grid.append(board);
          return;
        }
        shownBoards++;
        const max = rows[0].v || 1;
        const ol = el('ol', 'lb-list');
        rows.forEach((r, i) => {
          const li = el('li', 'lb-row' + (r.p.slug === 'me' ? ' lb-me' : ''));
          const bar = el('div', 'lb-bar'), fill = el('i');
          fill.style.width = Math.max(2, (r.v / max) * 100) + '%'; fill.style.background = r.p.color; bar.append(fill);
          li.append(el('span', 'lb-rank', i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`), el('span', 'lb-name', r.p.name), el('b', 'lb-val', s.unit(r.v)), bar);
          ol.append(li);
        });
        board.append(ol);
        const missing = all.filter((p) => !p.opted.includes(k)).map((p) => p.name);
        if (missing.length) board.append(el('p', 'fr-note', `Not on it: ${missing.join(', ')}.`));
        grid.append(board);
      });
      box.append(grid);
      if (!shownBoards) box.append(el('p', 'note', 'Leaderboards fill up as people opt in.'));
    },
  });

  // ---------- admin: your own opt-ins ----------
  const adminBlocks = Array.isArray(rh.friendsAdmin) ? rh.friendsAdmin : (rh.friendsAdmin = []);
  adminBlocks.push((box, a, state) => {
    const { h, block, msg } = a;
    const out = msg();
    const boxes = Object.entries(STATS).map(([k, s]) => {
      const c = h('input', { type: 'checkbox', name: k, checked: state.settings.leaderboards.includes(k) });
      return [k, c, h('label', { class: 'pv-check' }, c, s.name)];
    });
    const save = h('button', { class: 'up-copy', type: 'button', onclick: async () => {
      try {
        await a.put('api/admin/friends/settings', { leaderboards: boxes.filter(([, c]) => c.checked).map(([k]) => k) });
        out.textContent = 'Saved. Friends see it the next time they get your reading.';
      } catch (e) { out.textContent = e.message; }
    } }, 'Save');
    return block('Leaderboards', 'Choose the leaderboards you appear on, here and on your friends’ dashboards. It travels with your share file and what followers pull.',
      h('div', { class: 'pv-checks' }, boxes.map((b) => b[2])), h('div', { class: 'ad-actions' }, save), out);
  });
})();
