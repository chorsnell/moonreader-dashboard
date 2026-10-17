// Heatmap explorer: any two dimensions of your reading against one measure, on the Patterns tab.
(() => {
  const { el, fmt, C, showTip, hideTip, tipLines, mins, link, openDiary } = rh;
  rh.tab('patterns', 'Patterns', { after: 'timeline' });

  // one row per book per day read, plus the days reads started and finished
  dash.calc('heat_facts', {
    inputs: ['daily', 'reads', 'books'], title: 'Reading facts',
    description: 'One row per book per day read, with minutes, words, timed words and minutes for speed, and whether a read started or finished that day; the heatmap explorer groups these.',
    fn: (daily, reads, books) => {
      const meta = new Map(books.map((b) => [b.id, b])), at = new Map(), out = [];
      const row = (book_id, date, title) => {
        const b = meta.get(book_id) || {};
        return { date, book_id, title: b.title || title, author: b.author || null, genre: b.genre || null, subgenre: b.subgenre || null, series: b.series || null,
          minutes: 0, words: 0, timed_words: 0, timed_minutes: 0, read: false, started: 0, finished: 0 };
      };
      daily.forEach((d) => {
        const r = row(d.book_id, d.date, d.title), wpm = d.minutes ? d.words / d.minutes : 0;
        r.minutes = d.minutes || 0; r.words = d.words || 0; r.read = true;
        if (d.minutes >= 1 && d.words > 0 && wpm >= 40 && wpm <= 800) { r.timed_words = d.words; r.timed_minutes = d.minutes; }
        at.set(d.book_id + '|' + d.date, r); out.push(r);
      });
      const ev = (r, date, k) => {
        let f = at.get(r.book_id + '|' + date);
        if (!f) { f = row(r.book_id, date, r.title); at.set(r.book_id + '|' + date, f); out.push(f); }
        f[k]++;
      };
      reads.forEach((r) => { ev(r, r.start, 'started'); if (r.finished === true) ev(r, r.end, 'finished'); });
      return out.sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  });

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const pD = (s) => new Date(s + 'T00:00:00Z');
  const monday = (s) => d3.utcMonday.floor(pD(s)).toISOString().slice(0, 10);
  const isoWeek = (s) => +d3.utcFormat('%V')(pD(s));
  const num = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // time dimensions keep their own order (and fill gaps between first and last); the rest are categories
  const DIMS = {
    year: { name: 'Year', time: true, key: (f) => +f.date.slice(0, 4), label: String, kind: 'year', fill: (a, b) => d3.range(a, b + 1) },
    month: { name: 'Month', time: true, key: (f) => f.date.slice(0, 7), label: (k) => MON[+k.slice(5) - 1] + ' ' + k.slice(2, 4), diary: (k) => k + '-01',
      fill: (a, b) => d3.utcMonth.range(pD(a + '-01'), d3.utcMonth.offset(pD(b + '-01'), 1)).map((d) => d.toISOString().slice(0, 7)) },
    moy: { name: 'Month of year', time: true, key: (f) => +f.date.slice(5, 7), label: (k) => MON[k - 1], fill: () => d3.range(1, 13) },
    week: { name: 'Week', time: true, key: (f) => monday(f.date), label: (k) => d3.utcFormat('%-d %b %y')(pD(k)), diary: (k) => k,
      fill: (a, b) => d3.utcMonday.range(pD(a), d3.utcDay.offset(pD(b), 1)).map((d) => d.toISOString().slice(0, 10)) },
    woy: { name: 'Week of year', time: true, key: (f) => isoWeek(f.date), label: (k) => 'W' + k, fill: (a, b) => d3.range(1, Math.max(b, 52) + 1) },
    weekday: { name: 'Weekday', time: true, key: (f) => (pD(f.date).getUTCDay() + 6) % 7, label: (k) => WD[k], fill: () => d3.range(7) },
    genre: { name: 'Genre', key: (f) => f.genre, label: String, kind: 'genre' },
    subgenre: { name: 'Subgenre', key: (f) => f.subgenre, label: String, kind: 'subgenre' },
    author: { name: 'Author', key: (f) => f.author, label: String, kind: 'author' },
    series: { name: 'Series', key: (f) => f.series, label: String, kind: 'series' },
    book: { name: 'Book', key: (f) => f.book_id, label: (k, f) => (f ? f.title : k), kind: 'book' },
  };
  // value(acc) → number or null; rank(acc) picks the top rows
  const MEASURES = {
    minutes: { name: 'Minutes read', value: (a) => (a.m ? a.m : null), show: (v) => mins(v) },
    words: { name: 'Words read', value: (a) => (a.w ? a.w : null), show: (v) => fmt(Math.round(v)) + ' words' },
    days: { name: 'Days read', value: (a) => a.days.size || null, show: (v) => fmt(v) + (v === 1 ? ' day' : ' days') },
    books: { name: 'Books opened', value: (a) => a.books.size || null, show: (v) => fmt(v) + (v === 1 ? ' book' : ' books') },
    started: { name: 'Reads started', value: (a) => a.st || null, show: (v) => fmt(v) + ' started' },
    finished: { name: 'Books finished', value: (a) => a.fin || null, show: (v) => fmt(v) + ' finished' },
    wpm: { name: 'Words per minute', value: (a) => (a.om >= 15 ? a.ow / a.om : null), rank: (a) => a.om, show: (v) => Math.round(v) + ' wpm' },
  };
  const PRESETS = [
    ['author', 'year', 'minutes', 'Authors by year'], ['genre', 'moy', 'minutes', 'Genres through the year'], ['weekday', 'moy', 'minutes', 'Weekday × month'],
    ['series', 'year', 'finished', 'Series by year'], ['book', 'month', 'minutes', 'What I read when', 'first'], ['year', 'woy', 'minutes', 'Week of year × year'],
    ['genre', 'year', 'wpm', 'Speed by genre and year'],
  ];
  const DEF = { rows: 'author', cols: 'year', measure: 'minutes', sort: 'total' };
  const OTHER = '\u0000other';
  const acc = () => ({ m: 0, w: 0, ow: 0, om: 0, st: 0, fin: 0, days: new Set(), books: new Set(), first: null });
  const add = (a, f) => {
    a.m += f.minutes; a.w += f.words; a.ow += f.timed_words; a.om += f.timed_minutes; a.st += f.started; a.fin += f.finished;
    if (f.read) { a.days.add(f.date); a.books.add(f.book_id); }
    if (!a.first || f.date < a.first) a.first = f.date;
  };

  // group facts into rows × columns; categories past the top n fold into one "Other"
  function grid(facts, o, nRows, nCols) {
    const M = MEASURES[o.measure], rank = M.rank || ((a) => M.value(a) || 0);
    const R = DIMS[o.rows], K = DIMS[o.cols];
    const use = facts.filter((f) => R.key(f) != null && K.key(f) != null);
    const axis = (D, n) => {
      const tot = new Map(), sample = new Map();
      use.forEach((f) => { const k = D.key(f); if (!tot.has(k)) { tot.set(k, acc()); sample.set(k, f); } add(tot.get(k), f); });
      let keys = [...tot.keys()].filter((k) => rank(tot.get(k)) > 0), folded = [];
      if (D.time) {
        const s = keys.slice().sort(num);
        keys = s.length ? D.fill(s[0], s[s.length - 1]) : [];
        keys.forEach((k) => { if (!tot.has(k)) tot.set(k, acc()); });
      } else {
        keys.sort((a, b) => rank(tot.get(b)) - rank(tot.get(a)));
        if (keys.length > n) { folded = keys.slice(n - 1); keys = keys.slice(0, n - 1); }
      }
      const other = new Set(folded);
      return { D, keys, folded, other, tot, sample, map: (k) => (other.has(k) ? OTHER : k) };
    };
    const rows = axis(R, nRows), cols = axis(K, nCols);
    if (!R.time) {
      const t = rows.tot;
      if (o.sort === 'first') rows.keys.sort((a, b) => num(t.get(a).first, t.get(b).first));
      else if (o.sort === 'az') rows.keys.sort((a, b) => R.label(a, rows.sample.get(a)).localeCompare(R.label(b, rows.sample.get(b))));
    }
    [rows, cols].forEach((x) => { if (x.folded.length) { x.keys.push(OTHER); const a = acc(); x.folded.forEach((k) => use.filter((f) => x.D.key(f) === k).forEach((f) => add(a, f))); x.tot.set(OTHER, a); } });
    const cells = new Map();
    use.forEach((f) => {
      const k = rows.map(R.key(f)) + '\u0001' + cols.map(K.key(f));
      if (!cells.has(k)) cells.set(k, acc());
      add(cells.get(k), f);
    });
    return { rows, cols, cells, M };
  }

  const opt = (sel, entries, v) => { sel.replaceChildren(...entries.map(([k, n]) => Object.assign(el('option', null, n), { value: k }))); sel.value = v; };
  let ui = null;
  function controls(parts) {
    if (ui) return ui;
    const box = el('div', 'hx-ctl'), presets = el('div', 'hx-presets');
    const field = (lbl) => { const l = el('label', null, lbl + ' '), s = el('select'); l.append(s); box.append(l); return s; };
    const rows = field('Rows'), cols = field('Columns'), measure = field('Measure'), sort = field('Sort rows');
    const dims = Object.entries(DIMS).map(([k, d]) => [k, d.name]);
    opt(rows, dims, DEF.rows); opt(cols, dims, DEF.cols); opt(measure, Object.entries(MEASURES).map(([k, m]) => [k, m.name]), DEF.measure);
    opt(sort, [['total', 'By total'], ['first', 'By first read'], ['az', 'A–Z']], DEF.sort);
    const set = (p) => dash.setParams(p);
    rows.addEventListener('change', () => set({ hx_rows: rows.value, ...(rows.value === cols.value ? { hx_cols: ui.cur.rows } : {}) }));
    cols.addEventListener('change', () => set({ hx_cols: cols.value, ...(rows.value === cols.value ? { hx_rows: ui.cur.cols } : {}) }));
    measure.addEventListener('change', () => set({ hx_measure: measure.value }));
    sort.addEventListener('change', () => set({ hx_sort: sort.value }));
    PRESETS.forEach(([r, c, m, name, sort]) => {
      const b = el('button', 'hx-preset', name); b.type = 'button'; b.dataset.key = [r, c, m].join('|');
      b.addEventListener('click', () => set({ hx_rows: r, hx_cols: c, hx_measure: m, hx_sort: sort || 'total' }));
      presets.append(b);
    });
    parts.note.after(presets, box);
    const foot = el('p', 'note hx-foot');
    parts.box.after(foot);
    ui = { rows, cols, measure, sort, presets, foot, cur: DEF };
    return ui;
  }

  function cur() {
    const p = dash.params(), o = { rows: p.hx_rows, cols: p.hx_cols, measure: p.hx_measure, sort: p.hx_sort || DEF.sort };
    if (!DIMS[o.rows] || !DIMS[o.cols] || o.rows === o.cols) { o.rows = DEF.rows; o.cols = DEF.cols; }
    if (!MEASURES[o.measure]) o.measure = DEF.measure;
    return o;
  }

  rh.card({
    tab: 'patterns', id: 'heat-explorer', title: 'Heatmap explorer', calc: 'heat_facts',
    note: 'Pick any two dimensions and a measure, or start from one of the views below. Hover a cell for the figure; click it to open that period in the diary, or the author, genre, series, book or year it belongs to.',
    draw(box, facts, parts) {
      const c = controls(parts), o = cur();
      c.cur = o; c.rows.value = o.rows; c.cols.value = o.cols; c.measure.value = o.measure; c.sort.value = o.sort;
      c.sort.parentElement.hidden = !!DIMS[o.rows].time;
      c.presets.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === [o.rows, o.cols, o.measure].join('|'))));
      const W = Math.max(280, box.clientWidth), phone = W < 560;
      // books are a long tail by nature, so they get more rows
      const g = grid(facts, o, o.rows === 'book' ? (phone ? 20 : 30) : phone ? 10 : 15, phone ? 8 : 12), { rows, cols, cells, M } = g;
      box.replaceChildren();
      if (!rows.keys.length || !cols.keys.length) { box.style.minHeight = '80px'; box.append(el('div', 'dy-empty', 'Nothing to show for this pair.')); c.foot.textContent = ''; return; }
      const lab = (x, k) => (k === OTHER ? `Other (${x.folded.length})` : x.D.label(k, x.sample.get(k)));
      const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
      // measure labels
      const probe = d3.select(box).append('svg').attr('width', 0).attr('height', 0), t = probe.append('text').attr('class', 'axl');
      const len = (s) => { t.text(s); return t.node().getComputedTextLength(); };
      const rl = rows.keys.map((k) => short(lab(rows, k), phone ? 16 : 26)), cl = cols.keys.map((k) => short(lab(cols, k), 18));
      const lw = Math.ceil(d3.max(rl, len)) + 10, cmax = d3.max(cl, len);
      probe.remove();
      const avail = W - lw - 4, cw = Math.max(14, Math.min(72, Math.floor(avail / cols.keys.length))), ch = 22, gap = 2;
      // column labels: flat when they fit, otherwise slanted
      const flat = cmax + 6 <= cw, every = flat ? 1 : DIMS[o.cols].time ? Math.max(1, Math.ceil(16 / cw)) : 1;
      const head = flat ? 18 : Math.min(110, Math.ceil(cmax * 0.75) + 14);
      const gw = cols.keys.length * cw, h = head + rows.keys.length * ch + 4;
      box.style.minHeight = h + 'px';
      const wrap = el('div', 'hx-wrap'), left = el('div', 'hx-rows'), scroll = el('div', 'hx-scroll');
      wrap.append(left, scroll); box.append(wrap);
      const tip = d3.select(box).append('div').attr('class', 'tip');
      const ls = d3.select(left).append('svg').attr('width', lw).attr('height', h);
      ls.selectAll('text').data(rows.keys).join('text').attr('class', 'axl').attr('x', lw - 8).attr('y', (k, i) => head + i * ch + ch / 2).attr('dy', '0.35em')
        .attr('text-anchor', 'end').text((k, i) => rl[i]).each(function (k) { if (k !== OTHER && rows.D.kind) link(this, rows.D.kind, k); })
        .append('title').text((k) => lab(rows, k));
      const svg = d3.select(scroll).append('svg').attr('width', gw).attr('height', h);
      svg.append('g').selectAll('text').data(cols.keys).join('text').attr('class', 'axl')
        .attr('transform', (k, i) => (flat ? `translate(${i * cw + cw / 2},12)` : `translate(${i * cw + cw / 2},${head - 6}) rotate(-50)`))
        .attr('text-anchor', flat ? 'middle' : 'start').text((k, i) => (i % every ? '' : cl[i]))
        .each(function (k) { if (k !== OTHER && cols.D.kind) link(this, cols.D.kind, k); });
      const data = [];
      rows.keys.forEach((r, i) => cols.keys.forEach((k, j) => {
        const a = cells.get(r + '\u0001' + k), v = a ? M.value(a) : null;
        data.push({ r, k, i, j, a, v });
      }));
      const vals = data.filter((d) => d.v != null && d.r !== OTHER && d.k !== OTHER).map((d) => d.v).sort(d3.ascending);
      const lo = o.measure === 'wpm' ? d3.quantile(vals, 0.05) || 0 : 0, hi = d3.quantile(vals, 0.95) || 1;
      const op = (o.measure === 'wpm' ? d3.scaleLinear([lo, hi], [0.15, 1]) : d3.scaleSqrt([0, hi], [0.15, 1])).clamp(true);
      const diaryOf = (d) => (rows.D.diary && d.r !== OTHER ? rows.D.diary(d.r) : cols.D.diary && d.k !== OTHER ? cols.D.diary(d.k) : null);
      const target = (d) => (d.r !== OTHER && rows.D.kind ? [rows.D.kind, d.r] : d.k !== OTHER && cols.D.kind ? [cols.D.kind, d.k] : null);
      const rects = svg.append('g').selectAll('rect').data(data).join('rect')
        .attr('x', (d) => d.j * cw + gap / 2).attr('y', (d) => head + d.i * ch + gap / 2).attr('width', cw - gap).attr('height', ch - gap).attr('rx', 3)
        .attr('fill', (d) => (d.v != null ? C[0] : 'var(--cds-chart-grid)')).attr('fill-opacity', (d) => (d.v != null ? op(d.v) : 1))
        .classed('hx-go', (d) => d.v != null && !!(diaryOf(d) || target(d)))
        .each(function (d) { if (d.v != null && !diaryOf(d) && target(d)) link(this, ...target(d)); })
        .on('mousemove', (e, d) => showTip(tip, box, e, (tp) => {
          const lines = [[d.v != null ? C[0] : null, M.name, d.v != null ? M.show(d.v) : '—']];
          if (d.a && o.measure !== 'minutes' && d.a.m) lines.push([null, 'Minutes', mins(d.a.m)]);
          if (d.a && o.measure !== 'books' && d.a.books.size) lines.push([null, 'Books opened', fmt(d.a.books.size)]);
          tipLines(tp, `${lab(rows, d.r)} · ${lab(cols, d.k)}`, lines);
        }))
        .on('mouseleave', () => hideTip(tip));
      rects.filter((d) => d.v != null && !!diaryOf(d)).on('click', (e, d) => { hideTip(tip); openDiary(diaryOf(d)); });
      const fold = [rows, cols].filter((x) => x.folded.length).map((x) => `${x.keys.length - 1 + x.folded.length} ${x.D.name.toLowerCase()}${x.D.name.endsWith('s') ? '' : 's'}: the top ${x.keys.length - 1} shown, the rest folded into “Other”`);
      c.foot.textContent = [`${M.name} by ${rows.D.name.toLowerCase()} and ${cols.D.name.toLowerCase()}.`, fold.length ? fold.join('; ') + '.' : '',
        o.measure === 'wpm' ? 'Speed comes from timed days only; cells with under 15 timed minutes are blank.' : '', gw > avail ? 'Scroll sideways for more.' : '']
        .filter(Boolean).join(' ');
    },
  });
})();
