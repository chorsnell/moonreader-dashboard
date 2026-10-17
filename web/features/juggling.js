// Juggling index: how many books are on the go each day, and whether juggling slows you down.
(() => {
  const { el, fmt, C, svgIn, showTip, hideTip, tipLines, axis, legend, gColor, links, pDate, fDay, fShort, plural } = rh;
  const DAY = 864e5, ms = (s) => Date.parse(s + 'T00:00:00Z'), isoOf = (t) => new Date(t).toISOString().slice(0, 10);
  // a read is on the go every day from its first to its last day; single-day dips don't count
  const spans = (reads) => reads.filter((r) => r.days_read !== 1);

  dash.calc('juggling_days', {
    inputs: ['reads', 'daily'], title: 'Books on the go per day',
    description: 'For every day from the first read to the last, how many reads were on the go (between their first and last day; single-day dips left out) and how many books were actually opened.',
    fn: (reads, daily) => {
      const rs = spans(reads);
      if (!rs.length) return [];
      const lo = rs.reduce((a, r) => Math.min(a, ms(r.start)), Infinity);
      const hi = Math.max(rs.reduce((a, r) => Math.max(a, ms(r.end)), 0), daily.reduce((a, d) => Math.max(a, ms(d.date)), 0));
      const n = Math.round((hi - lo) / DAY) + 1, onGo = new Array(n).fill(0), opened = new Array(n).fill(0);
      rs.forEach((r) => { for (let i = (ms(r.start) - lo) / DAY; i <= (ms(r.end) - lo) / DAY; i++) onGo[i]++; });
      const seen = new Set();
      daily.forEach((d) => { const k = d.date + '|' + d.book_id; if (!seen.has(k)) { seen.add(k); opened[(ms(d.date) - lo) / DAY]++; } });
      return onGo.map((v, i) => ({ date: isoOf(lo + i * DAY), on_go: v, opened: opened[i] }));
    },
  });

  dash.calc('juggling_reads', {
    inputs: ['reads', 'daily', 'juggling_days'], title: 'Juggling and pace per read',
    description: 'For each finished read of 3+ days: the share of its days with another book on the go, its calendar days, words read and calendar days per 100,000 words.',
    fn: (reads, daily, days) => {
      const at = new Map(days.map((d) => [d.date, d.on_go])), words = new Map();
      daily.forEach((d) => words.set(d.book_id + '|' + d.date, (words.get(d.book_id + '|' + d.date) || 0) + (d.words || 0)));
      return reads.filter((r) => r.finished === true && r.days_read >= 3).map((r) => {
        let n = 0, juggled = 0, w = 0;
        for (let t = ms(r.start); t <= ms(r.end); t += DAY) {
          const s = isoOf(t); n++;
          if ((at.get(s) || 0) > 1) juggled++;
          w += words.get(r.book_id + '|' + s) || 0;
        }
        return { read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre, start: r.start, end: r.end,
          days: n, juggled_share: Math.round((juggled / n) * 1000) / 1000, words: w, days_per_100k: w >= 10000 ? Math.round((n / w) * 1e6) / 10 : null };
      });
    },
  });

  const BANDS = [[1, 'One book', C[0]], [2, 'Two', C[1]], [3, 'Three or more', C[3]]];
  const band = (v) => (v >= 3 ? 3 : v);

  rh.card({
    tab: 'timeline', id: 'juggling', title: 'Juggling index', after: 'card-gantt', calc: 'juggling_days',
    note: 'How many books you had on the go each day, as a share of each month. A book is on the go from the first to the last day of a read.',
    draw(box, days, parts) {
      if (!days.length) { box.replaceChildren(el('div', 'dy-empty', 'No reads yet.')); return; }
      const any = days.filter((d) => d.on_go > 0), multi = any.filter((d) => d.on_go > 1);
      const peak = days.reduce((a, d) => (d.on_go > a.on_go ? d : a), days[0]);
      const avg = d3.mean(any, (d) => d.on_go) || 0;
      // headline figures above the chart, rebuilt each draw
      let kp = parts.card.querySelector('.jg-kpis');
      if (!kp) { kp = el('div', 'dy-sum jg-kpis'); parts.note.after(kp); }
      const stat = (v, l) => { const d = el('div'); d.append(el('b', null, v), el('span', null, l)); return d; };
      kp.replaceChildren(stat(avg ? avg.toFixed(2) : '—', 'books on the go, on average'), stat(any.length ? Math.round((multi.length / any.length) * 100) + '%' : '—', 'of days juggling two or more'),
        stat(fmt(peak.on_go), `most at once, ${fDay(pDate(peak.date))}`), stat(avg < 1.2 ? 'One at a time' : avg < 1.6 ? 'Light juggler' : 'Juggler', 'your style'));
      let lg = parts.card.querySelector('.legend');
      if (!lg) { lg = el('div', 'legend'); box.before(lg); }
      legend(lg, BANDS.map(([, n, c]) => [c, n]));
      const months = d3.groups(days, (d) => d.date.slice(0, 7)).map(([m, v]) => {
        const o = { month: m, days: v.length, none: v.filter((d) => !d.on_go).length, avg: d3.mean(v.filter((d) => d.on_go), (d) => d.on_go) || 0 };
        BANDS.forEach(([k]) => (o[k] = v.filter((d) => d.on_go && band(d.on_go) === k).length));
        return o;
      });
      const h = 220, { svg, w, tip } = svgIn(box, h), m = { t: 10, r: 6, b: 24, l: 36 };
      box.style.minHeight = h + 'px';
      const x = d3.scaleBand(months.map((r) => r.month), [m.l, w - m.r]).padding(0.12);
      const y = d3.scaleLinear([0, 1], [h - m.b, m.t]);
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4, '.0%').tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      const jan = months.filter((r) => r.month.endsWith('-01')).map((r) => r.month), step = Math.ceil(jan.length / Math.max(1, Math.floor((w - m.l) / 46)));
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues(jan.filter((_, i) => i % step === 0)).tickFormat((s) => s.slice(0, 4)).tickSize(0).tickPadding(8));
      const stack = d3.stack().keys(BANDS.map(([k]) => k)).value((r, k) => r[k] / r.days)(months);
      svg.append('g').selectAll('g').data(stack).join('g').attr('fill', (s, i) => BANDS[i][2])
        .selectAll('rect').data((s) => s).join('rect').attr('x', (d) => x(d.data.month)).attr('width', x.bandwidth())
        .attr('y', (d) => y(d[1])).attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])));
      svg.append('g').selectAll('rect').data(months).join('rect').attr('x', (d) => x(d.month) - (x.step() - x.bandwidth()) / 2).attr('width', x.step())
        .attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
        .on('mousemove', (e, d) => showTip(tip, box, e, (t) => tipLines(t, fShort(pDate(d.month + '-01')), [
          ...BANDS.map(([k, n, c]) => [c, n, plural(d[k], 'day')]), [null, 'Nothing on the go', plural(d.none, 'day')], [null, 'Average on the go', d.avg ? d.avg.toFixed(2) : '—']])))
        .on('mouseleave', () => hideTip(tip));
    },
  });

  rh.card({
    tab: 'timeline', id: 'juggling-pace', title: 'Does juggling slow you down?', after: 'card-juggling', calc: 'juggling_reads',
    note: 'Each finished read: how much of it overlapped another book, against calendar days per 100,000 words.',
    draw(box, reads, parts) {
      const rows = reads.filter((r) => r.days_per_100k != null);
      if (rows.length < 3) { box.style.minHeight = '80px'; box.replaceChildren(el('div', 'dy-empty', 'Not enough finished reads with words logged yet.')); return; }
      const solo = rows.filter((r) => r.juggled_share < 0.5), jug = rows.filter((r) => r.juggled_share >= 0.5);
      const med = (v) => d3.median(v, (r) => r.days_per_100k);
      const ms0 = med(solo), mj = med(jug);
      let verdict = 'Too few juggled reads to tell yet.';
      if (solo.length >= 2 && jug.length >= 2) {
        const d = mj / ms0 - 1;
        verdict = Math.abs(d) < 0.1 ? `Juggling makes little difference: about ${fmt(Math.round(ms0))} days per 100,000 words either way.`
          : `Books you juggled took ${Math.round(Math.abs(d) * 100)}% ${d > 0 ? 'longer' : 'less time'} per word (median ${fmt(Math.round(mj))} vs ${fmt(Math.round(ms0))} days per 100,000 words).`;
      }
      parts.note.textContent = `Each finished read: how much of it overlapped another book, against calendar days per 100,000 words. ${verdict}`;
      const h = 280, { svg, w, tip } = svgIn(box, h), m = { t: 12, r: 12, b: 34, l: 40 };
      box.style.minHeight = h + 'px';
      const x = d3.scaleLinear([0, 1], [m.l, w - m.r]);
      const y = d3.scaleLog([Math.max(1, d3.min(rows, (r) => r.days_per_100k) * 0.8), d3.max(rows, (r) => r.days_per_100k) * 1.2], [h - m.b, m.t]);
      axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(4, '~s').tickSize(-(w - m.l - m.r)));
      svg.select('.domain').remove();
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(5, '.0%').tickSizeOuter(0));
      svg.append('text').attr('class', 'axl').attr('x', w - m.r).attr('y', h - 2).attr('text-anchor', 'end').text('share of the read with another book on the go →');
      svg.append('text').attr('class', 'axl').attr('x', m.l + 4).attr('y', m.t + 4).attr('dy', '0.35em').text('days per 100k words');
      svg.append('line').attr('x1', x(0.5)).attr('x2', x(0.5)).attr('y1', m.t).attr('y2', h - m.b).attr('stroke', 'var(--cds-chart-axis)').attr('stroke-dasharray', '4 3');
      [[solo, 0, 0.5], [jug, 0.5, 1]].forEach(([v, a, b]) => {
        const md = med(v); if (md == null || v.length < 2) return;
        svg.append('line').attr('x1', x(a) + 4).attr('x2', x(b) - 4).attr('y1', y(md)).attr('y2', y(md)).attr('stroke', 'var(--color-fg-muted)').attr('stroke-width', 1.5);
        svg.append('text').attr('class', 'axl').attr('x', x(b) - 6).attr('y', y(md) - 5).attr('text-anchor', 'end').text(`median ${fmt(Math.round(md))}`);
      });
      // spread dots sitting on 0% a little so they don't stack
      const jit = (r) => (r.juggled_share === 0 ? ((r.read_id.length * 37) % 17) / 600 : 0);
      svg.append('g').selectAll('circle').data(rows).join('circle').attr('cx', (r) => x(r.juggled_share + jit(r))).attr('cy', (r) => y(r.days_per_100k)).attr('r', 5)
        .attr('fill', (r) => gColor(r.genre)).attr('fill-opacity', 0.8).attr('stroke', 'var(--color-panel)').call(links, 'book', (r) => r.book_id)
        .on('mousemove', (e, r) => showTip(tip, box, e, (t) => tipLines(t, r.title, [[gColor(r.genre), r.genre, ''],
          [null, 'Dates', `${fDay(pDate(r.start))} – ${fDay(pDate(r.end))}`], [null, 'Calendar days', fmt(r.days)], [null, 'Words', fmt(r.words)],
          [null, 'Days per 100k words', fmt(r.days_per_100k)], [null, 'Juggled', Math.round(r.juggled_share * 100) + '% of days']])))
        .on('mouseleave', () => hideTip(tip));
    },
  });
})();
