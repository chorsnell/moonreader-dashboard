// Seasons: reading by month of the year averaged across years, and weekday × month.
(() => {
  const { el, fmt, C, svgIn, showTip, hideTip, tipLines, mins } = rh;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY = 864e5;

  // every calendar day from the first to the last day with minutes logged, with that day's minutes
  function loggedDays(daily) {
    const per = new Map();
    daily.forEach((d) => { if (d.minutes) per.set(d.date, (per.get(d.date) || 0) + d.minutes); });
    const keys = [...per.keys()].sort();
    if (!keys.length) return [];
    const out = [];
    for (let t = Date.parse(keys[0] + 'T00:00:00Z'), end = Date.parse(keys[keys.length - 1] + 'T00:00:00Z'); t <= end; t += DAY) {
      const d = new Date(t), date = d.toISOString().slice(0, 10);
      out.push({ date, month: d.getUTCMonth(), weekday: (d.getUTCDay() + 6) % 7, minutes: per.get(date) || 0 });
    }
    return out;
  }

  dash.calc('seasons_month', {
    inputs: ['daily', 'reads'], title: 'Reading by month of the year',
    description: 'For each calendar month, average minutes read per day and hours per month across every year of the timed log, and books finished in that month over all years.',
    fn: (daily, reads) => {
      const days = loggedDays(daily);
      return MONTHS.map((name, i) => {
        const v = days.filter((d) => d.month === i), total = v.reduce((a, d) => a + d.minutes, 0);
        const years = new Set(v.map((d) => d.date.slice(0, 4))).size;
        return {
          month: i + 1, name, days: v.length, years,
          avg_minutes: v.length ? Math.round((total / v.length) * 10) / 10 : 0,
          // a full month's worth at that daily average
          avg_hours: v.length ? Math.round(((total / v.length) * new Date(Date.UTC(2001, i + 1, 0)).getUTCDate()) / 6) / 10 : 0,
          finished: reads.filter((r) => r.finished === true && +r.end.slice(5, 7) === i + 1).length,
        };
      });
    },
  });

  dash.calc('seasons_grid', {
    inputs: ['daily'], title: 'Weekday × month',
    description: 'Average minutes read per calendar day for each weekday in each month of the year, across the timed log.',
    fn: (daily) => {
      const days = loggedDays(daily), out = [];
      DAYS.forEach((weekday, w) => MONTHS.forEach((name, m) => {
        const v = days.filter((d) => d.month === m && d.weekday === w);
        out.push({ weekday, month: m + 1, name, days: v.length, read: v.filter((d) => d.minutes > 0).length,
          avg_minutes: v.length ? Math.round((v.reduce((a, d) => a + d.minutes, 0) / v.length) * 10) / 10 : null });
      }));
      return out;
    },
  });

  const per = (v) => (v == null ? '—' : `${fmt(Math.round(v))} min a day`);

  rh.card({
    tab: 'timeline', id: 'seasons-polar', title: 'Through the year', wide: false, after: 'card-week', calc: 'seasons_month',
    note: 'Average minutes read per day in each month, across every year of the log. Longer wedges, more reading.',
    draw(box, rows) {
      if (!rows.some((r) => r.days)) { box.replaceChildren(el('div', 'dy-empty', 'No timed reading yet.')); return; }
      const w0 = Math.max(280, box.clientWidth), h = Math.min(380, Math.max(280, w0 * 0.9));
      box.style.minHeight = h + 'px';
      const { svg, w, tip } = svgIn(box, h);
      const R = Math.min(w, h) / 2 - 26, r0 = R * 0.18, cx = w / 2, cy = h / 2;
      const max = d3.max(rows, (r) => r.avg_minutes) || 1;
      const y = d3.scaleRadial([0, max], [r0, R]).nice();
      const a = d3.scaleBand(rows.map((r) => r.month), [0, 2 * Math.PI]).padding(0.08);
      const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);
      // rings
      const ticks = y.ticks(3).filter((t) => t > 0);
      g.append('g').selectAll('circle').data(ticks).join('circle').attr('r', y).attr('fill', 'none').attr('stroke', 'var(--cds-chart-grid)');
      const ringLbl = () => g.append('g').selectAll('text').data(ticks).join('text').attr('class', 'axl sn-ring').attr('x', 3).attr('y', (t) => -y(t) - 3).text((t) => t + ' min');
      const arc = d3.arc().innerRadius(r0).outerRadius((r) => y(r.avg_minutes)).startAngle((r) => a(r.month)).endAngle((r) => a(r.month) + a.bandwidth()).padRadius(r0).cornerRadius(3);
      const best = d3.max(rows, (r) => r.avg_minutes);
      g.append('g').selectAll('path').data(rows).join('path').attr('d', arc)
        .attr('fill', C[0]).attr('fill-opacity', (r) => (r.avg_minutes === best ? 1 : 0.65));
      ringLbl();
      const mid = (r) => a(r.month) + a.bandwidth() / 2;
      g.append('g').selectAll('text').data(rows).join('text').attr('class', 'axl')
        .attr('x', (r) => Math.sin(mid(r)) * (R + 14)).attr('y', (r) => -Math.cos(mid(r)) * (R + 14))
        .attr('dy', '0.35em').attr('text-anchor', 'middle').text((r) => r.name);
      const hit = d3.arc().innerRadius(0).outerRadius(R + 20).startAngle((r) => a(r.month) - (a.step() - a.bandwidth()) / 2).endAngle((r) => a(r.month) + a.bandwidth() + (a.step() - a.bandwidth()) / 2);
      g.append('g').selectAll('path').data(rows).join('path').attr('d', hit).attr('fill', 'transparent')
        .on('mousemove', (e, r) => showTip(tip, box, e, (t) => tipLines(t, LONG[r.month - 1], [
          [C[0], 'Average', per(r.avg_minutes)], [null, 'A month at that pace', r.avg_hours ? `${r.avg_hours} h` : '—'],
          [null, 'Books finished', `${fmt(r.finished)} over ${r.years} year${r.years === 1 ? '' : 's'}`]])))
        .on('mouseleave', () => hideTip(tip));
      const top = rows.slice().sort((p, q) => q.avg_minutes - p.avg_minutes), lo = top[top.length - 1];
      box.parentElement.querySelector('.note').textContent =
        `Average minutes read per day in each month, across every year of the log. Busiest: ${LONG[top[0].month - 1]} (${per(top[0].avg_minutes)}); quietest: ${LONG[lo.month - 1]} (${per(lo.avg_minutes)}).`;
    },
  });

  rh.card({
    tab: 'timeline', id: 'seasons-grid', title: 'Weekday × month', wide: false, after: 'card-seasons-polar', calc: 'seasons_grid',
    note: 'Average minutes read on each weekday in each month of the year. Weekends in summer, weeknights in winter?',
    draw(box, rows) {
      if (!rows.some((r) => r.days)) { box.replaceChildren(el('div', 'dy-empty', 'No timed reading yet.')); return; }
      const w0 = Math.max(280, box.clientWidth), lab = 32, top = 18;
      const cs = Math.max(14, Math.min(34, Math.floor((w0 - lab) / 12) - 2)), cell = cs + 2;
      const h = top + 7 * cell + 30;
      box.style.minHeight = h + 'px';
      const { svg, tip } = svgIn(box, h);
      const vals = rows.map((r) => r.avg_minutes).filter((v) => v > 0).sort(d3.ascending);
      const max = d3.quantile(vals, 0.95) || 1, op = d3.scaleSqrt([0, max], [0.12, 1]).clamp(true);
      MONTHS.forEach((m, i) => svg.append('text').attr('class', 'axl').attr('x', lab + i * cell + cs / 2).attr('y', 12).attr('text-anchor', 'middle').text(cs < 22 ? m[0] : m));
      DAYS.forEach((d, i) => svg.append('text').attr('class', 'axl').attr('x', 0).attr('y', top + i * cell + cs / 2).attr('dy', '0.35em').text(d));
      svg.append('g').selectAll('rect').data(rows).join('rect')
        .attr('x', (r) => lab + (r.month - 1) * cell).attr('y', (r) => top + DAYS.indexOf(r.weekday) * cell)
        .attr('width', cs).attr('height', cs).attr('rx', Math.min(4, cs / 4))
        .attr('fill', (r) => (r.avg_minutes > 0 ? C[0] : 'var(--cds-chart-grid)'))
        .attr('fill-opacity', (r) => (r.avg_minutes > 0 ? op(r.avg_minutes) : 1))
        .on('mousemove', (e, r) => showTip(tip, box, e, (t) => tipLines(t, `${r.weekday}s in ${LONG[r.month - 1]}`, [
          [C[0], 'Average', r.avg_minutes ? mins(r.avg_minutes) + ' a day' : '—'], [null, 'Read on', `${fmt(r.read)} of ${fmt(r.days)} days`]])))
        .on('mouseleave', () => hideTip(tip));
      const lg = svg.append('g').attr('transform', `translate(${lab},${top + 7 * cell + 12})`);
      lg.append('text').attr('class', 'axl').attr('y', 6).attr('dy', '0.35em').text('Less');
      [0, 0.25, 0.5, 0.75, 1].forEach((f, i) => lg.append('rect').attr('x', 32 + i * 14).attr('width', 11).attr('height', 11).attr('rx', 2)
        .attr('fill', f ? C[0] : 'var(--cds-chart-grid)').attr('fill-opacity', f ? op(f * max) : 1));
      lg.append('text').attr('class', 'axl').attr('x', 32 + 5 * 14 + 4).attr('y', 6).attr('dy', '0.35em').text('More');
    },
  });
})();
