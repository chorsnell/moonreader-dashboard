dash.calc('as_of', {
  inputs: ['daily'], title: 'Backup date',
  description: 'The latest day in the reading log, used as "today" everywhere.',
  // without the day-by-day log (the owner can keep it private from visitors), today
  fn: (daily) => [{ date: daily.reduce((m, d) => (d.date > m ? d.date : m), '') || new Date().toISOString().slice(0, 10) }],
});

dash.calc('kpis', {
  inputs: ['books', 'reads', 'daily', 'as_of'], title: 'Headline figures',
  description: 'Year-to-date vs the same date last year, the last 365 days, streaks and totals.',
  fn: (books, reads, daily, as_of) => {
    const end = as_of[0].date, y = +end.slice(0, 4), md = end.slice(5);
    const ms = (s) => Date.parse(s + 'T00:00:00Z'), DAY = 864e5;
    const inYtd = (s, yr) => s.slice(0, 4) === String(yr) && s.slice(5) <= md;
    const fin = reads.filter((r) => r.finished === true);
    const mins = (yr) => daily.filter((d) => inYtd(d.date, yr)).reduce((a, d) => a + (d.minutes || 0), 0);
    const last365 = daily.filter((d) => ms(end) - ms(d.date) < 365 * DAY && d.minutes);
    const days = [...new Set(daily.map((d) => d.date))].sort();
    let best = 0, run = 0, prev = null;
    for (const d of days) { run = prev && ms(d) - ms(prev) === DAY ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    let now = 0;
    for (let i = days.length - 1; i >= 0 && ms(end) - ms(days[i]) === now * DAY; i--) now++;
    const both = daily.filter((d) => d.minutes > 0 && d.words > 0);
    const wpm = both.reduce((a, d) => a + d.words, 0) / both.reduce((a, d) => a + d.minutes, 0);
    const v = {
      finished_ytd: fin.filter((r) => inYtd(r.end, y)).length,
      finished_prev_ytd: fin.filter((r) => inYtd(r.end, y - 1)).length,
      hours_ytd: Math.round(mins(y) / 60),
      hours_prev_ytd: Math.round(mins(y - 1) / 60),
      avg_mins_365: Math.round(last365.reduce((a, d) => a + d.minutes, 0) / 365),
      days_365: new Set(last365.map((d) => d.date)).size,
      streak_now: now, streak_best: best,
      finished_books: books.filter((b) => b.status === 'finished').length,
      reread_books: books.filter((b) => b.times_read > 1).length,
      wpm: Math.round(wpm),
      hours_all: Math.round(books.reduce((a, b) => a + (b.hours || 0), 0)),
      year: y,
    };
    const top = {};
    fin.filter((r) => r.end.slice(0, 4) === String(y)).forEach((r) => (top[r.genre] = (top[r.genre] || 0) + 1));
    const g = Object.entries(top).sort((a, b) => b[1] - a[1])[0];
    const diff = v.finished_ytd - v.finished_prev_ytd;
    v.takeaway = `${v.finished_ytd} books finished in ${y} so far, ${diff === 0 ? 'level with' : Math.abs(diff) + (diff > 0 ? ' ahead of' : ' behind')} this point last year` +
      (g ? `, mostly ${/[A-Z]{2}/.test(g[0]) ? g[0] : g[0].toLowerCase()}` : '') + '.' +
      (daily.length ? ` You've read on ${v.days_365} of the last 365 days, averaging ${v.avg_mins_365} minutes a day.` : '');
    return Object.entries(v).map(([metric, value]) => ({ metric, value }));
  },
});

dash.calc('per_year', {
  inputs: ['reads', 'daily'], title: 'Per year',
  description: 'Finished reads (first reads and re-reads), reads started and hours logged, by year.',
  fn: (reads, daily) => {
    const years = new Set([...reads.map((r) => +r.start.slice(0, 4)), ...reads.map((r) => +r.end.slice(0, 4))]);
    return [...years].sort().map((year) => {
      const f = reads.filter((r) => r.finished === true && +r.end.slice(0, 4) === year);
      return {
        year, first_reads: f.filter((r) => r.read_no === 1).length, rereads: f.filter((r) => r.read_no > 1).length,
        finished: f.length, started: reads.filter((r) => +r.start.slice(0, 4) === year).length,
        hours: Math.round(daily.filter((d) => +d.date.slice(0, 4) === year).reduce((a, d) => a + (d.minutes || 0), 0) / 60),
      };
    });
  },
});

dash.calc('per_month', {
  inputs: ['daily'], title: 'Hours per month',
  description: 'Hours read per calendar month since the daily log began, with a 12-month rolling average.',
  fn: (daily) => {
    const m = {};
    daily.filter((d) => d.minutes).forEach((d) => (m[d.date.slice(0, 7)] = (m[d.date.slice(0, 7)] || 0) + d.minutes));
    const keys = Object.keys(m).sort();
    if (!keys.length) return [];
    const out = [];
    let [y, mo] = keys[0].split('-').map(Number);
    const last = keys[keys.length - 1];
    for (;;) {
      const k = `${y}-${String(mo).padStart(2, '0')}`;
      out.push({ month: k, hours: Math.round((m[k] || 0) / 6) / 10 });
      if (k === last) break;
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    out.forEach((r, i) => { const w = out.slice(Math.max(0, i - 11), i + 1); r.rolling = Math.round(w.reduce((a, x) => a + x.hours, 0) / w.length * 10) / 10; });
    return out;
  },
});

dash.calc('genre_counts', {
  inputs: ['books'], title: 'Genres',
  description: 'Finished books and hours per genre.',
  fn: (books) => {
    const g = {};
    books.filter((b) => b.status === 'finished').forEach((b) => { g[b.genre] = g[b.genre] || { genre: b.genre, books: 0, hours: 0 }; g[b.genre].books++; g[b.genre].hours += b.hours || 0; });
    return Object.values(g).map((r) => ({ ...r, hours: Math.round(r.hours) })).sort((a, b) => b.books - a.books);
  },
});

dash.calc('subgenres', {
  inputs: ['books'], title: 'Subgenres',
  description: 'Finished books in the 12 most-read subgenres.',
  fn: (books) => {
    const g = {};
    books.filter((b) => b.status === 'finished').forEach((b) => { const k = b.subgenre; g[k] = g[k] || { subgenre: k, genre: b.genre, books: 0 }; g[k].books++; });
    return Object.values(g).sort((a, b) => b.books - a.books).slice(0, 12);
  },
});

dash.calc('genre_month', {
  inputs: ['daily'], title: 'Genre mix over time',
  description: 'Hours read per genre in each calendar month.',
  fn: (daily) => {
    const g = {};
    daily.forEach((d) => { if (!(d.minutes > 0)) return; const k = d.date.slice(0, 7) + '|' + (d.genre || 'Unknown'); g[k] = (g[k] || 0) + d.minutes; });
    return Object.entries(g).map(([k, m]) => ({ month: k.split('|')[0], genre: k.split('|')[1], hours: Math.round(m / 6) / 10 })).sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  },
});

dash.calc('authors', {
  inputs: ['books'], title: 'Top authors',
  description: 'Finished books and total hours per author, top 15 by books.',
  fn: (books) => {
    const a = {};
    books.forEach((b) => { a[b.author] = a[b.author] || { author: b.author, finished: 0, hours: 0, g: {} }; a[b.author].g[b.genre] = (a[b.author].g[b.genre] || 0) + 1; if (b.status === 'finished') a[b.author].finished++; a[b.author].hours += b.hours || 0; });
    return Object.values(a).filter((r) => r.finished > 0)
      .map((r) => ({ author: r.author, finished: r.finished, hours: Math.round(r.hours), genre: Object.entries(r.g).sort((x, y) => y[1] - x[1])[0][0] }))
      .sort((x, y) => y.finished - x.finished || y.hours - x.hours).slice(0, 15);
  },
});

dash.calc('series', {
  inputs: ['books'], title: 'Series',
  description: 'Series with two or more books read: books finished and hours.',
  fn: (books) => {
    const s = {};
    books.filter((b) => b.series).forEach((b) => { s[b.series] = s[b.series] || { series: b.series, author: b.author, books: 0, finished: 0, hours: 0 }; s[b.series].books++; if (b.status === 'finished') s[b.series].finished++; s[b.series].hours += b.hours || 0; });
    return Object.values(s).filter((r) => r.books >= 2).map((r) => ({ ...r, hours: Math.round(r.hours) })).sort((a, b) => b.finished - a.finished || b.hours - a.hours);
  },
});

dash.calc('day_totals', {
  inputs: ['daily'], title: 'Reading per day',
  description: 'Minutes and words read on each day with any reading, and the books read that day.',
  fn: (daily) => {
    const m = {};
    daily.forEach((d) => {
      const r = (m[d.date] = m[d.date] || { date: d.date, minutes: 0, words: 0, books: [] });
      r.minutes += d.minutes || 0; r.words += d.words || 0; r.books.push(d.title);
    });
    return Object.values(m).sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((r) => ({ date: r.date, minutes: Math.round(r.minutes), words: r.words, books: r.books.join('; ') }));
  },
});

dash.calc('weekday', {
  inputs: ['daily'], title: 'Weekday rhythm',
  description: 'Average minutes per calendar day by weekday, over every day since the log began.',
  fn: (daily) => {
    const logged = daily.filter((d) => d.minutes);
    const first = logged.reduce((m, d) => (d.date < m ? d.date : m), '9999'), last = logged.reduce((m, d) => (d.date > m ? d.date : m), '');
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], sum = Array(7).fill(0), cnt = Array(7).fill(0);
    for (let t = Date.parse(first + 'T00:00:00Z'); t <= Date.parse(last + 'T00:00:00Z'); t += 864e5) cnt[(new Date(t).getUTCDay() + 6) % 7]++;
    logged.forEach((d) => (sum[(new Date(d.date + 'T00:00:00Z').getUTCDay() + 6) % 7] += d.minutes));
    return names.map((weekday, i) => ({ weekday, avg_minutes: Math.round(sum[i] / cnt[i]) }));
  },
});

dash.calc('speed_year', {
  inputs: ['daily'], title: 'Reading speed by year',
  description: 'Words per minute per year, from days with both words and minutes logged.',
  fn: (daily) => {
    const y = {};
    daily.filter((d) => d.minutes > 0 && d.words > 0).forEach((d) => { const k = +d.date.slice(0, 4); y[k] = y[k] || { year: k, w: 0, m: 0 }; y[k].w += d.words; y[k].m += d.minutes; });
    return Object.values(y).sort((a, b) => a.year - b.year).map((r) => ({ year: r.year, wpm: Math.round(r.w / r.m) }));
  },
});

// The days each read was actually opened, as runs of consecutive days [[from, to], ...].
const DAY_MS = 864e5;
const dayNo = (s) => Date.parse(s + 'T00:00:00Z') / DAY_MS;
function readDays(reads, daily) {
  const byBook = new Map();
  daily.forEach((d) => { if (!byBook.has(d.book_id)) byBook.set(d.book_id, []); byBook.get(d.book_id).push(d); });
  byBook.forEach((v) => v.sort((a, b) => (a.date < b.date ? -1 : 1)));
  return new Map(reads.map((r) => [r.read_id, (byBook.get(r.book_id) || []).filter((d) => d.date >= r.start && d.date <= r.end)]));
}
function runs(dates) {
  const out = [];
  dates.forEach((s) => { const last = out[out.length - 1]; if (last && dayNo(s) - dayNo(last[1]) === 1) last[1] = s; else out.push([s, s]); });
  return out;
}

dash.calc('timeline', {
  inputs: ['reads', 'daily'], title: 'Every read',
  description: 'Every read with its first and last day and the runs of days it was actually opened; single-day dips into a book are left out.',
  fn: (reads, daily) => {
    const days = readDays(reads, daily);
    return reads.filter((r) => r.days_read !== 1)
      .map((r) => ({ read_id: r.read_id, book_id: r.book_id, title: r.title, genre: r.genre, start: r.start, end: r.end, progress: r.progress, finished: r.finished === true, read_no: r.read_no,
        days_read: r.days_read, active: runs(days.get(r.read_id).map((d) => d.date)) }))
      .sort((a, b) => (a.start < b.start ? -1 : 1));
  },
});

// ---------- book fingerprints ----------
// The shape of each read from its minutes per day. Finished reads are rescued (put down for
// a long spell part way, then finished), devoured (most days, long sessions, done fast),
// stop-start (opened on few of its days, in bursts) or a slow burn (steady, small doses).
// Unfinished reads are abandoned, or still on the go if opened lately.
const SHAPE = {
  rescueGap: 28,       // a break this many days long...
  rescueFrom: 5,       // ...after getting at least this far (%) and before 95%
  devourDays: 14,      // devoured: done within this many days...
  devourDensity: 0.6,  // ...opened on at least this share of them...
  devourMinutes: 40,   // ...averaging this many minutes per day across the read...
  devourShort: 8,      // ...or done within this many days (anything done within 3 days is devoured)
  stopDensity: 0.45,   // stop-start: opened on less than this share of its days...
  stopGaps: 3,         // ...or this many breaks of stopGap+ days
  stopGap: 4,
  abandonDays: 60,     // unfinished and not opened for this long: abandoned
  sparkBins: 60,       // sparklines longer than this many days are summed into this many bins
};
const SHAPES = ['devoured', 'slow_burn', 'stop_start', 'rescued', 'abandoned', 'reading'];
dash.calc('fingerprints', {
  inputs: ['reads', 'daily', 'as_of'], title: 'Book fingerprints',
  description: 'Each read classified by the shape of its minutes per day: devoured, slow burn, stop-start, rescued (dropped then picked up again), abandoned or still reading; with a sparkline of minutes per day.',
  fn: (reads, daily, as_of) => {
    const days = readDays(reads, daily), today = dayNo(as_of[0].date);
    return reads.map((r) => {
      const ds = days.get(r.read_id).filter((d) => d.minutes > 0 || d.progress != null);
      // a stray opening long before the read really starts isn't part of its shape
      if (ds.length > 2 && (ds[0].progress ?? 0) < SHAPE.rescueFrom && dayNo(ds[1].date) - dayNo(ds[0].date) > SHAPE.rescueGap) ds.shift();
      if (!ds.length) return null;
      const d0 = dayNo(ds[0].date), span = dayNo(ds[ds.length - 1].date) - d0 + 1;
      const minutes = d3.sum(ds, (d) => d.minutes || 0), gaps = ds.slice(1).map((d, i) => dayNo(d.date) - dayNo(ds[i].date) - 1);
      const density = ds.length / span, perDay = minutes / span;
      // a long break after getting somewhere, before nearly done (a stray first opening doesn't count)
      let rescue = 0, prog = 0;
      ds.slice(1).forEach((d, i) => { prog = Math.max(prog, ds[i].progress ?? 0); if (gaps[i] >= SHAPE.rescueGap && prog >= SHAPE.rescueFrom && prog < 95) rescue = Math.max(rescue, gaps[i]); });
      let shape;
      if (!r.finished) shape = today - dayNo(ds[ds.length - 1].date) > SHAPE.abandonDays ? 'abandoned' : 'reading';
      else if (rescue) shape = 'rescued';
      else if (span <= 3 || (span <= SHAPE.devourDays && density >= SHAPE.devourDensity && (perDay >= SHAPE.devourMinutes || span <= SHAPE.devourShort))) shape = 'devoured';
      else if (density < SHAPE.stopDensity || gaps.filter((g) => g >= SHAPE.stopGap).length >= SHAPE.stopGaps) shape = 'stop_start';
      else shape = 'slow_burn';
      const bin = Math.max(1, Math.ceil(span / SHAPE.sparkBins)), spark = Array(Math.ceil(span / bin)).fill(0);
      ds.forEach((d) => (spark[Math.floor((dayNo(d.date) - d0) / bin)] += d.minutes || 0));
      return {
        read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre, subgenre: r.subgenre, read_no: r.read_no,
        start: ds[0].date, end: ds[ds.length - 1].date, finished: r.finished === true, progress: r.progress, shape,
        span_days: span, active_days: ds.length, minutes: Math.round(minutes), mins_per_day: Math.round(minutes / ds.length),
        density: Math.round(density * 100) / 100, longest_gap: Math.max(0, ...gaps), rescue_gap: rescue,
        spark: spark.map((v) => Math.round(v / bin)), bin_days: bin,
      };
    }).filter(Boolean).sort((a, b) => (a.start < b.start ? -1 : 1));
  },
});

// ---------- data checks ----------
// Things in the log that look odd and may skew the other charts. Each row is one finding;
// `date` is the day to open in the diary. Thresholds are deliberately loose: these are
// prompts to look, not errors.
const CHECK = {
  strayGap: 30,        // a first/last day this many days away from the rest of the read is a stray opening
  pauseGap: 60,        // a gap this long in the middle of a read is a pause
  sparseSpan: 60,      // reads spanning at least this many days...
  sparseShare: 0.15,   // ...but opened on less than this share of them
  busyBooks: 3,        // days with this many books opened
  longDayMin: 360,     // a single book open this long in a day (minutes)
  jumpPts: 40,         // progress jumping this many points in a day...
  jumpMin: 20,         // ...with fewer minutes than this logged
  backPts: 15,         // progress going back this many points
};
dash.calc('anomalies', {
  inputs: ['reads', 'daily', 'books'], title: 'Data checks',
  description: 'Reads with stray first or last days, long pauses or thinly spread spans, or counted as finished by a guess; days with many books, implausible speeds or very long sessions; progress jumps; untagged books; books without an ISBN.',
  fn: (reads, daily, books) => {
    const fd = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const out = [], days = readDays(reads, daily);
    const add = (check, r, date, detail, extra = {}) => out.push({ key: `${check}|${r.read_id || r.book_id || r.id}|${date || ''}`, check, book_id: r.book_id || r.id, title: r.title, author: r.author || '', genre: r.genre, date, detail, ...extra });
    reads.forEach((r) => {
      const ds = days.get(r.read_id).map((d) => d.date);
      const strip = { start: r.start, end: r.end, active: runs(ds) };
      if (r.finished_by === 'estimate')
        add('guessed', r, r.end, "Moon+ didn't record how far you got; counted as finished because the words read cover the book's page count. Wrong? Set Finished to No in Admin → Catalogue.", strip);
      else if (r.finished_by === 'near_end')
        add('guessed', r, r.end, `Stopped at ${Math.round(r.progress * 10) / 10}%; counted as finished, the rest being back matter. Wrong? Set Finished to No in Admin → Catalogue.`, strip);
      if (ds.length < 2) return;
      const span = dayNo(ds[ds.length - 1]) - dayNo(ds[0]) + 1, gaps = ds.slice(1).map((s, i) => dayNo(s) - dayNo(ds[i]) - 1);
      if (ds.length >= 3 && gaps[0] >= CHECK.strayGap)
        add('stray', r, ds[0], `Opened on ${fd(ds[0])}, then not again for ${gaps[0]} days. The read probably starts on ${fd(ds[1])}.`, { ...strip, gap: gaps[0], suggest: ds[1] });
      if (ds.length >= 3 && gaps[gaps.length - 1] >= CHECK.strayGap)
        add('stray', r, ds[ds.length - 1], `Last opened ${gaps[gaps.length - 1]} days after the rest, on ${fd(ds[ds.length - 1])}. The read probably ends on ${fd(ds[ds.length - 2])}.`, { ...strip, gap: gaps[gaps.length - 1], suggest: ds[ds.length - 2] });
      const off = ds.length >= 3 ? 1 : 0, inner = gaps.slice(off, ds.length >= 3 ? -1 : undefined);
      const pause = Math.max(0, ...inner);
      if (pause >= CHECK.pauseGap) {
        const i = inner.indexOf(pause) + off;
        add('pause', r, ds[i], `A ${pause}-day break between ${fd(ds[i])} and ${fd(ds[i + 1])}, in a read of ${ds.length} days.`, { ...strip, gap: pause });
      }
      if (span >= CHECK.sparseSpan && ds.length / span < CHECK.sparseShare)
        add('sparse', r, ds[0], `Opened on ${ds.length} of the ${span} days between first and last.`, { ...strip, share: ds.length / span });
    });
    const byDate = d3.groups(daily, (d) => d.date);
    byDate.filter(([, v]) => new Set(v.map((d) => d.book_id)).size >= CHECK.busyBooks).forEach(([date, v]) => {
      const top = v.slice().sort((a, b) => (b.minutes || 0) - (a.minutes || 0));
      out.push({ key: `busy|${date}`, check: 'busy', title: `${v.length} books on one day`, author: '', date,
        detail: top.map((d) => d.title + (d.minutes ? ` (${Math.round(d.minutes)} min)` : '')).join(' · '), books: v.length });
    });
    daily.forEach((d) => {
      if (d.minutes >= CHECK.longDayMin) add('long', d, d.date, `${Math.round(d.minutes / 6) / 10} hours in one day${d.words ? `, ${Math.round(d.words / d.minutes)} wpm` : ''}. Left open?`, { minutes: d.minutes });
      else if (d.minutes >= 5 && d.words > 0 && (d.words / d.minutes > 800 || d.words / d.minutes < 40))
        add('speed', d, d.date, `${Math.round(d.words / d.minutes)} wpm over ${Math.round(d.minutes)} min (${d.words.toLocaleString()} words). Left out of speed figures.`, { wpm: Math.round(d.words / d.minutes) });
    });
    // progress from one logged day to the next, per book
    const last = new Map();
    daily.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((d) => {
      if (d.progress == null) return;
      const p = last.get(d.book_id);
      if (p != null) {
        if (d.progress - p >= CHECK.jumpPts && (d.minutes || 0) < CHECK.jumpMin)
          add('jump', d, d.date, `Progress went from ${Math.round(p)}% to ${Math.round(d.progress)}% with ${d.minutes ? Math.round(d.minutes) + ' min' : 'no time'} logged. Skipped ahead?`, { delta: d.progress - p });
        else if (p - d.progress >= CHECK.backPts)
          add('jump', d, d.date, `Progress went back from ${Math.round(p)}% to ${Math.round(d.progress)}%. Restarted, or a different copy?`, { delta: d.progress - p });
      }
      last.set(d.book_id, d.progress);
    });
    const sameWork = d3.rollup(books.filter((b) => b.work_id), (v) => v.length, (b) => b.work_id);
    books.forEach((b) => {
      if (b.genre === 'Untagged') add('untagged', b, b.last_read, b.source ? `Only in your ${{ storygraph: 'StoryGraph', kobo: 'Kobo', kindle: 'Kindle', kindle_clippings: 'Kindle' }[b.source] || 'Goodreads'} data, so it has no genre. Give it one in Admin → Catalogue.` : 'Not in catalogue.json, so it has no genre, series or tidy title.');
      if (b.status === 'unknown' && b.times_read && !b.source) add('noprog', b, b.last_read, "Read, but Moon+ never recorded how far you got, and the words logged don't cover the book's page count (or it has none). If you finished it, set Finished to Yes in Admin → Catalogue.");
      if (b.work_id && sameWork.get(b.work_id) > 1) add('samework', b, b.last_read, `Shares the work id ${b.work_id} with another book. If they're editions of one book, give their catalogue.json entries the same "work_id" to merge them.`);
      if (!b.isbn13) add('noisbn', b, b.last_read, 'No ISBN yet. Add "isbn" to its catalogue.json entry so it can be matched with other sources.');
    });
    return out.sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  },
});

dash.calc('diary', {
  inputs: ['daily', 'reads'], title: 'Diary',
  description: 'One row per book per day: minutes, words, progress at the end of the day and the day before, and whether a read started or finished. Estimated days (after the last backup, from synced positions) have no minutes and estimated words.',
  fn: (daily, reads) => {
    const starts = {}, ends = {};
    reads.forEach((r) => { starts[r.book_id + '|' + r.start] = r; if (r.finished) ends[r.book_id + '|' + r.end] = r; });
    const last = {};
    return daily.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => {
      const k = d.book_id + '|' + d.date, st = starts[k], fin = ends[k];
      const row = {
        date: d.date, book_id: d.book_id, title: d.title, author: d.author || '', genre: d.genre,
        minutes: d.minutes, words: d.words, progress: d.progress ?? null, prev_progress: st ? 0 : last[d.book_id] ?? null,
        event: fin ? 'finished' : st ? (st.read_no > 1 ? 'reread' : 'started') : null,
        estimated: !!d.estimated,
      };
      if (d.progress != null) last[d.book_id] = d.progress;
      return row;
    });
  },
});

dash.calc('current', {
  inputs: ['books', 'as_of', 'reads'], title: 'On the go',
  description: 'Books opened in the last 30 days that are not finished, with when the current read started, its days and its hours.',
  fn: (books, as_of, reads) => {
    const end = Date.parse(as_of[0].date + 'T00:00:00Z'), latest = new Map();
    reads.forEach((r) => { if (!latest.has(r.book_id) || r.read_no > latest.get(r.book_id).read_no) latest.set(r.book_id, r); });
    return books.filter((b) => b.last_read && end - Date.parse(b.last_read + 'T00:00:00Z') <= 30 * 864e5 && b.status !== 'finished')
      .map((b) => {
        const r = latest.get(b.id) || {};
        return { id: b.id, title: b.title, author: b.author, genre: b.genre, subgenre: b.subgenre, series: b.series, series_no: b.series_no,
          progress: b.progress, last_read: b.last_read, start: r.start ?? null, days_read: r.days_read ?? null, hours: r.hours ?? null, read_no: r.read_no ?? 1 };
      }).sort((a, b) => (a.last_read < b.last_read ? 1 : -1));
  },
});

dash.calc('recent', {
  inputs: ['reads'], title: 'Recently finished',
  description: 'The ten most recent reads that ended at 99% or more.',
  fn: (reads) => reads.filter((r) => r.finished === true).sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 10)
    .map((r) => ({ read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre, end: r.end, days_read: r.days_read, hours: r.hours, read_no: r.read_no })),
});

dash.calc('big_reads', {
  inputs: ['reads'], title: 'Biggest reads',
  description: 'Finished reads with the most hours logged.',
  fn: (reads) => reads.filter((r) => r.finished === true && r.hours).sort((a, b) => b.hours - a.hours).slice(0, 10)
    .map((r) => ({ read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre, hours: r.hours, days_read: r.days_read, end: r.end })),
});

dash.calc('stalled', {
  inputs: ['books', 'as_of'], title: 'Left unfinished',
  description: 'Books between 5% and 95% progress, not opened for 60+ days.',
  fn: (books, as_of) => {
    const end = Date.parse(as_of[0].date + 'T00:00:00Z');
    return books.filter((b) => b.progress >= 5 && b.progress <= 95 && b.last_read && end - Date.parse(b.last_read + 'T00:00:00Z') > 60 * 864e5)
      .map((b) => ({ id: b.id, title: b.title, author: b.author, genre: b.genre, progress: b.progress, last_read: b.last_read })).sort((a, b) => b.progress - a.progress);
  },
});

dash.calc('rereads', {
  inputs: ['reads'], title: 'Re-reads',
  description: 'Every read of a book read more than once.',
  fn: (reads) => reads.filter((r) => r.times_read > 1).map((r) => ({ read_id: r.read_id, book_id: r.book_id, title: r.title, author: r.author, read_no: r.read_no, start: r.start, end: r.end, days_read: r.days_read, hours: r.hours, progress: r.progress }))
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : a.read_no - b.read_no)),
});

// ---------- reading speed ----------
// Words per minute from days where Moon+ logged both (from 2019). Days that look like
// flicking through (> 800 wpm) or leaving the book open (< 40 wpm) are left out.
dash.calc('book_speed', {
  inputs: ['daily', 'books'], title: 'Speed per book',
  description: 'Words per minute for each book with 2+ hours of timed reading, and how it compares with your overall average.',
  fn: (daily, books) => {
    const ok = (d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800;
    const meta = new Map(books.map((b) => [b.id, b])), agg = new Map();
    let W = 0, M = 0;
    daily.filter(ok).forEach((d) => {
      const a = agg.get(d.book_id) || { w: 0, m: 0, days: 0 };
      a.w += d.words; a.m += d.minutes; a.days++; agg.set(d.book_id, a); W += d.words; M += d.minutes;
    });
    const avg = W / M;
    return [...agg].filter(([, a]) => a.m >= 120).map(([id, a]) => {
      const b = meta.get(id) || {};
      return { book_id: id, title: b.title, author: b.author, genre: b.genre, subgenre: b.subgenre, status: b.status,
        wpm: Math.round(a.w / a.m), hours: Math.round(a.m / 6) / 10, days: a.days, vs_avg: Math.round((a.w / a.m / avg - 1) * 1000) / 1000 };
    }).sort((x, y) => y.wpm - x.wpm);
  },
});

dash.calc('speed_overall', {
  inputs: ['daily', 'book_speed'], title: 'Speed headline',
  description: 'Your overall words per minute, and the fastest and slowest books.',
  fn: (daily, book_speed) => {
    const ok = (d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800;
    const v = daily.filter(ok), w = v.reduce((s, d) => s + d.words, 0), m = v.reduce((s, d) => s + d.minutes, 0);
    const f = book_speed[0] || {}, s = book_speed[book_speed.length - 1] || {};
    return [
      { metric: 'avg_wpm', value: m ? Math.round(w / m) : null },
      { metric: 'books_timed', value: book_speed.length },
      { metric: 'fastest_title', value: f.title || null }, { metric: 'fastest_wpm', value: f.wpm ?? null },
      { metric: 'slowest_title', value: s.title || null }, { metric: 'slowest_wpm', value: s.wpm ?? null },
    ];
  },
});

dash.calc('group_speed', {
  inputs: ['daily', 'books'], title: 'Speed by genre, subgenre and author',
  description: 'Words per minute across all timed reading in each genre (3+ hours), subgenre (5+ hours) and author (2+ books, 5+ hours).',
  fn: (daily, books) => {
    const ok = (d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800;
    const meta = new Map(books.map((b) => [b.id, b])), g = new Map();
    const add = (kind, name, genre, d) => {
      const k = kind + '|' + name, a = g.get(k) || { kind, name, genre, w: 0, m: 0, books: new Set() };
      a.w += d.words; a.m += d.minutes; a.books.add(d.book_id); g.set(k, a);
    };
    daily.filter(ok).forEach((d) => {
      const b = meta.get(d.book_id) || {};
      add('genre', b.genre || d.genre, b.genre || d.genre, d);
      add('subgenre', b.subgenre || 'Untagged', b.genre || d.genre, d);
      add('author', b.author || 'Unknown', b.genre || d.genre, d);
    });
    const min = { genre: { h: 3, n: 1 }, subgenre: { h: 5, n: 1 }, author: { h: 5, n: 2 } };
    return [...g.values()].filter((a) => a.m / 60 >= min[a.kind].h && a.books.size >= min[a.kind].n)
      .map((a) => ({ key: a.kind + '|' + a.name, kind: a.kind, name: a.name, genre: a.genre, wpm: Math.round(a.w / a.m), hours: Math.round(a.m / 6) / 10, books: a.books.size }))
      .sort((x, y) => y.wpm - x.wpm);
  },
});

dash.calc('speed_days', {
  inputs: ['daily'], title: 'Speed per day',
  description: 'Words per minute for each book on each timed day, for the speed-over-time chart.',
  fn: (daily) => {
    const ok = (d) => d.minutes >= 1 && d.words > 0 && d.words / d.minutes >= 40 && d.words / d.minutes <= 800;
    return daily.filter(ok).map((d) => ({ date: d.date, book_id: d.book_id, title: d.title, author: d.author, genre: d.genre,
      minutes: d.minutes, words: d.words, wpm: Math.round(d.words / d.minutes) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  },
});
