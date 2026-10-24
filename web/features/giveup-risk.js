// Will you finish it? (BOO-78) For each book on the go, the signs that came before the books
// you gave up on: a slowing pace, longer breaks, being left alone, and sitting where you
// usually give up in that genre; and the past reads whose shape at the same point was most
// like it. A gentle flag, explained, not a score.
(() => {
  const { el, fmt, pDate, plural, chip } = rh;
  const DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z');
  const R = {
    abandonDays: 60,   // not finished and not opened for this long: given up (as "Where you give up")
    minDays: 4,        // a read needs this many days opened to have a shape
    minProgress: 3,    // and this much read
    slow: 0.5,         // slowing: the latest stretch at half the earlier pace or less
    gapTimes: 2,       // longer gaps: the last 3 breaks this many times the usual...
    gapMin: 3,         // ...and averaging at least this many days
    idleMin: 7,        // left alone: not opened for at least this many days...
    idleShare: 0.25,   // ...longer than all but this share of the books you finished were ever left
    zoneBefore: 10,    // where you give up: abandoned within this many points before...
    zoneAfter: 15,     // ...or after where this book is
    zoneSurvive: 0.75, // ...and you finished under this share of the genre's books that got this far
    near: 7,           // compare with this many of the most similar past reads
    minAbandoned: 2,   // no flag without this many given-up reads to learn from
  };
  const median = (v) => { const s = v.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  // plain-text helpers for the calc (it runs on the server too, without the page's rh)
  const num = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const days = (n) => `${num(n)} day${n === 1 ? '' : 's'}`;

  // the shape of a read up to its day k: where it was, its latest pace against its earlier
  // pace, and its latest breaks against its earlier ones
  function shape(ds, k) {
    const d = ds.slice(0, k + 1), first = t(d[0].date), last = t(d[k].date), span = (last - first) / DAY + 1;
    const at = d[k].progress, w = Math.max(7, Math.min(21, Math.round(span / 3)));
    let pace = null, recentPts = null;
    if (span >= 14 && k >= 3) {
      const cut = last - w * DAY, before = d.filter((x) => t(x.date) <= cut), base = before.length ? before[before.length - 1].progress : d[0].progress;
      const earlier = base / ((cut - first) / DAY + 1), recent = (at - base) / w;
      recentPts = at - base;
      if (earlier > 0.05) pace = recent / earlier;
    }
    const gaps = d.slice(1).map((x, i) => (t(x.date) - t(d[i].date)) / DAY - 1);
    let gap = null, lastGaps = null, usualGap = null;
    if (gaps.length >= 6) {
      lastGaps = mean(gaps.slice(-3)); usualGap = median(gaps.slice(0, -3));
      gap = (lastGaps + 1) / (usualGap + 1);
    }
    return { at, span, w, pace, recentPts, gap, lastGaps, usualGap, gaps };
  }

  dash.calc('giveup_risk', {
    inputs: ['current', 'reads', 'daily', 'as_of'], title: 'Will you finish it?',
    description: 'For each book on the go, the signs that came before the books you gave up on (not finished and not opened for 60+ days): its pace over the latest stretch against before, its last 3 breaks against its usual break, how long it has been left against how long the books you finished were ever left, and how many of your given-up books in its genre stopped near this point; with the 7 past reads whose shape at the same point was closest, and a level (likely, watch or fine).',
    fn: (current, reads, daily, as_of) => {
      if (!current.length || !as_of[0]?.date) return [];
      const today = t(as_of[0].date);
      const byBook = new Map();
      daily.forEach((d) => { if (d.progress != null) (byBook.get(d.book_id) || byBook.set(d.book_id, []).get(d.book_id)).push(d); });
      byBook.forEach((v) => v.sort((a, b) => (a.date < b.date ? -1 : 1)));
      const daysOf = (r, from = r.start, to = r.end) => (byBook.get(r.book_id) || []).filter((d) => d.date >= from && d.date <= to);
      const curIds = new Set(current.map((c) => c.id));
      // past reads, decided one way or the other
      const past = reads.filter((r) => !(curIds.has(r.book_id) && r.read_no === Math.max(...reads.filter((x) => x.book_id === r.book_id).map((x) => x.read_no))))
        .map((r) => {
          const abandoned = r.finished !== true && (today - t(r.end)) / DAY > R.abandonDays;
          if (r.finished !== true && !abandoned) return null;
          return { r, finished: r.finished === true, reached: r.finished === true ? 100 : Math.max(0, Math.min(100, r.progress ?? 0)), ds: daysOf(r) };
        }).filter(Boolean);
      const gaveUp = past.filter((x) => !x.finished);
      // the longest any finished read was left alone
      const finLongest = past.filter((x) => x.finished && x.ds.length >= 2).map((x) => Math.max(0, ...shape(x.ds, x.ds.length - 1).gaps));

      return current.map((c) => {
        const row = { book_id: c.id, title: c.title, genre: c.genre, progress: c.progress ?? null, level: 'fine', signals: [], nearest: [] };
        const ds = c.start ? daysOf({ book_id: c.id, start: c.start, end: as_of[0].date }) : [];
        if (c.progress == null || ds.length < R.minDays || c.progress < R.minProgress) return { ...row, level: 'too_early' };
        if (gaveUp.length < R.minAbandoned) return { ...row, level: 'unknown' };
        const me = shape(ds, ds.length - 1), p = me.at, idle = Math.round((today - t(ds[ds.length - 1].date)) / DAY);
        const sig = (id, on, text, extra = {}) => row.signals.push({ id, on, text, ...extra });

        // 1. slowing down
        if (me.pace != null) {
          const pct = Math.round(me.pace * 100);
          sig('pace', me.pace <= R.slow,
            me.pace <= R.slow ? `Slowing down: ${num(Math.round(me.recentPts * 10) / 10)} points in the last ${me.w} days, ${pct}% of your earlier pace on it.`
              : me.pace >= 1.2 ? `Picking up: the last ${me.w} days went ${num(Math.round(me.pace * 10) / 10)}× faster than before.`
                : me.pace >= 0.85 ? `Steady: the last ${me.w} days kept roughly the pace you started at.`
                  : `A little slower: the last ${me.w} days went at ${pct}% of your earlier pace, not enough to worry about.`, { value: Math.round(me.pace * 100) / 100 });
        }
        // 2. longer breaks
        if (me.gap != null) {
          const on = me.gap >= R.gapTimes && me.lastGaps >= R.gapMin;
          sig('gaps', on, on ? `Longer breaks: the last 3 averaged ${num(Math.round(me.lastGaps * 10) / 10)} days off between openings; before that it was usually ${days(me.usualGap)}.`
            : `Breaks as usual: the last 3 averaged ${num(Math.round(me.lastGaps * 10) / 10)} days off, against ${days(me.usualGap)} before.`, { value: Math.round(me.gap * 100) / 100 });
        }
        // 3. left alone
        if (finLongest.length >= 3) {
          const longer = finLongest.filter((g) => g >= idle).length / finLongest.length, on = idle >= R.idleMin && longer <= R.idleShare;
          sig('idle', on, on ? `Left alone: not opened for ${days(idle)}. Only ${Math.round(longer * 100)}% of the books you finished were ever put down that long.`
            : idle <= 1 ? 'Opened in the last day or so.' : `Last opened ${days(idle)} ago, which plenty of books you finished survived.`, { value: idle });
        }
        // 4. where you give up in this genre (or overall, when the genre has few reads)
        const inGenre = past.filter((x) => x.r.genre === c.genre), pool = inGenre.length >= 3 ? inGenre : past, scope = pool === inGenre ? c.genre : null;
        const near = pool.filter((x) => !x.finished && x.reached >= p - R.zoneBefore && x.reached <= p + R.zoneAfter);
        const got = pool.filter((x) => x.reached >= p), survive = got.length ? got.filter((x) => x.finished).length / got.length : null;
        const on4 = near.length > 0 && survive != null && survive < R.zoneSurvive;
        const lo = Math.max(0, Math.round(p - R.zoneBefore)), hi = Math.min(100, Math.round(p + R.zoneAfter));
        const total = pool.filter((x) => !x.finished).length, g = scope ? `${scope} ` : '';
        sig('zone', on4, `${near.length ? `${num(near.length)} of your ${num(total)}` : 'None of your'} given-up ${g}books stopped between ${lo}% and ${hi}%.` +
          (survive != null ? ` Of the ${g}books that got this far, you finished ${Math.round(survive * 100)}%.` : ''),
          { scope, near: near.length, given_up: total, from: lo, to: hi, value: survive == null ? null : Math.round(survive * 100) / 100 });

        // the past reads most like this one at the same point
        const lg = (v) => (v == null ? 0 : Math.log(Math.max(0.05, v)));
        const snaps = past.filter((x) => x.ds.length >= R.minDays).map((x) => {
          let k = x.ds.length - 1;
          if (x.finished) { k = x.ds.findIndex((d) => d.progress >= p); if (k < 1) return null; }
          const s = shape(x.ds, k);
          const dist = Math.abs(lg(s.pace) - lg(me.pace)) + Math.abs(lg(s.gap) - lg(me.gap)) + Math.abs(s.at - p) / 25 + (x.r.genre === c.genre ? 0 : 0.3);
          return { x, dist };
        }).filter(Boolean).sort((a, b) => a.dist - b.dist).slice(0, R.near);
        row.nearest = snaps.map(({ x }) => ({ book_id: x.r.book_id, title: x.r.title, genre: x.r.genre, finished: x.finished, reached: Math.round(x.reached) }));
        const nearGaveUp = row.nearest.filter((x) => !x.finished).length, share = row.nearest.length ? nearGaveUp / row.nearest.length : 0;
        const ons = row.signals.filter((s) => s.on).length;
        row.level = ons >= 3 || (ons >= 2 && share >= 0.5) ? 'likely' : ons >= 2 || (ons >= 1 && share >= 0.5) ? 'watch' : 'fine';
        Object.assign(row, { idle_days: idle, signals_on: ons, nearest_gave_up: nearGaveUp, base_rate: Math.round((gaveUp.length / past.length) * 100) / 100 });
        return row;
      });
    },
  });

  const risk = (id) => {
    if (dash.dates) return null; // the breaks need exact days
    const r = dash.data('giveup_risk');
    return r.status === 'ok' ? r.data.find((e) => e.book_id === id) : null;
  };
  const LABEL = { likely: 'Looks like a DNF', watch: 'Wobbling' };
  const summary = (e) => e.signals.filter((s) => s.on).map((s) => ({ pace: 'slowing down', gaps: 'longer breaks', idle: `left ${plural(e.idle_days, 'day')}`, zone: 'near where you give up' }[s.id])).join(', ');

  // a gentle flag on the Overview's On the go card and in the book page header
  rh.goFact((r, where) => {
    const e = risk(r.id);
    if (!e || !LABEL[e.level]) return [];
    const flag = el('span', 'gr-flag gr-' + e.level, LABEL[e.level]);
    return [{ k: where === 'list' ? '' : 'Will you finish?', v: flag, title: summary(e) ? `Signs: ${summary(e)}` : null }];
  });

  // the signals and the reads it's most like, on the book page
  rh.bookCard({
    id: 'bk-giveup', title: 'Will you finish it?', calc: 'giveup_risk', privacy: ['current', 'exact_dates'], after: 'card-bk-eta',
    draw(box, rows, parts, b) {
      const e = rows.find((x) => x.book_id === b.id);
      if (!e || dash.dates || !['likely', 'watch', 'fine'].includes(e.level)) return false;
      box.replaceChildren();
      box.style.minHeight = '0';
      parts.note.textContent = 'How this read is going, against the books you finished and the ones you gave up on (not opened for 60+ days). Signs, not a verdict.';
      parts.note.hidden = false;
      const take = el('p', 'gr-take');
      if (e.level === 'likely') take.append(el('span', 'gr-flag gr-likely', LABEL.likely), ' This one is going the way your unfinished books went.');
      else if (e.level === 'watch') take.append(el('span', 'gr-flag gr-watch', LABEL.watch), ' A sign or two of the books you gave up on, but not the full picture.');
      else take.append(el('span', 'gr-flag gr-fine', 'On course'), ' Nothing here looks like the books you gave up on.');
      box.append(take);
      const ul = el('ul', 'gr-signals');
      e.signals.forEach((s) => {
        const li = el('li', s.on ? 'on' : 'off');
        li.append(el('span', 'gr-dot'));
        const tx = el('span');
        if (s.id === 'zone' && s.scope) {
          // the same sentence with the genre linked
          const g = () => [' ', chip('genre', s.scope), ' '];
          tx.append(s.near ? `${fmt(s.near)} of your ${fmt(s.given_up)} given-up` : 'None of your given-up', ...g(), `books stopped between ${s.from}% and ${s.to}%.`);
          if (s.value != null) tx.append(' Of the', ...g(), `books that got this far, you finished ${Math.round(s.value * 100)}%.`);
        }
        else tx.append(s.text);
        li.append(tx);
        ul.append(li);
      });
      box.append(ul);
      if (e.nearest.length) {
        const n = e.nearest.length, g = e.nearest_gave_up;
        box.append(el('p', 'gr-near-h', `The ${n} past reads most like it at ${Math.round(e.progress)}% (pace, breaks and how far in): ${g ? `${fmt(g)} given up` : 'all finished'}. Overall you give up on ${Math.round(e.base_rate * 100)}% of books.`));
        const list = el('ul', 'gr-near');
        e.nearest.forEach((x) => {
          const li = rh.linkBook(el('li', x.finished ? 'fin' : 'dnf'), x.book_id);
          li.append(el('span', 'gr-mark', x.finished ? '✓' : '✕'), el('span', 'gr-t', x.title), el('span', 'gr-r', x.finished ? 'finished' : `stopped at ${x.reached}%`));
          list.append(li);
        });
        box.append(list);
      }
      if (e.idle_days != null) box.append(el('p', 'gr-foot', `As of the latest day in your data, ${rh.fDay(pDate(dash.data('as_of').data[0].date))}.`));
    },
  });
})();
