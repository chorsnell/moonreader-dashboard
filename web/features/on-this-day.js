// On this day (BOO-84): what you were reading on today's date in earlier years, with a
// highlight from that day if there is one, on the Overview. Needs exact days, so it's hidden
// from visitors who get dates rounded or no diary.
(() => {
  const { el, fmt, fDay, pDate, cover, byline, linkBook, mins } = rh;

  // the same month and day in an earlier year; 29 Feb falls back to 28 Feb
  const sameDay = (year, md) => {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return `${year}-${md === '02-29' && !leap ? '02-28' : md}`;
  };

  dash.calc('on_this_day', {
    inputs: ['daily', 'reads', 'as_of'],
    title: 'On this day',
    description: 'For each earlier year with reading on the latest day\'s month and day: the books read that day (minutes, progress, started or finished), or, when nothing was opened, the books on the go then. Newest year first.',
    fn: (daily, reads, as_of) => {
      const today = as_of[0].date, y0 = +today.slice(0, 4), md = today.slice(5);
      const first = daily.reduce((m, d) => (d.date < m ? d.date : m), today);
      const out = [];
      for (let y = y0 - 1; y >= +first.slice(0, 4); y--) {
        const date = sameDay(y, md);
        if (date < first) break;
        const base = { date, year: y, years_ago: y0 - y };
        const days = daily.filter((d) => d.date === date && (d.minutes > 0 || d.words > 0));
        const event = (id) => {
          const r = reads.find((x) => x.book_id === id && (x.start === date || (x.finished === true && x.end === date)));
          return !r ? null : r.finished === true && r.end === date ? 'finished' : r.read_no > 1 ? 'reread' : 'started';
        };
        if (days.length) {
          days.slice().sort((a, b) => (b.minutes || 0) - (a.minutes || 0)).forEach((d) => out.push({
            ...base, book_id: d.book_id, title: d.title, author: d.author || '', genre: d.genre,
            opened: true, minutes: d.minutes || 0, words: d.words || 0, progress: d.progress ?? null, event: event(d.book_id),
          }));
          continue;
        }
        // nothing opened that day: what was on the go
        reads.filter((r) => r.start < date && r.end > date).forEach((r) => out.push({
          ...base, book_id: r.book_id, title: r.title, author: r.author || '', genre: r.genre,
          opened: false, minutes: 0, words: 0, progress: null, event: null,
        }));
      }
      return out;
    },
  });

  // the viewer's own date: the backup's "today" is usually the day before
  const localToday = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  function rowsFor(rows) {
    const asOf = rh.D('as_of'), t = localToday();
    if (asOf.status !== 'ok' || !asOf.data[0] || t <= asOf.data[0].date) return rows;
    // later than the backup: work it out again for today (the server did it for the backup date)
    const daily = rh.D('daily'), reads = rh.D('reads');
    if (daily.status !== 'ok' || reads.status !== 'ok') return rows;
    return dash.calcWith('on_this_day', { daily: daily.data, reads: reads.data, as_of: [{ date: t }] });
  }
  const ago = (n) => (n === 1 ? 'A year ago' : `${fmt(n)} years ago`);
  const EVENT = { finished: 'Finished', started: 'Started', reread: 'Started re-read' };

  rh.card({
    tab: 'overview',
    id: 'on-this-day',
    title: 'On this day',
    note: 'What you were reading on this date in earlier years.',
    calc: 'on_this_day',
    before: 'card-years',
    privacy: ['exact_dates', 'diary'],
    hidden: () => { const d = rh.D('on_this_day'); return d.status === 'ok' && !rowsFor(d.data).length; },
    draw(box, all, parts) {
      const rows = rowsFor(all);
      parts.card.classList.add('otd-card');
      const hl = rh.D('highlights');
      const notes = hl.status === 'ok' ? hl.data.filter((h) => h.kind !== 'bookmark' && h.text && h.text.length <= 600) : [];
      const years = d3.groups(rows, (r) => r.date);
      box.replaceChildren(...years.map(([date, list]) => {
        const yr = el('div', 'otd-year'), head = el('div', 'otd-head');
        const open = el('button', 'ck-date otd-open', 'Open in diary');
        open.type = 'button'; open.title = 'Open this day in the diary';
        open.addEventListener('click', () => rh.openDiary(date));
        head.append(el('b', null, ago(list[0].years_ago)), el('span', 'otd-date', fDay(pDate(date))), open);
        yr.append(head);
        if (!list[0].opened) yr.append(el('p', 'otd-quiet', `No reading that day; on the go:`));
        const books = el('div', 'otd-books');
        list.forEach((r) => {
          const bk = linkBook(el('div', 'otd-book'), r.book_id), t = el('div', 'otd-t');
          t.append(el('span', 'otd-ttl', r.title));
          if (r.event) t.append(el('span', 'ev ' + r.event, EVENT[r.event]));
          t.append(byline('small', 'by', r));
          const bits = [];
          if (r.minutes) bits.push(mins(r.minutes));
          if (r.progress != null) bits.push(`${Math.round(r.progress)}%`);
          bk.append(cover(r.book_id, r.title, r.genre, 'xs'), t, el('div', 'otd-m', bits.join(' · ')));
          books.append(bk);
        });
        yr.append(books);
        // a passage highlighted that day, in one of these books if possible
        const ids = new Set(list.map((r) => r.book_id));
        const day = notes.filter((h) => h.date === date);
        const q = day.find((h) => ids.has(h.book_id)) || day[0];
        if (q) {
          yr.append(el('blockquote', 'otd-quote', q.text));
          if (q.note) yr.append(el('p', 'otd-note', q.note));
          // highlighted in a book that isn't listed (one only opened for a moment)
          if (!ids.has(q.book_id)) { const src = el('div', 'otd-src'); src.append('— ', rh.ref(q, 'title', (rh.D('books').data.find((b) => b.id === q.book_id) || {}).title || 'a book')); yr.append(src); }
        }
        return yr;
      }));
    },
  });
})();
