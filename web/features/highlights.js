// Highlights, notes and bookmarks from Moon+ and the imports (data/highlights.json), on each book's page.
(() => {
  const { el, fmt, plural } = rh;

  // optional: libraries built before highlights were imported have no such file
  dash.file('highlights', 'data/highlights.json', { optional: true });

  const fWhen = d3.timeFormat('%-d %b %Y, %H:%M');
  const KIND = { highlight: 'Highlight', note: 'Note', bookmark: 'Bookmark' };
  // where in the book: by the estimated %, then by when it was made
  const byPlace = (a, b) => (a.progress ?? 1e9) - (b.progress ?? 1e9) || (a.time || '').localeCompare(b.time || '');

  function item(h) {
    const li = el('li', 'hl-item hl-k-' + h.kind);
    li.id = 'hl-' + h.id;
    if (h.colour) li.style.setProperty('--hl', h.colour);
    if (h.kind === 'bookmark') li.append(el('div', 'hl-mark', h.text));
    else li.append(el('blockquote', 'hl-text', h.text));
    if (h.note) li.append(el('p', 'hl-note', h.note));
    const meta = [];
    if (h.kind !== 'highlight') meta.push(KIND[h.kind]);
    if (h.progress != null) meta.push(`${fmt(Math.round(h.progress))}%`);
    if (h.chapter != null) meta.push(`chapter ${h.chapter}`);
    if (h.time) meta.push(fWhen(new Date(h.time)));
    li.append(el('div', 'hl-meta', meta.join(' · ')));
    return li;
  }

  rh.bookCard({
    id: 'bk-highlights',
    title: 'Highlights & notes',
    calc: 'highlights',
    before: 'card-bk-log',
    draw(box, rows, parts, book) {
      const mine = rows.filter((h) => h.book_id === book.id).sort(byPlace);
      if (!mine.length) return false;
      const n = (k) => mine.filter((h) => h.kind === k).length;
      const counts = ['highlight', 'note', 'bookmark'].filter((k) => n(k)).map((k) => plural(n(k), k));
      parts.note.hidden = false;
      parts.note.textContent = `${counts.join(', ')}, in the order they come in the book. ` +
        'How far in (%) is estimated from how far you read on the day you made each one.';
      const list = el('ul', 'hl-list');
      list.append(...mine.map(item));
      box.replaceChildren(list);
    },
  });
})();
