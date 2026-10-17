// Their favourites you haven't read (BOO-33): books a friend devoured (by the shape of the
// read, from the fingerprints calc run on their data) or read more than once, that aren't in
// your library. Ranked by how much of that genre you read and whether you know the author.
(() => {
  dash.calc('friend_favourites', {
    inputs: ['books', 'reads', 'friend_books', 'friend_fingerprints'],
    title: 'A friend’s favourites you haven’t read',
    description: 'Books a friend devoured or re-read that aren’t in your library, ranked by your share of reads in the genre and whether you’ve read the author.',
    fn: (books, reads, fBooks, fPrints) => {
      const { matcher, authorKey } = dash.sameBook;
      const have = matcher(books);
      const genreN = {}, authorN = {};
      reads.forEach((r) => { if (r.genre) genreN[r.genre] = (genreN[r.genre] || 0) + 1; });
      books.forEach((b) => { const k = authorKey(b.author); if (k) authorN[k] = (authorN[k] || 0) + 1; });
      const total = reads.length || 1;
      const prints = new Map();
      fPrints.forEach((f) => { if (f.finished) prints.set(f.book_id, f); });
      return fBooks
        .map((b) => {
          const f = prints.get(b.id), again = (b.times_read || 1) > 1;
          if (!(f && f.shape === 'devoured') && !again) return null;
          if (have(b)) return null;
          const genre = (genreN[b.genre] || 0) / total, known = authorN[authorKey(b.author)] || 0;
          return {
            book_id: b.id, title: b.title, author: b.author, genre: b.genre, subgenre: b.subgenre, isbn13: b.isbn13 || null,
            devoured: !!(f && f.shape === 'devoured'), reread: again,
            days: f ? f.span_days : null, mins_per_day: f ? f.mins_per_day : null, spark: f ? f.spark : [],
            end: f ? f.end : b.last_read, your_genre_reads: genreN[b.genre] || 0, your_author_books: known,
            score: Math.round((genre + (known ? 0.3 + 0.05 * Math.min(known, 4) : 0) + (again ? 0.1 : 0)) * 1000) / 1000,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || (a.days ?? 99) - (b.days ?? 99) || a.title.localeCompare(b.title));
    },
  });

  const { el, fmt, ref, chip, plural } = rh;
  let pick = 'all';

  function sparkSvg(values, color) {
    const ns = 'http://www.w3.org/2000/svg', w = 64, h = 22, svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('class', 'ff-spark'); svg.setAttribute('aria-hidden', 'true');
    const top = Math.max(1, ...values), bw = w / Math.max(values.length, 1);
    values.forEach((v, i) => {
      if (!v) return;
      const r = document.createElementNS(ns, 'rect'), bh = Math.max(1.5, (v / top) * (h - 1));
      [['x', i * bw + 0.5], ['width', Math.max(1, bw - 1)], ['y', h - bh], ['height', bh], ['rx', 1], ['fill', color]].forEach(([k, val]) => r.setAttribute(k, val));
      svg.append(r);
    });
    return svg;
  }

  rh.card({
    tab: 'friends', id: 'friends-favourites', title: 'Their favourites you haven’t read', after: 'card-friends-list', calc: 'books',
    note: 'Books a friend tore through (most days, long sittings, done fast) or read more than once, and that aren’t in your library. Most like what you read first.',
    draw(box, _rows, parts) {
      box.replaceChildren();
      const fr = rh.friends;
      if (!fr || fr.status() !== 'ok' || !fr.list().length) { parts.card.hidden = true; return; }
      parts.card.hidden = false;
      const mine = (k) => dash.data(k).data || [];
      const all = fr.list().flatMap((f) => dash.calcWith('friend_favourites', {
        books: mine('books'), reads: mine('reads'), friend_books: f.books, friend_fingerprints: fr.calc(f.slug, 'fingerprints'),
      }).map((r) => ({ ...r, friend: f })));
      // the same book from two friends: once, crediting both
      const seen = new Map();
      all.forEach((r) => {
        const k = dash.sameBook.keys(r).at(-1);
        if (seen.has(k)) seen.get(k).also.push(r.friend); else seen.set(k, { ...r, also: [] });
      });
      const rows = [...seen.values()].sort((a, b) => b.score + b.also.length * 0.2 - (a.score + a.also.length * 0.2));

      const seg = el('div', 'fr-pick');
      const counts = { all: rows.length };
      rows.forEach((r) => [r.friend, ...r.also].forEach((f) => (counts[f.slug] = (counts[f.slug] || 0) + 1)));
      [['all', 'Everyone'], ...fr.list().map((f) => [f.slug, f.name])].forEach(([k, label]) => {
        const b = el('button', 'fr-pill', `${label} ${fmt(counts[k] || 0)}`);
        b.type = 'button'; b.setAttribute('aria-pressed', String(k === pick));
        if (k !== 'all') { const sw = el('i', 'sw'); sw.style.background = fr.color(k); b.prepend(sw); }
        b.addEventListener('click', () => { pick = k; rh.redraw(); });
        seg.append(b);
      });
      box.append(seg);
      const shown = rows.filter((r) => pick === 'all' || r.friend.slug === pick || r.also.some((f) => f.slug === pick));
      if (!shown.length) { box.append(el('div', 'dy-empty', 'Nothing yet: you’ve read all their favourites, or they haven’t shared enough reading.')); return; }
      const list = el('ul', 'ff-list');
      shown.slice(0, 12).forEach((r) => {
        const li = el('li', 'ff-item');
        const text = el('div', 'ff-text');
        text.append(el('b', 'ff-title', r.title), ref(r, 'author'));
        const tags = el('div', 'ff-tags');
        const g = chip('genre', r.genre); g.style.color = rh.gColor(r.genre); tags.append(g);
        text.append(tags);
        const why = el('p', 'ff-why');
        const people = [r.friend, ...r.also].map((f) => f.name).join(' and ');
        why.append(r.devoured ? `${people} devoured it${r.days ? ` in ${plural(r.days, 'day')}` : ''}` : `${people} read it more than once`);
        if (r.reread && r.devoured) why.append(', and went back for more');
        if (r.your_author_books) why.append(` · you’ve read ${plural(r.your_author_books, 'book')} by this author`);
        else if (r.your_genre_reads) why.append(` · you’ve read ${plural(r.your_genre_reads, `${/[A-Z]{2}/.test(r.genre) ? r.genre : r.genre.toLowerCase()} book`)}`);
        text.append(why);
        const side = el('div', 'ff-side');
        if (r.spark.length) side.append(sparkSvg(r.spark, fr.color(r.friend.slug)));
        if (r.mins_per_day) side.append(el('span', 'ff-n', `${fmt(r.mins_per_day)} min a day`));
        // the admin's book manager (BOO-64), when there is one
        const getIt = rh.arrGetButton && rh.arrGetButton(r);
        if (getIt) text.append(getIt);
        li.append(text, side);
        list.append(li);
      });
      box.append(list);
      if (shown.length > 12) box.append(el('p', 'note', `And ${fmt(shown.length - 12)} more.`));
    },
  });
})();
