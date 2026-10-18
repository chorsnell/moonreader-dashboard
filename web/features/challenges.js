// Reading challenges (BOO-80): goals beyond the yearly count, such as authors from 10
// countries, a book from every decade, finishing 3 series, 50% women authors or a 30-day
// streak. The admin sets them (admin section below; stored in settings.json, served as
// data/challenges.json); progress comes from the same fields the Origins and Genres tabs use.
(() => {
  const { el, fmt, plural, ref, chip } = rh;
  dash.file('challenges', 'data/challenges.json', { optional: true });

  const DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z');
  const decadeOf = (y) => Math.floor(y / 10) * 10;
  const decadeName = (d) => (d < 0 ? `${-d}s BC` : `${d}s`);

  dash.calc('challenge_progress', {
    inputs: ['challenges', 'books', 'reads', 'daily', 'as_of'], title: 'Reading challenges',
    description: 'Each challenge the owner set, with progress: distinct author countries, decades of publication, series with every book you have finished, the share of books by women (author gender known), the longest run of reading days, or distinct genres; counted from books finished in the backup\'s year (or ever, for all-time challenges).',
    fn: (challenges, books, reads, daily, as_of) => {
      if (!challenges.length || !as_of[0]?.date) return [];
      const year = as_of[0].date.slice(0, 4);
      const byId = new Map(books.map((b) => [b.id, b]));
      // private books visitors get anonymised say nothing about their author or genre
      const known = (b) => b && b.genre !== 'Private';
      const finished = (period) => {
        const seen = new Map();
        reads.filter((r) => r.finished === true && r.end && (period === 'all' || r.end.slice(0, 4) === year)).forEach((r) => {
          const b = byId.get(r.book_id);
          if (known(b) && !seen.has(b.id)) seen.set(b.id, b);
        });
        return [...seen.values()];
      };
      // a series is finished on the day its last unfinished book was first finished
      const seriesDone = () => {
        const firstEnd = new Map();
        reads.filter((r) => r.finished === true && r.end).forEach((r) => { if (!firstEnd.has(r.book_id) || r.end < firstEnd.get(r.book_id)) firstEnd.set(r.book_id, r.end); });
        const by = new Map();
        books.filter((b) => b.series && known(b)).forEach((b) => (by.get(b.series) || by.set(b.series, []).get(b.series)).push(b));
        return [...by].filter(([, v]) => v.length >= 2 && v.every((b) => firstEnd.has(b.id)))
          .map(([series, v]) => ({ series, done: v.map((b) => firstEnd.get(b.id)).sort().pop(), books: v.length }));
      };
      const streak = (period) => {
        const days = [...new Set(daily.filter((d) => (d.minutes > 0 || d.words > 0) && (period === 'all' || d.date.slice(0, 4) === year)).map((d) => d.date))].sort();
        let best = 0, bestEnd = null, run = 0, prev = null;
        days.forEach((d) => { run = prev && t(d) - t(prev) === DAY ? run + 1 : 1; if (run > best) { best = run; bestEnd = d; } prev = d; });
        let now = 0;
        for (let i = days.length - 1; i >= 0 && t(as_of[0].date) - t(days[i]) === now * DAY; i--) now++;
        return { best, bestEnd, now };
      };

      return challenges.map((c) => {
        const row = { id: c.id, kind: c.kind, title: c.title, period: c.period, year: +year, target: c.target, value: 0, done: false, items: [], missing: [], detail: null };
        const fin = finished(c.period);
        if (c.kind === 'countries') {
          const by = new Map();
          fin.filter((b) => b.author_country).forEach((b) => by.set(b.author_country, b.author_country_name || b.author_country));
          row.items = [...by.values()].sort();
          row.value = by.size;
        } else if (c.kind === 'genres') {
          row.items = [...new Set(fin.map((b) => b.genre).filter((g) => g && g !== 'Untagged'))].sort();
          row.value = row.items.length;
        } else if (c.kind === 'decades') {
          const have = new Set(fin.filter((b) => b.published_year != null).map((b) => decadeOf(b.published_year)));
          const all = [];
          for (let d = c.from; d <= c.to; d += 10) all.push(d);
          row.items = all.filter((d) => have.has(d));
          row.missing = all.filter((d) => !have.has(d));
          row.value = row.items.length;
          row.from = c.from; row.to = c.to;
        } else if (c.kind === 'series') {
          row.items = seriesDone().filter((s) => c.period === 'all' || s.done.slice(0, 4) === year).sort((a, b) => (a.done < b.done ? -1 : 1)).map((s) => s.series);
          row.value = row.items.length;
        } else if (c.kind === 'women') {
          const g = fin.filter((b) => b.author_gender);
          const women = g.filter((b) => b.author_gender === 'female').length;
          row.value = g.length ? Math.round((women / g.length) * 100) : 0;
          row.detail = { women, books: g.length };
        } else if (c.kind === 'streak') {
          const s = streak(c.period);
          row.value = s.best;
          row.detail = { now: s.now, best_end: s.bestEnd };
        }
        row.done = row.value >= c.target;
        row.pct = Math.min(100, Math.round((row.value / c.target) * 100));
        return row;
      });
    },
  });

  // ---------- the Overview card ----------
  const hidden = (cat) => (document.documentElement.dataset.privacyHidden || '').split(' ').includes(cat);
  const when = (r) => (r.period === 'all' ? 'all time' : String(r.year));

  function tile(r) {
    const box = el('div', 'ch-tile' + (r.done ? ' done' : ''));
    const head = el('div', 'ch-head');
    head.append(el('span', 'ch-name', r.title), el('span', 'ch-when', r.done ? '✓ done' : when(r)));
    const val = el('div', 'ch-val');
    if (r.kind === 'women') val.append(el('b', null, `${r.value}%`), ` of ${r.target}%`);
    else val.append(el('b', null, fmt(r.value)), ` / ${fmt(r.target)}`);
    const bar = el('div', 'pbar ch-bar'), fill = el('i');
    fill.style.width = r.pct + '%'; bar.append(fill);
    box.append(head, val, bar);
    const more = el('div', 'ch-more');
    if (r.kind === 'decades') {
      const grid = el('div', 'ch-decades');
      for (let d = r.from; d <= r.to; d += 10) {
        const c = el('span', r.items.includes(d) ? 'on' : null, decadeName(d));
        c.title = decadeName(d) + (r.items.includes(d) ? ': read' : ': still to find');
        grid.append(c);
      }
      grid.setAttribute('aria-label', r.missing.length ? `Still to find: ${r.missing.map(decadeName).join(', ')}` : 'Every decade read');
      more.append(grid);
      if (r.missing.length && r.missing.length <= 4) more.append(el('small', null, `Still to find: ${r.missing.map(decadeName).join(', ')}`));
    } else if (r.kind === 'series' && r.items.length) {
      r.items.forEach((s, i) => { if (i) more.append(', '); more.append(ref({ series: s }, 'series')); });
    } else if (r.kind === 'genres' && r.items.length) {
      r.items.forEach((g) => more.append(chip('genre', g)));
    } else if (r.kind === 'countries' && r.items.length) {
      more.append(r.items.join(', '));
    } else if (r.kind === 'women' && r.detail) {
      more.append(r.detail.books ? `${fmt(r.detail.women)} of ${plural(r.detail.books, 'book')} with a known author gender` : 'No finished books with a known author gender yet');
    } else if (r.kind === 'streak' && r.detail) {
      more.append(r.detail.now ? `On a run of ${plural(r.detail.now, 'day')} now` : 'Longest run of days with some reading');
    }
    if (more.childNodes.length) box.append(more);
    return box;
  }

  rh.card({
    tab: 'overview', id: 'challenges', title: 'Challenges', calc: 'challenge_progress', before: 'card-years',
    note: 'Goals beyond the yearly count, from the books you finished.',
    draw(box, rows, parts) {
      // streaks need exact days; the owner may keep them from visitors
      const show = rows.filter((r) => r.kind !== 'streak' || !(hidden('streaks') || hidden('exact_dates') || hidden('diary')));
      parts.card.hidden = !show.length;
      if (!show.length) return;
      const done = show.filter((r) => r.done).length;
      parts.note.textContent = `Goals beyond the yearly count, from the books you finished. ${done ? `${fmt(done)} of ${fmt(show.length)} done.` : ''}`.trim();
      box.style.minHeight = '0';
      const grid = el('div', 'ch-grid');
      grid.append(...show.map(tile));
      box.replaceChildren(grid);
    },
  });

  // ---------- the admin section ----------
  const KINDS = [
    ['countries', 'Author countries', 'countries'],
    ['decades', 'A book from every decade', ''],
    ['series', 'Series finished', 'series'],
    ['women', 'Books by women', '%'],
    ['streak', 'Days in a row', 'days'],
    ['genres', 'Genres', 'genres'],
  ];
  rh.adminSection({
    id: 'challenges', title: 'Challenges', order: 52,
    draw(box, a) {
      const { h } = a;
      const msg = a.msg();
      let list = [];
      const rowsBox = h('div', { class: 'chs-rows' });
      const draw = () => {
        rowsBox.replaceChildren(...list.map((c, i) => {
          const set = (k) => (e) => { c[k] = e.target.value; if (k === 'kind') draw(); };
          const kind = h('select', { 'aria-label': 'Counts', onchange: set('kind') }, KINDS.map(([k, n]) => h('option', { value: k, selected: c.kind === k }, n)));
          const title = h('input', { type: 'text', 'aria-label': 'Name', value: c.title || '', maxlength: '80', oninput: set('title') });
          const period = h('select', { 'aria-label': 'Period', onchange: set('period') }, [['year', 'This year'], ['all', 'All time']].map(([k, n]) => h('option', { value: k, selected: (c.period || 'year') === k }, n)));
          const goal = c.kind === 'decades'
            ? h('span', { class: 'chs-goal' }, h('input', { type: 'number', 'aria-label': 'From year', step: '10', value: c.from ?? 1800, oninput: set('from') }), '–',
              h('input', { type: 'number', 'aria-label': 'To year', step: '10', value: c.to ?? 1920, oninput: set('to') }))
            : h('span', { class: 'chs-goal' }, h('input', { type: 'number', 'aria-label': 'Target', min: '1', value: c.target ?? 10, oninput: set('target') }),
              h('span', { class: 'chs-unit' }, KINDS.find(([k]) => k === c.kind)?.[2] || ''));
          const del = h('button', { class: 'up-link', type: 'button', 'aria-label': `Remove ${c.title || 'challenge'}`, onclick: () => { list.splice(i, 1); draw(); } }, 'Remove');
          return h('div', { class: 'chs-row' }, title, kind, goal, period, del);
        }));
      };
      const add = h('button', { class: 'up-link', type: 'button', id: 'chs-add', onclick: () => { list.push({ kind: 'genres', title: 'Read 8 genres', target: 8, period: 'year' }); draw(); } }, 'Add a challenge');
      const save = h('button', { class: 'up-primary ad-auto', type: 'button', id: 'chs-save', onclick: async () => {
        save.disabled = true; msg.textContent = 'Saving…';
        try {
          const r = await a.put('api/admin/challenges', { challenges: list });
          list = r.challenges.map((c) => ({ ...c })); draw();
          msg.textContent = 'Saved.';
          await window.dash.reload();
        } catch (e) { msg.textContent = e.message; }
        save.disabled = false;
      } }, 'Save');
      const reset = h('button', { class: 'up-link', type: 'button', id: 'chs-reset', onclick: async () => {
        if (!confirm('Go back to the default challenges? Yours are removed.')) return;
        try { const r = await a.post('api/admin/challenges/reset', {}); list = r.challenges.map((c) => ({ ...c })); draw(); msg.textContent = 'Back to the defaults.'; await window.dash.reload(); }
        catch (e) { msg.textContent = e.message; }
      } }, 'Reset to the defaults');
      box.append(a.block('Reading challenges', 'Goals shown on the Overview, beyond the yearly count. "This year" counts books finished in the year of your latest reading; "all time" counts every book. Visitors see the progress too, without any books you keep private, and without the streak when you hide streaks or exact dates.',
        rowsBox, h('div', { class: 'ad-actions' }, add), h('div', { class: 'ad-actions' }, save, reset), msg));
      a.get('api/admin/challenges').then((r) => { list = r.challenges.map((c) => ({ ...c })); draw(); }).catch((e) => { msg.textContent = e.message; });
    },
  });
})();
