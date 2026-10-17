// Book fingerprints: the shape of each read from its minutes per day (the 'fingerprints'
// calc in calcs.js), as a gallery and genre summary on the Genres tab and on book pages.
(() => {
  const { D, el, fmt, pDate, fDay, fShort, svgIn, showTip, hideTip, tipLines, linkBook, ref, chip, mins, plural } = rh;

  const SHAPES = {
    devoured: { name: 'Devoured', color: 'var(--series-2)', about: 'most days, long sittings, done fast' },
    slow_burn: { name: 'Slow burn', color: 'var(--series-3)', about: 'steady, small doses over weeks' },
    stop_start: { name: 'Stop-start', color: 'var(--series-5)', about: 'in bursts, with breaks between' },
    rescued: { name: 'Dropped, then rescued', color: 'var(--series-1)', about: 'put down for a month or more, then finished' },
    abandoned: { name: 'Abandoned', color: 'var(--cds-chart-muted)', about: 'not finished, not opened for 60+ days' },
    reading: { name: 'Still reading', color: 'var(--color-fg-muted)', about: 'not finished, opened lately' },
  };
  const ORDER = ['devoured', 'slow_burn', 'stop_start', 'rescued', 'abandoned'];
  const ok = (id) => { const r = D(id); return r.status === 'ok' ? r.data : null; };
  const lower = (g) => (/[A-Z]{2}/.test(g) ? g : g.toLowerCase());

  // one sentence on why a read got its shape
  function why(f) {
    const days = `read on ${fmt(f.active_days)} of ${plural(f.span_days, 'day')}`, per = `${mins(f.mins_per_day)} a day`;
    if (f.shape === 'rescued') return `Put down for ${plural(f.rescue_gap, 'day')} part way, then finished: ${days}.`;
    if (f.shape === 'devoured') return f.span_days === 1 ? `Read in a single day: ${mins(f.minutes)}.` : `Gone in ${plural(f.span_days, 'day')}: ${days}, ${per} when you read.`;
    if (f.shape === 'stop_start') return `In bursts: ${days}, the longest break ${plural(f.longest_gap, 'day')}.`;
    if (f.shape === 'slow_burn') return `Steady: ${days}, ${per} when you read.`;
    if (f.shape === 'abandoned') return `Left at ${Math.round(f.progress)}% after ${days}.`;
    return `${Math.round(f.progress)}% so far: ${days}.`;
  }

  // minutes per day (or per bin of days) as columns; y is shared when ymax is given
  function spark(box, f, w, h, ymax) {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('class', 'fp-spark'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('preserveAspectRatio', 'none');
    const n = f.spark.length, bw = w / n, gap = bw > 4 ? 1 : 0, top = ymax || d3.max(f.spark) || 1;
    const base = document.createElementNS(ns, 'line');
    Object.entries({ x1: 0, x2: w, y1: h - 0.5, y2: h - 0.5, class: 'fp-base' }).forEach(([k, v]) => base.setAttribute(k, v));
    svg.append(base);
    f.spark.forEach((v, i) => {
      if (!v) return;
      const r = document.createElementNS(ns, 'rect'), bh = Math.max(1.5, (Math.min(v, top) / top) * (h - 2));
      Object.entries({ x: i * bw + gap / 2, width: Math.max(1, bw - gap), y: h - bh, height: bh, rx: Math.min(1.5, bw / 3), fill: SHAPES[f.shape].color })
        .forEach(([k, val]) => r.setAttribute(k, val));
      svg.append(r);
    });
    box.append(svg);
    return svg;
  }

  // ---------- Genres tab: which genres do you devour? ----------
  let pick = 'devoured';
  const expanded = {};
  const GALLERY_CAP = 12;
  rh.card({
    tab: 'genres', id: 'fingerprints', title: 'Book shapes', after: 'card-genre-year', calc: 'fingerprints',
    note: 'Every read sorted by the shape of its minutes per day. Bars show how each genre tends to go; pick a shape below to see its books.',
    draw(box, rows, parts) {
      box.replaceChildren();
      const done = rows.filter((f) => f.shape !== 'reading');
      if (!done.length) { box.append(el('div', 'dy-empty', 'No reads to sort yet.')); return; }
      const order = rh.genres(), genres = d3.groups(done, (f) => f.genre)
        .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99) || b[1].length - a[1].length);

      // the headline: the genre you devour most, and the one you take slowest
      const share = (v, s) => v.filter((f) => f.shape === s).length / v.length;
      const big = genres.filter(([, v]) => v.length >= 3);
      const dev = big.slice().sort((a, b) => share(b[1], 'devoured') - share(a[1], 'devoured'))[0];
      const slow = big.slice().sort((a, b) => share(b[1], 'slow_burn') + share(b[1], 'stop_start') - share(a[1], 'slow_burn') - share(a[1], 'stop_start'))[0];
      const take = el('p', 'fp-take');
      if (dev && share(dev[1], 'devoured') > 0) {
        take.append('You devour ', ref({ genre: dev[0] }, 'genre', lower(dev[0])), ` (${Math.round(share(dev[1], 'devoured') * 100)}% of reads)`);
        if (slow && slow[0] !== dev[0]) take.append(' and take ', ref({ genre: slow[0] }, 'genre', lower(slow[0])), ' slowest');
        take.append('.');
        box.append(take);
      }

      const leg = el('div', 'legend');
      ORDER.forEach((s) => { const i = el('span'), sw = el('i', 'sw'); sw.style.background = SHAPES[s].color; i.append(sw, SHAPES[s].name); i.title = SHAPES[s].about; leg.append(i); });
      box.append(leg);

      // 100% bars per genre
      const bars = el('div', 'fp-bars');
      box.append(bars);
      const bh = 20, gap = 8, h = genres.length * (bh + gap);
      const { svg, w, tip } = svgIn(bars, h);
      const probe = svg.append('text').attr('class', 'axl');
      const lw = Math.min(w * 0.38, d3.max(genres, ([g]) => (probe.text(g), probe.node().getComputedTextLength())) + 12);
      probe.remove();
      const nw = 34, x = d3.scaleLinear([0, 1], [lw, w - nw]);
      const g = svg.selectAll('g.r').data(genres).join('g').attr('transform', (d, i) => `translate(0,${i * (bh + gap)})`);
      g.append('text').attr('class', 'axl').attr('x', lw - 8).attr('y', bh / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(([gn]) => gn)
        .each(function ([gn]) { rh.link(this, 'genre', gn); });
      g.each(function ([gn, v]) {
        let acc = 0;
        ORDER.forEach((s) => {
          const n = v.filter((f) => f.shape === s).length;
          if (!n) return;
          const x0 = x(acc / v.length), x1 = x((acc + n) / v.length);
          acc += n;
          d3.select(this).append('rect').attr('x', x0).attr('width', Math.max(1, x1 - x0 - 2)).attr('y', 0).attr('height', bh).attr('rx', 3)
            .attr('fill', SHAPES[s].color)
            .on('mousemove', (e) => showTip(tip, bars, e, (t) => tipLines(t, gn, ORDER.map((k) => [SHAPES[k].color, SHAPES[k].name, String(v.filter((f) => f.shape === k).length)]).filter((l) => l[2] !== '0').concat([[null, 'Reads', String(v.length)]]))))
            .on('mouseleave', () => hideTip(tip))
            .on('click', () => { pick = s; drawGallery(); parts.card.querySelector('.fp-gallery')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
        });
      });
      g.append('text').attr('class', 'lbl-in').attr('x', w - nw + 6).attr('y', bh / 2).attr('dy', '0.35em').text(([, v]) => fmt(v.length));

      // the gallery: one shape at a time
      const seg = el('div', 'fp-seg');
      seg.setAttribute('role', 'tablist');
      const gal = el('div', 'fp-gallery');
      box.append(seg, gal);
      const ymax = d3.quantile(done.flatMap((f) => f.spark.filter((v) => v > 0)).sort(d3.ascending), 0.95) || 1;
      function drawGallery() {
        seg.replaceChildren(...ORDER.filter((s) => done.some((f) => f.shape === s)).map((s) => {
          const b = el('button', 'fp-tab', `${SHAPES[s].name} ${fmt(done.filter((f) => f.shape === s).length)}`);
          b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(s === pick));
          b.style.setProperty('--fp', SHAPES[s].color);
          b.addEventListener('click', () => { pick = s; drawGallery(); });
          return b;
        }));
        if (!done.some((f) => f.shape === pick)) pick = done[0].shape;
        const these = done.filter((f) => f.shape === pick).sort((a, b) => (a.end < b.end ? 1 : -1));
        const shown = expanded[pick] ? these : these.slice(0, GALLERY_CAP);
        gal.replaceChildren(el('p', 'note', SHAPES[pick].name + ': ' + SHAPES[pick].about + '.'));
        const grid = el('div', 'fp-grid');
        shown.forEach((f) => {
          const t = linkBook(el('div', 'fp-tile'), f.book_id);
          t.title = why(f);
          spark(t, f, 120, 30, ymax);
          const meta = el('div', 'fp-meta');
          meta.append(el('b', null, (f.read_no > 1 ? '↻ ' : '') + f.title), el('small', null, `${plural(f.span_days, 'day')} · ${fShort(pDate(f.end))}`));
          t.append(meta);
          grid.append(t);
        });
        gal.append(grid);
        if (these.length > shown.length) {
          const more = el('button', 'fp-more', `Show all ${fmt(these.length)}`);
          more.addEventListener('click', () => { expanded[pick] = true; drawGallery(); });
          gal.append(more);
        }
      }
      drawGallery();
    },
  });

  // ---------- book pages: the shape of each read ----------
  rh.bookCard({
    id: 'bk-shape', title: 'Shape of the read', calc: 'fingerprints', after: 'card-bk-days', chartClass: 'fp-box',
    draw(box, rows, parts, b) {
      const mine = rows.filter((f) => f.book_id === b.id).sort((x, y) => x.read_no - y.read_no);
      if (!mine.length) return false;
      parts.note.hidden = false;
      parts.note.textContent = 'Minutes read per day from first to last day' + (mine.some((f) => f.bin_days > 1) ? ' (long reads are grouped into spans of days)' : '') + '.';
      const same = (f) => rows.filter((x) => x.genre === f.genre && x.shape !== 'reading');
      const bw = Math.max(240, box.clientWidth);
      box.replaceChildren(...mine.map((f) => {
        const row = el('div', 'fp-row');
        const head = el('div', 'fp-head');
        const c = el('span', 'chip fp-chip', SHAPES[f.shape].name);
        c.style.setProperty('--fp', SHAPES[f.shape].color);
        if (mine.length > 1) head.append(el('b', null, `Read ${f.read_no} · ${fShort(pDate(f.start))}`));
        head.append(c);
        row.append(head);
        const w = Math.min(bw, Math.max(180, f.spark.length * 24)), sp = el('div', 'fp-wrap');
        sp.style.maxWidth = w + 'px';
        spark(sp, f, w, 48);
        const ends = el('div', 'fp-ends');
        ends.append(el('span', null, fDay(pDate(f.start))), el('span', null, fDay(pDate(f.end))));
        sp.append(ends);
        row.append(sp);
        const p = el('p', 'fp-why', why(f) + ' ');
        const g = same(f), n = g.filter((x) => x.shape === f.shape).length;
        if (f.shape !== 'reading' && g.length >= 3) p.append(`${fmt(n)} of your ${fmt(g.length)} `, chip('genre', f.genre), ` reads went this way.`);
        row.append(p);
        return row;
      }));
    },
  });
})();
