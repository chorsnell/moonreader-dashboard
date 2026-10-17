// Time-of-day reading clock: when in the day you read, using the times of your highlights,
// notes and bookmarks as a stand-in (Moon+'s reading log only records days).
(() => {
  const { el, fmt, svgIn, showTip, hideTip, tipLines } = rh;

  const PARTS = [
    { id: 'morning', label: 'Morning', hours: [5, 12], verdict: 'Morning reader' },
    { id: 'afternoon', label: 'Afternoon', hours: [12, 17], verdict: 'Afternoon reader' },
    { id: 'evening', label: 'Evening', hours: [17, 21], verdict: 'Evening reader' },
    { id: 'night', label: 'Night', hours: [21, 29], verdict: 'Night owl' }, // 21:00 to 05:00
  ];
  const inPart = (p, h) => (h >= p.hours[0] && h < p.hours[1]) || (h + 24 >= p.hours[0] && h + 24 < p.hours[1]);
  const hh = (h) => String(h).padStart(2, '0') + ':00';

  dash.calc('reading_clock', {
    inputs: ['highlights'],
    title: 'Highlights by hour of day',
    description: 'Highlights, notes and bookmarks made in each hour (local time), on weekdays and at weekends.',
    fn: (highlights) => {
      const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, weekday: 0, weekend: 0 }));
      for (const h of highlights) {
        if (!h.time) continue;
        const d = new Date(h.time), day = d.getDay();
        rows[d.getHours()][day === 0 || day === 6 ? 'weekend' : 'weekday']++;
      }
      return rows;
    },
  });

  rh.card({
    tab: 'timeline',
    id: 'clock',
    title: 'Reading clock',
    calc: 'reading_clock',
    after: 'card-week',
    hidden: () => { const d = rh.D('reading_clock'); return d.status === 'ok' && d3.sum(d.data, (r) => r.weekday + r.weekend) < 5; },
    draw(box, rows, parts) {
      const total = d3.sum(rows, (r) => r.weekday + r.weekend);
      if (total < 5) return;
      parts.note.hidden = false;
      parts.note.textContent = `When in the day you made your ${fmt(total)} highlights, notes and bookmarks. ` +
        'Moon+ only logs which days you read, so this stands in for when you read. Midnight is at the top.';

      box.replaceChildren();
      box.classList.add('ck-box');
      const dial = el('div', 'ck-dial'), side = el('div', 'ck-side');
      box.append(dial, side);

      // the dial: a bar per hour, weekdays inside weekends
      const size = Math.min(340, Math.max(240, box.clientWidth < 560 ? box.clientWidth : 340));
      dial.style.width = size + 'px';
      const { svg, tip } = svgIn(dial, size);
      svg.attr('viewBox', `0 0 ${size} ${size}`).attr('width', size);
      const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`);
      const inner = size * 0.17, outer = size / 2 - 22;
      const max = d3.max(rows, (r) => r.weekday + r.weekend) || 1;
      const r = d3.scaleRadial([0, max], [inner, outer]);
      const angle = (h) => (h / 24) * 2 * Math.PI;
      const arc = d3.arc().padAngle(0.025).padRadius(inner).cornerRadius(2);
      [1, 0.5].forEach((f) => g.append('circle').attr('r', r(max * f)).attr('fill', 'none').attr('stroke', 'var(--cds-chart-grid)').attr('stroke-dasharray', '2 3'));
      g.append('circle').attr('r', inner).attr('fill', 'none').attr('stroke', 'var(--cds-chart-grid)');
      const seg = g.append('g').selectAll('g').data(rows).join('g');
      seg.append('path').attr('fill', 'var(--series-1)')
        .attr('d', (d) => arc({ innerRadius: inner, outerRadius: r(d.weekday), startAngle: angle(d.hour), endAngle: angle(d.hour + 1) }));
      seg.append('path').attr('fill', 'var(--series-2)')
        .attr('d', (d) => arc({ innerRadius: r(d.weekday), outerRadius: r(d.weekday + d.weekend), startAngle: angle(d.hour), endAngle: angle(d.hour + 1) }));
      // hour labels
      g.append('g').selectAll('text').data([0, 3, 6, 9, 12, 15, 18, 21]).join('text')
        .attr('class', 'axl').attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('x', (h) => Math.sin(angle(h)) * (outer + 12)).attr('y', (h) => -Math.cos(angle(h)) * (outer + 12))
        .text((h) => hh(h).slice(0, 2));
      // hover: the hour under the pointer
      seg.append('path').attr('fill', 'transparent')
        .attr('d', (d) => d3.arc()({ innerRadius: inner, outerRadius: outer, startAngle: angle(d.hour), endAngle: angle(d.hour + 1) }))
        .on('mousemove', (e, d) => showTip(tip, dial, e, (t) => tipLines(t, `${hh(d.hour)}–${hh((d.hour + 1) % 24)}`,
          [['var(--series-1)', 'Weekdays', fmt(d.weekday)], ['var(--series-2)', 'Weekends', fmt(d.weekend)]])))
        .on('mouseleave', () => hideTip(tip));

      // the verdict and the parts of the day
      const shares = PARTS.map((p) => ({ ...p, n: d3.sum(rows.filter((x) => inPart(p, x.hour)), (x) => x.weekday + x.weekend) }));
      const best = shares.reduce((a, b) => (b.n > a.n ? b : a));
      const peak = rows.reduce((a, b) => (b.weekday + b.weekend > a.weekday + a.weekend ? b : a));
      side.append(el('div', 'ck-verdict', best.verdict));
      side.append(el('div', 'ck-sub', `Busiest hour ${hh(peak.hour)}–${hh((peak.hour + 1) % 24)}`));
      const list = el('dl', 'ck-parts');
      shares.forEach((p) => {
        const pc = Math.round((p.n / total) * 100), bar = el('div', 'pbar'), fill = el('i');
        fill.style.width = pc + '%'; fill.style.background = p === best ? 'var(--series-1)' : 'var(--cds-chart-muted)';
        bar.append(fill);
        const dd = el('dd'); dd.append(bar, el('b', null, pc + '%'));
        list.append(el('dt', null, `${p.label} ${hh(p.hours[0] % 24).slice(0, 2)}–${hh(p.hours[1] % 24).slice(0, 2)}`), dd);
      });
      side.append(list);
      const wk = d3.sum(rows, (x) => x.weekday), we = total - wk;
      const legend = el('div', 'legend ck-legend');
      [['var(--series-1)', `Weekdays (${fmt(wk)})`], ['var(--series-2)', `Weekends (${fmt(we)})`]].forEach(([c, n]) => {
        const s = el('span'), i = el('i', 'sw'); i.style.background = c; s.append(i, n); legend.append(s);
      });
      side.append(legend);
    },
  });
})();
