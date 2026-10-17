// What you read next: a chord diagram of genre (or author) transitions from one read to the next.
(() => {
  const { el, fmt, C, gColor, showTip, hideTip, tipLines, link, chip, plural } = rh;
  rh.tab('patterns', 'Patterns', { after: 'timeline' });

  // reads in the order you started them, single-day dips left out; each one leads to the next
  dash.calc('read_transitions', {
    inputs: ['reads', 'books'], title: 'What you read next',
    description: 'Each read and the next read you started after it (in start order, single-day dips and re-reads of the same book in a row left out), with both books’ genre and author.',
    fn: (reads, books) => {
      const meta = new Map(books.map((b) => [b.id, b]));
      const seq = reads.filter((r) => r.days_read !== 1).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : 1))
        .filter((r, i, all) => !i || all[i - 1].book_id !== r.book_id);
      const side = (r) => { const b = meta.get(r.book_id) || {}; return { book_id: r.book_id, title: r.title, genre: b.genre || r.genre, author: b.author || r.author, end: r.end, start: r.start, finished: r.finished === true }; };
      return seq.slice(1).map((r, i) => {
        const a = side(seq[i]), b = side(r);
        return { from_book: a.book_id, from_title: a.title, from_genre: a.genre, from_author: a.author, from_finished: a.finished,
          to_book: b.book_id, to_title: b.title, to_genre: b.genre, to_author: b.author, date: b.start };
      });
    },
  });

  const TOP = 10, OTHER = 'Other authors';
  let sel = null;

  rh.card({
    tab: 'patterns', id: 'chord', title: 'What you read next', calc: 'read_transitions',
    note: 'Every read leads to the next one you started. A ribbon runs from one genre to the next, wider for more moves; loops back to the same genre are binges.',
    draw(box, rows, parts) {
      if (!sel) {
        sel = el('select'); sel.setAttribute('aria-label', 'Group by');
        [['genre', 'By genre'], ['author', 'By author']].forEach(([v, t]) => sel.append(Object.assign(el('option', null, t), { value: v })));
        sel.addEventListener('change', () => dash.setParams({ chord_by: sel.value === 'genre' ? null : sel.value }));
        parts.head.append(sel);
      }
      const by = dash.params().chord_by === 'author' ? 'author' : 'genre';
      sel.value = by;
      parts.note.textContent = `Every read leads to the next one you started. A ribbon runs from one ${by} to the next, wider for more moves and coloured by where it starts; ribbons that loop back are binges. Hover for counts; click ${by === 'author' ? 'an author' : 'a genre'} to open it.`;
      box.replaceChildren();
      if (rows.length < 3) { box.style.minHeight = '80px'; box.append(el('div', 'dy-empty', 'Not enough reads yet.')); return; }
      // the groups: every genre, or the most-read authors with the rest folded together
      const key = (r, s) => r[s + '_' + by] || 'Unknown';
      let names;
      if (by === 'genre') {
        const g = rh.genres(), seen = new Set(rows.flatMap((r) => [key(r, 'from'), key(r, 'to')]));
        names = g.filter((x) => seen.has(x)).concat([...seen].filter((x) => !g.includes(x)));
      } else {
        const n = d3.rollup(rows.flatMap((r) => [key(r, 'from'), key(r, 'to')]), (v) => v.length, (a) => a);
        names = [...n].sort((a, b) => b[1] - a[1]).map(([a]) => a);
        if (names.length > TOP) names = names.slice(0, TOP - 1).concat(OTHER);
      }
      const idx = (s) => { const i = names.indexOf(s); return i >= 0 ? i : names.indexOf(OTHER); };
      const M = names.map(() => names.map(() => 0)), moves = names.map(() => names.map(() => []));
      // moves between two of the folded-together authors aren't loops, so they're left out
      rows.forEach((r) => { const a = idx(key(r, 'from')), b = idx(key(r, 'to')); if (a === b && names[a] === OTHER) return; M[a][b]++; moves[a][b].push(r); });
      const color = (i) => (by === 'genre' ? gColor(names[i]) : names[i] === OTHER ? 'var(--cds-chart-muted)' : C[i % C.length]);
      const linkable = (i) => names[i] !== OTHER && names[i] !== 'Unknown';

      const wrap = el('div', 'ch-wrap'), plot = el('div', 'ch-plot'), side = el('div', 'ch-side');
      wrap.append(plot, side); box.append(wrap);
      const W = Math.max(260, Math.min(520, plot.clientWidth || box.clientWidth)), size = W, phone = W < 400;
      const R = size / 2 - (by === 'author' ? (phone ? 74 : 70) : phone ? 58 : 52), ir = R - 12;
      box.style.minHeight = size + 'px';
      const svg = d3.select(plot).append('svg').attr('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`).attr('width', '100%').style('max-width', size + 'px');
      const tip = d3.select(box).append('div').attr('class', 'tip');
      const chords = d3.chordDirected().padAngle(0.04).sortSubgroups(d3.descending).sortChords(d3.descending)(M);
      const arc = d3.arc().innerRadius(ir).outerRadius(R), ribbon = d3.ribbonArrow().radius(ir - 1).padAngle(1 / ir);
      const rib = svg.append('g').attr('fill-opacity', 0.7).selectAll('path').data(chords).join('path').attr('d', ribbon)
        .attr('fill', (d) => color(d.source.index)).attr('stroke', 'var(--color-panel)').attr('stroke-width', 0.5)
        .on('mousemove', (e, d) => showTip(tip, box, e, (t) => {
          const a = d.source.index, b = d.target.index, back = a !== b ? M[b][a] : 0;
          tipLines(t, a === b ? `${names[a]}, then more ${names[a]}` : `${names[a]} → ${names[b]}`, [[color(a), 'Times', fmt(M[a][b])], ...(back ? [[color(b), 'The other way', fmt(back)]] : [])]);
          moves[a][b].slice(-3).reverse().forEach((r) => t.append('div').text(`${r.from_title} → ${r.to_title}`));
        }))
        .on('mouseleave', () => { hideTip(tip); });
      const grp = svg.append('g').selectAll('g').data(chords.groups).join('g');
      grp.append('path').attr('d', arc).attr('fill', (d) => color(d.index)).attr('stroke', 'var(--color-panel)')
        .each(function (d) { if (linkable(d.index)) link(this, by, names[d.index]); })
        .on('mouseenter', (e, d) => rib.attr('fill-opacity', (c) => (c.source.index === d.index || c.target.index === d.index ? 0.85 : 0.08)))
        .on('mousemove', (e, d) => {
          const out = d3.sum(M[d.index]), inn = d3.sum(M, (r) => r[d.index]), self = M[d.index][d.index];
          showTip(tip, box, e, (t) => tipLines(t, names[d.index], [[color(d.index), 'Led on to something', plural(out, 'time')], [null, 'Came after something', plural(inn, 'time')], [null, 'Straight into more of the same', plural(self, 'time')]]));
        })
        .on('mouseleave', () => { rib.attr('fill-opacity', null); hideTip(tip); });
      // labels outside the ring, flipped on the left so they read upright
      grp.append('text').attr('class', 'axl').attr('dy', '0.35em')
        .attr('transform', (d) => { const a = (d.startAngle + d.endAngle) / 2; return `rotate(${(a * 180) / Math.PI - 90}) translate(${R + 6})${a > Math.PI ? ' rotate(180)' : ''}`; })
        .attr('text-anchor', (d) => ((d.startAngle + d.endAngle) / 2 > Math.PI ? 'end' : 'start'))
        .text((d) => { const s = names[d.index]; const max = phone ? 11 : by === 'author' ? 15 : 16; return d.endAngle - d.startAngle < 0.12 ? '' : s.length > max ? s.slice(0, max - 1) + '…' : s; })
        .each(function (d) { if (linkable(d.index)) link(this, by, names[d.index]); });

      // the side: binge loops and the most common moves
      const pairs = [];
      names.forEach((a, i) => names.forEach((b, j) => { if (M[i][j]) pairs.push({ i, j, n: M[i][j] }); }));
      const item = (p) => {
        const li = el('li'), t = el('span', 'ttl');
        const c = (i) => (linkable(i) ? chip(by, names[i]) : el('span', 'chip', names[i]));
        t.append(c(p.i));
        if (p.i !== p.j) t.append(' → ', c(p.j));
        li.append(t, el('span', 'meta', plural(p.n, 'time')));
        return li;
      };
      const section = (title, list, empty) => {
        side.append(el('h3', null, title));
        const ul = el('ul', 'rh-list');
        if (list.length) ul.append(...list.map(item)); else ul.append(el('li', 'ch-none', empty));
        side.append(ul);
      };
      const loops = pairs.filter((p) => p.i === p.j && p.n > 1 && linkable(p.i)).sort((a, b) => b.n - a.n).slice(0, 4);
      const hops = pairs.filter((p) => p.i !== p.j && p.n > 1 && linkable(p.i) && linkable(p.j)).sort((a, b) => b.n - a.n).slice(0, 5);
      // palate cleansers: something you read in between two of the same, A → B → A
      const cleanse = new Map();
      for (let k = 1; k < rows.length; k++) {
        const a = key(rows[k - 1], 'from'), b = key(rows[k], 'from'), c = key(rows[k], 'to');
        if (a === c && b !== a && linkable(idx(b))) { const s = idx(b); cleanse.set(s, (cleanse.get(s) || 0) + 1); }
      }
      const cl = [...cleanse].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i, n]) => ({ i, j: i, n }));
      section('Binge loops', loops, `No ${by} read twice in a row yet.`);
      section('Most common moves', hops, 'No move made more than once yet.');
      section('Palate cleansers', cl, 'None yet.');
      side.append(el('p', 'note', by === 'genre' ? 'Palate cleansers: a genre you read between two of the same kind, like a horror between two mysteries.'
        : 'Palate cleansers: an author you read between two books by the same other author.'));
    },
  });
})();
