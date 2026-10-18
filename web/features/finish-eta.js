// When you'll finish the books on the go (BOO-77): each book's own pace so far, corrected by
// how your finished reads usually went from the same point on (most of us sprint the last
// stretch), with a range from how much that varied.
(() => {
  const { el, fmt, pDate, fDay, plural } = rh;
  const DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z'), iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const MIN_PROGRESS = 3;   // under this there's too little of the book read to have a pace
  const GENRE_READS = 5;    // use the genre's own reads once it has this many to compare with
  const MIN_READS = 3;      // and give a range only with at least this many
  const LO = 0.2, HI = 0.8; // the range: the middle 60% of how those reads went

  const quantile = (v, p) => {
    if (!v.length) return null;
    const i = (v.length - 1) * p, a = Math.floor(i), b = Math.ceil(i);
    return v[a] + (v[b] - v[a]) * (i - a);
  };

  dash.calc('finish_eta', {
    inputs: ['current', 'reads', 'daily', 'as_of'], title: 'When you’ll finish',
    description: 'For each book on the go: the days left at its own pace so far (days since the read began ÷ progress), corrected by how your finished reads went from the same point (the days they actually took to finish against what their pace said), using the genre\'s reads when it has 5+; with the likely finish date and a range from the 20th to 80th percentile.',
    fn: (current, reads, daily, as_of) => {
      if (!current.length || !as_of[0]?.date) return [];
      const today = t(as_of[0].date);
      // finished reads with a day-by-day log: their days in order, with progress
      const byBook = new Map();
      daily.forEach((d) => { if (d.progress != null) (byBook.get(d.book_id) || byBook.set(d.book_id, []).get(d.book_id)).push(d); });
      byBook.forEach((v) => v.sort((a, b) => (a.date < b.date ? -1 : 1)));
      const done = reads.filter((r) => r.finished === true && r.start && r.end && r.end > r.start).map((r) => ({
        genre: r.genre, start: t(r.start), end: t(r.end),
        days: (byBook.get(r.book_id) || []).filter((d) => d.date >= r.start && d.date <= r.end),
      })).filter((r) => r.days.length >= 3);
      // how a finished read went from p% on: actual days to finish ÷ what its pace up to p said
      const ratio = (r, p) => {
        const hit = r.days.find((d) => d.progress >= p);
        if (!hit || hit === r.days[0] && r.days[0].progress > p + 10) return null; // it began past p
        const sofar = (t(hit.date) - r.start) / DAY + 1, said = sofar * (100 - p) / p;
        if (said <= 0) return null;
        return Math.max(0, (r.end - t(hit.date)) / DAY) / said;
      };

      return current.map((c) => {
        const p = c.progress ?? null;
        const row = { book_id: c.id, title: c.title, genre: c.genre, progress: p, start: c.start, status: 'estimate' };
        if (p == null || !c.start) return { ...row, status: 'unknown' };
        if (p >= 99.5) return { ...row, status: 'nearly' };
        if (p < MIN_PROGRESS) return { ...row, status: 'too_early' };
        const elapsed = (today - t(c.start)) / DAY + 1, pace = elapsed * (100 - p) / p;
        const of = (v) => v.map((r) => ratio(r, p)).filter((x) => x != null).sort((a, b) => a - b);
        const genre = of(done.filter((r) => r.genre === c.genre)), all = genre.length >= GENRE_READS ? genre : of(done);
        const basis = genre.length >= GENRE_READS ? 'genre' : all.length >= MIN_READS ? 'all' : 'pace';
        const used = basis === 'pace' ? [] : all;
        const mid = used.length ? quantile(used, 0.5) : 1;
        const left = Math.max(1, Math.round(pace * mid));
        const lo = used.length ? Math.max(1, Math.round(pace * quantile(used, LO))) : left;
        const hi = used.length ? Math.max(left, Math.round(pace * quantile(used, HI))) : left;
        return {
          ...row, elapsed_days: elapsed, pace_days: Math.round(pace * 10) / 10, sprint: Math.round(mid * 100) / 100, basis, reads_compared: used.length,
          days_left: left, days_lo: Math.min(lo, left), days_hi: hi,
          finish: iso(today + left * DAY), finish_lo: iso(today + Math.min(lo, left) * DAY), finish_hi: iso(today + hi * DAY),
        };
      });
    },
  });

  // "around 3 Nov" / "w/c 2 Nov" / "Nov 2026", through rh.fDay so rounded dates stay rounded
  const when = (s) => fDay(pDate(s));
  const days = (n) => (n <= 1 ? 'a day or so' : n < 14 ? plural(n, 'day') : n < 60 ? `${fmt(Math.round(n / 7))} weeks` : `${fmt(Math.round(n / 30))} months`);
  // "31 Oct – 23 Nov 2026"; rounded dates (a week or month) are shown whole
  const range = (e) => {
    if (!(e.days_hi > e.days_lo) || when(e.finish_lo) === when(e.finish_hi)) return null;
    const lo = !dash.dates && e.finish_lo.slice(0, 4) === e.finish_hi.slice(0, 4) ? d3.utcFormat('%-d %b')(pDate(e.finish_lo)) : when(e.finish_lo);
    return `${lo} – ${when(e.finish_hi)}`;
  };
  const eta = (id) => {
    const r = dash.data('finish_eta');
    return r.status === 'ok' ? r.data.find((e) => e.book_id === id) : null;
  };
  const why = (e) => {
    if (e.basis === 'pace') return `At this read's pace so far (${fmt(Math.round(e.elapsed_days))} days for ${Math.round(e.progress)}%). There aren't enough finished reads with a daily log to compare it with yet.`;
    const where = e.basis === 'genre' ? `your ${fmt(e.reads_compared)} finished ${e.genre} reads` : `your ${fmt(e.reads_compared)} finished reads`;
    const s = e.sprint, pace = `At this read's pace so far you'd need about ${days(Math.round(e.pace_days))} more.`;
    const how = Math.abs(s - 1) < 0.08 ? ` From ${Math.round(e.progress)}% on, ${where} usually kept to their pace, so that stands.`
      : s < 1 ? ` From ${Math.round(e.progress)}% on, ${where} usually went ${fmt(Math.round((1 / s) * 10) / 10)}× faster than their pace said (the finishing sprint), so it's likely sooner.`
        : ` From ${Math.round(e.progress)}% on, ${where} usually took ${fmt(Math.round(s * 10) / 10)}× longer than their pace said, so it's likely later.`;
    return pace + how;
  };

  // a fact on the Overview's On the go card and in the book page header
  rh.goFact((r, where) => {
    const e = eta(r.id);
    if (!e || e.status !== 'estimate') return [];
    const rg = range(e);
    if (where === 'list') return [{ k: 'likely done', v: when(e.finish), cls: 'eta', title: rg ? `Likely ${rg}` : null }];
    return [{ k: 'Likely finish', v: when(e.finish) + (rg ? ` (${rg})` : ''), cls: 'eta', title: why(e) }];
  });

  // the book page: the estimate, the range on a strip, and how it was worked out
  rh.bookCard({
    id: 'bk-eta', title: 'When you’ll finish', calc: 'finish_eta', privacy: 'current', after: 'bk-kpis',
    draw(box, rows, parts, b) {
      const e = rows.find((x) => x.book_id === b.id);
      if (!e || e.status !== 'estimate') return false;
      box.replaceChildren();
      box.style.minHeight = '0';
      parts.note.hidden = true;
      const head = el('p', 'eta-take');
      head.append('Likely ', el('b', null, when(e.finish)), ` — in about ${days(e.days_left)}.`);
      const rg = range(e);
      if (rg) head.append(` Probably ${rg}.`);
      box.append(head, strip(e), el('p', 'eta-why', why(e)));
    },
  });

  // today → the latest likely day, with the likely range shaded and the estimate marked
  function strip(e) {
    const wrap = el('div', 'eta-strip'), end = Math.max(e.days_hi, e.days_left) * 1.08 || 1;
    const pos = (d) => `${Math.min(100, (d / end) * 100)}%`;
    const band = el('i', 'eta-band'), mark = el('i', 'eta-mark'), now = el('i', 'eta-now');
    band.style.left = pos(e.days_lo); band.style.width = `calc(${pos(e.days_hi)} - ${pos(e.days_lo)})`;
    mark.style.left = pos(e.days_left);
    const track = el('div', 'eta-track');
    track.append(band, now, mark);
    const ends = el('div', 'eta-ends');
    ends.append(el('span', null, 'today'), el('span', null, when(e.finish_hi)));
    wrap.append(track, ends);
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', `Likely finished in ${days(e.days_left)}` + (range(e) ? `, probably ${range(e)}` : ''));
    return wrap;
  }
})();
