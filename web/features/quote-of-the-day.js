// Quote of the day: one of your highlights on the Overview, a different one each day.
(() => {
  const { el, ref, byline, cover, fDay, pDate, iso } = rh;

  // highlights worth showing on their own, with their book's title, author and genre
  dash.calc('quote_pool', {
    inputs: ['highlights', 'books'],
    title: 'Quote of the day: candidates',
    description: 'Highlights and notes of 15 to 600 characters, in books still in the library, oldest first.',
    fn: (highlights, books) => {
      const byId = new Map(books.map((b) => [b.id, b]));
      return highlights
        .filter((h) => h.kind !== 'bookmark' && byId.has(h.book_id) && h.text.length >= 15 && h.text.length <= 600)
        .map((h) => { const b = byId.get(h.book_id); return { ...h, title: b.title, author: b.author, series: b.series, series_no: b.series_no, genre: b.genre }; });
    },
  });

  // the same pick all day (local date), so it's a quote of the day rather than of the page load
  const hash = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.codePointAt(0), 16777619); return x >>> 0; };
  const today = () => { const d = new Date(); return iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); };
  let extra = 0;

  rh.card({
    tab: 'overview',
    id: 'quote',
    title: 'Quote of the day',
    calc: 'quote_pool',
    before: 'card-years',
    hidden: () => { const d = rh.D('quote_pool'); return d.status === 'ok' && !d.data.length; },
    draw(box, rows, parts) {
      if (!rows.length) return;
      let i = hash(today()) % rows.length;
      // "another" jumps around the library rather than to the next highlight in the same book
      for (let n = 1; n <= extra; n++) { const j = hash(`${today()}#${n}`) % rows.length; i = j === i ? (i + 1) % rows.length : j; }
      const q = rows[i];
      parts.card.classList.add('qd-card');
      if (rows.length > 1 && !parts.head.querySelector('.qd-next')) {
        const next = el('button', 'rng-sel qd-next', 'Another');
        next.type = 'button';
        next.addEventListener('click', () => { extra++; rh.redraw(); });
        parts.head.append(next);
      }
      const body = el('div', 'qd-body');
      body.append(el('blockquote', 'qd-text', q.text));
      if (q.note) body.append(el('p', 'qd-note', q.note));
      const src = el('div', 'qd-src');
      src.append('— ', ref(q, 'title'));
      body.append(src, byline('div', 'qd-by', q));
      if (q.date) body.append(el('div', 'qd-when', `Highlighted ${fDay(pDate(q.date))}`));
      box.replaceChildren(rh.linkBook(cover(q.book_id, q.title, q.genre, 'qd-cv'), q.book_id), body);
    },
  });
})();
