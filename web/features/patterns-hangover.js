// Book hangover: the gap between finishing a book and opening the next, and whether it's
// longer after books you devoured. No ratings yet, so "devoured" means finished quickly for
// its length (calendar days per 100,000 words, fastest quarter of your reads).
(() => {
  const { el, gColor, svgIn, showTip, hideTip, tipLines, axis, links, linkBook, byline, cover, pDate, fDay, plural } = rh;
  rh.tab('patterns', 'Patterns', { after: 'timeline' });
  const DAY = 864e5, ms = (s) => Date.parse(s + 'T00:00:00Z'), days = (a, b) => Math.round((ms(b) - ms(a)) / DAY);

  dash.calc('hangovers', {
    inputs: ['reads', 'daily'], title: 'Book hangovers',
    description: 'For each finished read: days without opening another book afterwards (0 = straight on), the book you went to next, and how quickly it was read (calendar days per 100,000 words) as a stand-in for how much you loved it, grouped into devoured, steady and slow burn.',
    fn: (reads, daily) => {
      const byDate = d3.groups(daily, (d) => d.date).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const dates = byDate.map(([d]) => d);
      const words = new Map();
      daily.forEach((d) => words.set(d.book_id + '|' + d.date, (words.get(d.book_id + '|' + d.date) || 0) + (d.words || 0)));
      const out = reads.filter((r) => r.finished === true && r.days_read !== 1).map((r) => {
        // the first day after (or on) the finish when a different book was opened
        let i = d3.bisectLeft(dates, r.end), next = null;
        for (; i < byDate.length && !next; i++) {
          const other = byDate[i][1].filter((d) => d.book_id !== r.book_id).sort((a, b) => (b.minutes || 0) - (a.minutes || 0))[0];
          if (other) next = { date: byDate[i][0], book_id: other.book_id, title: other.title };
        }
        let w = 0;
        for (let t = ms(r.start); t <= ms(r.end); t += DAY) w += words.get(r.book_id + '|' + new Date(t).toISOString().slice(0, 10)) || 0;
        const span = days(r.start, r.end) + 1;
        return { read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre, start: r.start, end: r.end, days: span, words: w,
          days_per_100k: w >= 10000 ? Math.round((span / w) * 1e6) / 10 : null,
          gap_days: next ? Math.max(0, days(r.end, next.date) - 1) : null, next_book: next ? next.book_id : null, next_title: next ? next.title : null, next_date: next ? next.date : null };
      });
      // quartiles of pace among reads with enough words
      const paced = out.filter((r) => r.days_per_100k != null).map((r) => r.days_per_100k).sort(d3.ascending);
      const q1 = d3.quantile(paced, 0.25), q3 = d3.quantile(paced, 0.75);
      out.forEach((r) => (r.pace = r.days_per_100k == null || paced.length < 4 ? null : r.days_per_100k <= q1 ? 'devoured' : r.days_per_100k >= q3 ? 'slow' : 'steady'));
      return out.sort((a, b) => (a.end < b.end ? -1 : 1));
    },
  });

  const PACE = [['devoured', 'Devoured', 'fastest quarter for their length'], ['steady', 'Steady', 'the middle half'], ['slow', 'Slow burn', 'slowest quarter']];
  const dur = (d) => (d === 0 ? 'straight on' : plural(d, 'day'));

  rh.card({
    tab: 'patterns', id: 'hangover', title: 'Book hangover', calc: 'hangovers', before: 'card-heat-explorer',
    note: 'Days without opening another book after finishing one, split by how fast you got through the book you’d just finished.',
    draw(box, all, parts) {
      const rows = all.filter((r) => r.gap_days != null);
      let kp = parts.card.querySelector('.hg-kpis');
      if (!kp) { kp = el('div', 'dy-sum hg-kpis'); parts.note.after(kp); }
      let longBox = parts.card.querySelector('.hg-long');
      if (!longBox) { longBox = el('div', 'hg-long'); box.after(longBox); }
      if (rows.length < 3) { kp.replaceChildren(); longBox.replaceChildren(); box.style.minHeight = '80px'; box.replaceChildren(el('div', 'dy-empty', 'Not enough finished books yet.')); return; }
      const med = (v) => d3.median(v, (r) => r.gap_days), longest = rows.reduce((a, r) => (r.gap_days > a.gap_days ? r : a), rows[0]);
      const straight = rows.filter((r) => r.gap_days === 0).length;
      const stat = (v, l) => { const d = el('div'); d.append(el('b', null, v), el('span', null, l)); return d; };
      kp.replaceChildren(stat(dur(Math.round(med(rows))), 'typical gap before the next book'), stat(Math.round((straight / rows.length) * 100) + '%', 'of finishes went straight into another book'),
        linkBook(stat(plural(longest.gap_days, 'day'), `longest, after ${longest.title}`), longest.book_id));
      const groups = PACE.map(([k, name, hint]) => ({ k, name, hint, v: rows.filter((r) => r.pace === k) })).filter((g) => g.v.length);
      const dv = groups.find((g) => g.k === 'devoured'), rest = rows.filter((r) => r.pace && r.pace !== 'devoured');
      let verdict = '';
      if (dv && dv.v.length >= 2 && rest.length >= 2) {
        const a = med(dv.v), b = med(rest);
        verdict = a === b ? ' After a book you devoured, the gap is about the same as usual.'
          : ` After a book you devoured, the typical gap is ${dur(Math.round(a))}, against ${dur(Math.round(b))} after the rest${a > b ? ': a real hangover' : ''}.`;
      }
      parts.note.textContent = 'Days without opening another book after finishing one, split by how fast you got through the book you’d just finished (calendar days per 100,000 words; there are no ratings yet, so speed stands in for love).' + verdict;

      const rh = 52, m = { t: 6, r: 14, b: 30 }, w0 = Math.max(280, box.clientWidth), lab = w0 < 500 ? 78 : 96, h = m.t + groups.length * rh + m.b;
      box.style.minHeight = h + 'px';
      const { svg, w, tip } = svgIn(box, h);
      const max = Math.max(14, d3.max(rows, (r) => r.gap_days));
      const x = d3.scaleSymlog([0, max], [lab, w - m.r]).constant(1);
      axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).tickValues([0, 1, 3, 7, 14, 30, 90, 365].filter((v) => v <= max)).tickSize(-(h - m.t - m.b)));
      svg.select('.domain').remove();
      svg.append('text').attr('class', 'axl').attr('x', w - m.r).attr('y', h - 2).attr('text-anchor', 'end').text('days without a book →');
      const g = svg.append('g').selectAll('g').data(groups).join('g').attr('transform', (d, i) => `translate(0,${m.t + i * rh + rh / 2})`);
      g.append('text').attr('class', 'lbl-in').attr('x', 0).attr('y', -5).text((d) => d.name);
      g.append('text').attr('class', 'axl').attr('x', 0).attr('y', 10).text((d) => plural(d.v.length, 'book'));
      // books with the same gap stack in little columns of five so every one shows
      const pos = new Map();
      groups.forEach((d) => {
        const seen = new Map();
        d.v.forEach((r) => { const n = seen.get(r.gap_days) || 0; seen.set(r.gap_days, n + 1); pos.set(r, [Math.floor(n / 5) * 7, ((n % 5) - 2) * 7]); });
      });
      g.selectAll('circle').data((d) => d.v).join('circle').attr('cx', (r) => x(r.gap_days) + pos.get(r)[0]).attr('cy', (r) => pos.get(r)[1]).attr('r', 3.5)
        .attr('fill', (r) => gColor(r.genre)).attr('fill-opacity', 0.8).attr('stroke', 'var(--color-panel)').call(links, 'book', (r) => r.book_id)
        .on('mousemove', (e, r) => showTip(tip, box, e, (t) => tipLines(t, r.title, [[gColor(r.genre), r.genre, ''], [null, 'Finished', fDay(pDate(r.end))],
          [null, 'Read in', `${plural(r.days, 'day')} (${r.days_per_100k} per 100k words)`], [null, 'Then', r.gap_days === 0 ? 'straight on' : `${plural(r.gap_days, 'day')} without a book`],
          [null, 'Next', r.next_title || '—']])))
        .on('mouseleave', () => hideTip(tip));
      g.append('line').attr('x1', (d) => x(med(d.v))).attr('x2', (d) => x(med(d.v))).attr('y1', -20).attr('y2', 20).attr('stroke', 'var(--color-fg)').attr('stroke-width', 2).style('pointer-events', 'none');

      // the longest hangovers
      const top = rows.slice().sort((a, b) => b.gap_days - a.gap_days).slice(0, 5).filter((r) => r.gap_days > 0);
      longBox.replaceChildren();
      if (!top.length) return;
      longBox.append(el('h3', null, 'Longest hangovers'));
      const ul = el('ul', 'rh-list');
      ul.append(...top.map((r) => {
        const li = linkBook(el('li', 'hg-item'), r.book_id), t = el('div', 'ttl');
        t.append(el('span', null, r.title), byline('small', null, r, ['author']));
        li.append(cover(r.book_id, r.title, r.genre, 'sm'), t, el('span', 'meta', `${plural(r.gap_days, 'day')}, then ${r.next_title || '—'}`));
        return li;
      }));
      longBox.append(ul);
    },
  });
})();
