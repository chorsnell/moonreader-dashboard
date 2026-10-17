// Buddy-read race (BOO-32): on a book's page, your progress and that of every friend who
// read the same book, one line ("lane") each. By date when the reads overlap (you read it
// together), otherwise from each one's first day, so reads years apart still race.
// rh.raceLanes draws the lanes; book clubs (BOO-58) use it too, with a schedule line.
(() => {
  const { el, fmt, svgIn, axis, showTip, hideTip, tipLines, MARK, plural, pDate, fDay } = rh;
  const DAY = 864e5;
  const dayNo = (s) => Math.round(Date.parse(String(s).slice(0, 10)) / DAY);

  // one person's latest read of a book as progress points: [{ date, progress, minutes, words }]
  function lane(reads, daily, bookId) {
    const r = reads.filter((x) => x.book_id === bookId).sort((a, b) => (a.start < b.start ? 1 : -1))[0];
    if (!r) return null;
    const days = daily.filter((d) => d.book_id === bookId && d.date >= r.start && d.date <= r.end).sort((a, b) => (a.date < b.date ? -1 : 1));
    let best = 0;
    const points = days.filter((d) => d.progress != null).map((d) => ({ date: d.date, progress: (best = Math.max(best, d.progress)), minutes: d.minutes || 0, words: d.words || 0 }));
    if (!points.length) return null;
    const m = d3.sum(days, (d) => (d.minutes > 0 && d.words > 0 ? d.minutes : 0)), w = d3.sum(days, (d) => (d.minutes > 0 && d.words > 0 ? d.words : 0));
    return { read: r, points, finished: r.finished === true, wpm: m >= 20 ? Math.round(w / m) : null };
  }

  // lanes: [{ name, color, points, finished }]; opts: { mode: 'date'|'start', from, schedule: { start, pct_per_week } }
  function raceLanes(box, lanes, opts = {}) {
    const mode = opts.mode || 'date', h = opts.height || 240, m = { t: 14, r: 64, b: 26, l: 36 };
    box.style.minHeight = h + 'px';
    const { svg, w, tip } = svgIn(box, h);
    const t = (p, l) => (mode === 'date' ? dayNo(p.date) : dayNo(p.date) - dayNo(l.points[0].date));
    const lo = mode === 'date' ? Math.min(opts.from ? dayNo(opts.from) : Infinity, ...lanes.map((l) => dayNo(l.points[0].date))) : 0;
    let hi = Math.max(...lanes.flatMap((l) => l.points.map((p) => t(p, l))), lo + 1);
    if (opts.until) hi = Math.max(hi, dayNo(opts.until));
    const x = d3.scaleLinear([lo, hi + 1], [m.l, w - m.r]), y = d3.scaleLinear([0, 100], [h - m.b, m.t]);
    axis(svg.append('g').attr('transform', `translate(${m.l},0)`), d3.axisLeft(y).ticks(5).tickFormat((v) => v + '%').tickSize(-(w - m.l - m.r)));
    svg.selectAll('.domain').remove();
    const ticks = Math.max(2, Math.min(hi - lo + 1, Math.floor(w / 90)));
    const fmtX = mode === 'date' ? (v) => d3.utcFormat(hi - lo <= 120 ? '%-d %b' : '%b %y')(new Date(v * DAY)) : (v) => `day ${fmt(v + 1)}`;
    axis(svg.append('g').attr('transform', `translate(0,${h - m.b})`), d3.axisBottom(x).ticks(ticks).tickFormat(fmtX).tickSizeOuter(0));

    // the schedule: where a reader should be by each day
    if (opts.schedule && opts.schedule.pct_per_week > 0) {
      const s0 = dayNo(opts.schedule.start), end = s0 + Math.ceil(100 / opts.schedule.pct_per_week * 7);
      const a = mode === 'date' ? s0 : 0, b = mode === 'date' ? end : end - s0;
      rh.refLine(svg, x(a), y(0), x(Math.min(b, hi + 1)), y(Math.min(100, ((Math.min(b, hi + 1) - a) / 7) * opts.schedule.pct_per_week)));
      svg.append('text').attr('class', 'axl').attr('x', x(Math.min(b, hi + 1)) - 4).attr('y', y(Math.min(100, ((Math.min(b, hi + 1) - a) / 7) * opts.schedule.pct_per_week)) - 6).attr('text-anchor', 'end').text('schedule');
    }

    // a step up at the end of each reading day, from where the read began
    const line = d3.line((d) => x(d.t), (d) => y(d.p)).curve(d3.curveStepAfter);
    const ends = [];
    lanes.forEach((l) => {
      const pts = [{ t: t(l.points[0], l), p: 0 }, ...l.points.map((p) => ({ t: t(p, l) + 1, p: p.progress }))];
      svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', l.color).attr('stroke-width', MARK.line + 0.5).attr('stroke-linejoin', 'round').attr('d', line).call(rh.drawIn);
      const last = pts[pts.length - 1];
      ends.push({ l, x: x(last.t), y: y(last.p), p: last.p });
    });
    // end markers, labels nudged apart so they don't overlap
    ends.sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    ends.forEach((e) => { e.ly = Math.max(e.y, prev + 14); prev = e.ly; });
    ends.forEach((e) => {
      svg.append('circle').attr('class', 'ring').attr('cx', e.x).attr('cy', e.y).attr('r', MARK.dot).attr('fill', e.l.color);
      svg.append('text').attr('class', 'axl rc-end').attr('x', Math.min(e.x + 8, w - m.r + 8)).attr('y', e.ly).attr('dy', '0.35em')
        .text(`${e.l.name} ${e.l.finished ? '✓' : Math.round(e.p) + '%'}`);
    });
    // hover: everyone's progress on that day
    svg.append('rect').attr('class', 'hit').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (ev) => {
        const v = Math.floor(x.invert(d3.pointer(ev, svg.node())[0]));
        const at = (l) => { let p = null; l.points.forEach((q) => { if (t(q, l) <= v) p = q.progress; }); return p; };
        showTip(tip, box, ev, (tp) => tipLines(tp, mode === 'date' ? fDay(new Date(v * DAY)) : `Day ${fmt(v + 1)}`, lanes.map((l) => [l.color, l.name, at(l) == null ? '—' : Math.round(at(l)) + '%'])));
      })
      .on('mouseleave', () => hideTip(tip));
  }
  rh.raceLanes = raceLanes;

  const modes = {};
  rh.bookCard({
    id: 'bk-race', title: 'Buddy read', after: 'card-bk-days',
    draw(box, _rows, parts, b) {
      const fr = rh.friends;
      if (!fr || fr.status() !== 'ok') return false;
      const mine = lane(dash.data('reads').data || [], dash.data('daily').data || [], b.id);
      if (!mine) return false;
      const lanes = [{ name: 'You', color: fr.color('me'), ...mine }];
      fr.list().forEach((f) => {
        const theirs = dash.sameBook.matcher(f.books)(b);
        const l = theirs && lane(f.reads, f.daily, theirs.id);
        if (l) lanes.push({ name: f.name, color: fr.color(f.slug), ...l });
      });
      if (lanes.length < 2) return false;
      // read together when every read overlaps yours
      const s = (l) => dayNo(l.read.start), e = (l) => dayNo(l.read.end);
      const together = lanes.slice(1).every((l) => s(l) <= e(mine) + 7 && e(l) >= s(mine) - 7);
      const mode = modes[b.id] || (together ? 'date' : 'start');
      parts.h.textContent = together ? 'Buddy read' : 'You and your friends on this book';
      box.replaceChildren();

      // who got where first
      const take = el('p', 'fp-take');
      const done = lanes.filter((l) => l.finished).sort((x, y) => (mode === 'date' ? e(x) - e(y) : e(x) - s(x) - (e(y) - s(y))));
      const took = (l) => plural(e(l) - s(l) + 1, 'day');
      if (done.length) {
        const [w1, w2] = done;
        take.append(`${w1.name === 'You' ? 'You' : w1.name} finished first${mode === 'date' ? ` (${fDay(pDate(w1.read.end))})` : ''}, in ${took(w1)}`);
        if (w2) take.append(`; ${w2.name === 'You' ? 'you' : w2.name} took ${took(w2)}`);
        take.append('. ');
      } else {
        const lead = lanes.slice().sort((x, y) => y.points.at(-1).progress - x.points.at(-1).progress)[0];
        take.append(`${lead.name === 'You' ? 'You’re' : lead.name + ' is'} ahead, at ${Math.round(lead.points.at(-1).progress)}%. `);
      }
      const fast = lanes.filter((l) => l.wpm).sort((x, y) => y.wpm - x.wpm);
      if (fast.length > 1) take.append(`${fast[0].name === 'You' ? 'You' : fast[0].name} read fastest, at ${fmt(fast[0].wpm)} wpm.`);
      box.append(take);

      const seg = el('div', 'rc-seg');
      [['date', 'By date'], ['start', 'From day 1']].forEach(([k, label]) => {
        const btn = el('button', 'fr-pill', label);
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(k === mode));
        btn.addEventListener('click', () => { modes[b.id] = k; rh.redraw(); });
        seg.append(btn);
      });
      const leg = el('div', 'legend');
      lanes.forEach((l) => { const i = el('span'), sw = el('i', 'sw'); sw.style.background = l.color; i.append(sw, l.name); leg.append(i); });
      const top = el('div', 'rc-top');
      top.append(leg, seg);
      const chart = el('div', 'rc-chart');
      box.append(top, chart);
      raceLanes(chart, lanes, { mode });
      parts.note.hidden = false;
      parts.note.textContent = together ? 'You read this alongside friends: how far each of you had got, day by day.' : 'Each line starts on that reader’s first day with the book.';
    },
  });
})();
