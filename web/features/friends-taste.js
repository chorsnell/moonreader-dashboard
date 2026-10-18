// Taste match (BOO-31): how alike your reading is to a friend's. A compatibility score from
// genres, authors, books in common and (BOO-93) how alike you rate the books you share; a Venn of shared authors; and the books you both
// read, with how long each of you took and how fast you went.
(() => {
  const DAY = 864e5;
  const span = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY) + 1;

  // one person's latest read of each book: days, hours and words per minute
  function readStats(reads, daily) {
    const byBook = new Map();
    reads.forEach((r) => {
      const had = byBook.get(r.book_id);
      // a finished read wins over one given up; then the latest
      if (!had || (r.finished && !had.finished) || (!!r.finished === !!had.finished && r.start > had.start)) byBook.set(r.book_id, r);
    });
    const days = new Map();
    daily.forEach((d) => { if (!days.has(d.book_id)) days.set(d.book_id, []); days.get(d.book_id).push(d); });
    const out = new Map();
    byBook.forEach((r, id) => {
      const ds = (days.get(id) || []).filter((d) => d.date >= r.start && d.date <= r.end && d.minutes > 0 && d.words > 0);
      const m = ds.reduce((a, d) => a + d.minutes, 0), w = ds.reduce((a, d) => a + d.words, 0);
      out.set(id, {
        finished: r.finished === true, progress: r.progress, start: r.start, end: r.end,
        days: r.start && r.end ? span(r.start, r.end) : null,
        hours: r.hours ?? (m ? Math.round(m / 6) / 10 : null),
        wpm: m >= 20 ? Math.round(w / m) : null,
      });
    });
    return out;
  }

  // reads per genre as shares of all reads
  function genreShares(reads) {
    const n = {};
    reads.forEach((r) => { if (r.genre) n[r.genre] = (n[r.genre] || 0) + 1; });
    const total = Object.values(n).reduce((a, b) => a + b, 0) || 1;
    return Object.fromEntries(Object.entries(n).map(([g, v]) => [g, v / total]));
  }

  // authors with how many of their books each person has opened
  function authorCounts(books, key) {
    const out = new Map();
    books.forEach((b) => {
      if (!b.author || b.status === 'not_started') return;
      const k = key(b.author);
      if (!k) return;
      const had = out.get(k) || { author: b.author, n: 0 };
      had.n++;
      out.set(k, had);
    });
    return out;
  }

  // rating agreement counts once you've both rated this many of the same books
  const RATED_MIN = 3;
  // weights without ratings, and with them (the other three keep their proportions)
  const WEIGHTS = { genre: 0.5, author: 0.3, books: 0.2 };
  const WEIGHTS_RATED = { genre: 0.4, author: 0.24, books: 0.16, ratings: 0.2 };
  const stars = (v) => (typeof v === 'number' && v > 0 && v <= 5 ? v : null);

  dash.calc('taste_match', {
    inputs: ['books', 'reads', 'daily', 'friend_books', 'friend_reads', 'friend_daily'],
    title: 'Taste match',
    description: 'How alike two readers are: a 0–100 score (half genres, three tenths authors, a fifth books in common; with 3+ books you both rated, a fifth goes to how alike your star ratings are), shared and separate authors, and the books both read with each one’s days, hours and speed.',
    fn: (books, reads, daily, fBooks, fReads, fDaily) => {
      const { shared, authorKey } = dash.sameBook;
      // genres: cosine similarity of the shares of reads
      const a = genreShares(reads), b = genreShares(fReads);
      const genres = [...new Set([...Object.keys(a), ...Object.keys(b)])];
      const dot = genres.reduce((s, g) => s + (a[g] || 0) * (b[g] || 0), 0);
      const norm = (v) => Math.sqrt(Object.values(v).reduce((s, x) => s + x * x, 0));
      const genre = norm(a) && norm(b) ? dot / (norm(a) * norm(b)) : 0;
      // authors: Jaccard
      const am = authorCounts(books, authorKey), at = authorCounts(fBooks, authorKey);
      const both = [...am.keys()].filter((k) => at.has(k));
      const union = new Set([...am.keys(), ...at.keys()]).size;
      const author = union ? both.length / union : 0;
      // books: share of the smaller library you have in common
      const pairs = shared(books.filter((x) => x.status !== 'not_started'), fBooks.filter((x) => x.status !== 'not_started'));
      const smaller = Math.min(books.length, fBooks.length);
      const common = smaller ? pairs.length / smaller : 0;
      // a book in common is a strong signal: a fifth of a library in common counts as all of it
      const bookPart = Math.min(1, common * 5);
      // ratings: 1 minus the average gap in stars over the books you both rated (4 stars apart is 0)
      const rated = pairs.map(({ mine: x, theirs: y }) => [stars(x.rating), stars(y.rating)]).filter(([x, y]) => x != null && y != null);
      const gap = rated.length ? rated.reduce((s2, [x, y]) => s2 + Math.abs(x - y), 0) / rated.length : null;
      const ratings = rated.length >= RATED_MIN ? Math.max(0, 1 - gap / 4) : null;
      const authorPart = Math.min(1, author * 2);
      const W = ratings == null ? WEIGHTS : WEIGHTS_RATED;
      const score = Math.round(100 * (W.genre * genre + W.author * authorPart + W.books * bookPart + (ratings == null ? 0 : W.ratings * ratings)));

      const ms = readStats(reads, daily), ts = readStats(fReads, fDaily);
      const sortN = (m, keys) => keys.map((k) => m.get(k)).sort((x, y) => y.n - x.n || x.author.localeCompare(y.author));
      return [{
        score,
        parts: { genre: Math.round(genre * 100), author: Math.round(authorPart * 100), books: Math.round(bookPart * 100), ratings: ratings == null ? null : Math.round(ratings * 100) },
        // books you both rated, and the average gap between your stars
        rated: rated.length, rated_min: RATED_MIN, star_gap: gap == null ? null : Math.round(gap * 100) / 100,
        genres: genres.map((g) => ({ genre: g, mine: a[g] || 0, theirs: b[g] || 0 })).sort((x, y) => y.mine + y.theirs - x.mine - x.theirs),
        authors: {
          both: both.map((k) => ({ author: am.get(k).author, mine: am.get(k).n, theirs: at.get(k).n })).sort((x, y) => y.mine + y.theirs - x.mine - x.theirs),
          mine: sortN(am, [...am.keys()].filter((k) => !at.has(k))),
          theirs: sortN(at, [...at.keys()].filter((k) => !am.has(k))),
        },
        books: pairs.map(({ mine, theirs }) => ({
          book_id: mine.id, title: mine.title, author: mine.author, genre: mine.genre,
          mine: ms.get(mine.id) || null, theirs: ts.get(theirs.id) || null,
          // star ratings, when imported (Goodreads, StoryGraph)
          my_rating: mine.rating ?? null, their_rating: theirs.rating ?? null,
        })).sort((x, y) => ((y.mine?.end || '') > (x.mine?.end || '') ? 1 : -1)),
      }];
    },
  });

  // ---------- drawing ----------
  const { el, fmt, ref, linkBook, svgIn, showTip, hideTip, tipLines, plural } = rh;
  const VERDICT = [[75, 'Kindred spirits'], [55, 'Plenty in common'], [35, 'Some overlap'], [0, 'Different shelves']];
  const lower = (g) => (/[A-Z]{2}/.test(g) ? g : g.toLowerCase());
  const pctTxt = (v) => Math.round(v * 100) + '%';

  function compute(friend) {
    const mine = (k) => dash.data(k).data || [];
    return dash.calcWith('taste_match', {
      books: mine('books'), reads: mine('reads'), daily: mine('daily'),
      friend_books: friend.books, friend_reads: friend.reads, friend_daily: friend.daily,
    })[0];
  }
  const who = (name, color) => { const s = el('span', 'fr-who'), sw = el('i', 'sw'); sw.style.background = color; s.append(sw, name); return s; };

  rh.card({
    tab: 'friends', id: 'friends-taste', title: 'Taste match', after: 'card-friends-list', calc: 'books',
    note: 'How alike your reading is: half from genres, the rest from authors and books you’ve both read. Once you’ve both rated 3 of the same books, a fifth comes from how alike your star ratings are.',
    draw(box, _rows, parts) {
      box.replaceChildren();
      const f = rh.friends && rh.friends.selected();
      if (!f) { parts.card.hidden = true; return; }
      parts.card.hidden = false;
      parts.h.textContent = `Taste match with ${f.name}`;
      const m = compute(f), me = rh.friends.color('me'), them = rh.friends.color(f.slug);

      // the score and its three parts
      const head = el('div', 'tm-head');
      const big = el('div', 'tm-score');
      big.append(el('b', null, String(m.score)), el('span', null, VERDICT.find(([t]) => m.score >= t)[1]));
      const bars = el('div', 'tm-parts');
      const partRows = [['Genres', m.parts.genre], ['Authors', m.parts.author], ['Books in common', m.parts.books]];
      if (m.parts.ratings != null) partRows.push(['Star ratings', m.parts.ratings]);
      partRows.forEach(([l, v]) => {
        const row = el('div', 'tm-part'), bar = el('div', 'pbar'), fill = el('i');
        fill.style.width = v + '%'; fill.style.background = 'var(--series-1)'; bar.append(fill);
        row.append(el('span', null, l), bar, el('b', null, v + '%'));
        bars.append(row);
      });
      // how the ratings part came about, or why it isn't counted yet
      if (m.parts.ratings != null) bars.append(el('p', 'tm-rated', `From ${plural(m.rated, 'book')} you both rated: ${m.star_gap === 0 ? 'the same stars every time' : `${fmt(m.star_gap)} star${m.star_gap === 1 ? '' : 's'} apart on average`}.`));
      else if (m.rated > 0) bars.append(el('p', 'tm-rated', `Star ratings count once you’ve both rated ${m.rated_min} of the same books (${fmt(m.rated)} so far).`));
      head.append(big, bars);
      box.append(head);

      // one sentence: what you share, and where you differ most
      const top = m.genres.slice().sort((x, y) => Math.min(y.mine, y.theirs) - Math.min(x.mine, x.theirs))[0];
      const diff = m.genres.slice().sort((x, y) => y.theirs - y.mine - (x.theirs - x.mine))[0];
      const take = el('p', 'fp-take');
      if (top && Math.min(top.mine, top.theirs) > 0.05) take.append('You both read plenty of ', ref({ genre: top.genre }, 'genre', lower(top.genre)));
      if (diff && diff.theirs - diff.mine > 0.08) take.append(take.childNodes.length ? `; ${f.name} reads far more ` : `${f.name} reads far more `, ref({ genre: diff.genre }, 'genre', lower(diff.genre)));
      if (take.childNodes.length) { take.append('.'); box.append(take); }

      // genres side by side: you to the left, them to the right
      const gbox = el('div', 'tm-genres');
      box.append(el('h3', 'tm-h', 'Genres, as a share of reads'), gbox);
      const leg = el('div', 'legend');
      leg.append(who('You', me), who(f.name, them));
      gbox.append(leg);
      const rows = m.genres.slice(0, 10), bh = 18, gap = 6, h = rows.length * (bh + gap) + 4;
      const { svg, w, tip } = svgIn(gbox, h);
      const mid = w / 2, lw = Math.min(150, w * 0.32), half = (w - lw) / 2 - 8;
      const x = d3.scaleLinear([0, d3.max(rows, (r) => Math.max(r.mine, r.theirs)) || 1], [0, half]);
      const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * (bh + gap)})`);
      // your bars grow leftwards: drawn rightwards from 0, then mirrored
      g.append('path').attr('fill', me).attr('d', (d) => rh.barPath(0, 0, x(d.mine), bh, 'right')).attr('transform', `translate(${mid - lw / 2},0) scale(-1,1)`);
      g.append('path').attr('fill', them).attr('d', (d) => rh.barPath(mid + lw / 2, 0, x(d.theirs), bh, 'right'));
      g.append('text').attr('class', 'axl').attr('x', mid).attr('y', bh / 2).attr('dy', '0.35em').attr('text-anchor', 'middle').text((d) => d.genre).call(rh.links, 'genre', (d) => d.genre);
      g.append('rect').attr('class', 'hit').attr('x', 0).attr('width', w).attr('height', bh).attr('fill', 'transparent')
        .on('mousemove', (e, d) => showTip(tip, gbox, e, (t) => tipLines(t, d.genre, [[me, 'You', pctTxt(d.mine)], [them, f.name, pctTxt(d.theirs)]])))
        .on('mouseleave', () => hideTip(tip));

      // authors: a Venn
      box.append(el('h3', 'tm-h', 'Authors'));
      const venn = el('div', 'tm-venn');
      box.append(venn);
      const nm = m.authors.mine.length + m.authors.both.length, nt = m.authors.theirs.length + m.authors.both.length, nb = m.authors.both.length;
      {
        const vh = 150, { svg: vs, w: vw } = svgIn(venn, vh);
        const maxR = vh / 2 - 6, k = maxR / Math.sqrt(Math.max(nm, nt, 1));
        const r1 = Math.max(18, k * Math.sqrt(nm)), r2 = Math.max(18, k * Math.sqrt(nt));
        // overlap set so the shared lens grows with the shared share
        const share = nb / Math.max(1, Math.min(nm, nt));
        const d = (r1 + r2) * (1 - 0.6 * share) - Math.min(r1, r2) * 0.2 * share;
        const cx = vw / 2, c1 = cx - d / 2, c2 = cx + d / 2, cy = vh / 2;
        vs.append('circle').attr('cx', c1).attr('cy', cy).attr('r', r1).attr('fill', me).attr('fill-opacity', 0.25).attr('stroke', me).attr('stroke-width', 1.5);
        vs.append('circle').attr('cx', c2).attr('cy', cy).attr('r', r2).attr('fill', them).attr('fill-opacity', 0.25).attr('stroke', them).attr('stroke-width', 1.5);
        // each count in the middle of its region, or just outside when the region is too thin
        const label = (xx, txt, anchor = 'middle') => vs.append('text').attr('class', 'tm-vn').attr('x', xx).attr('y', cy).attr('dy', '0.35em').attr('text-anchor', anchor).text(txt);
        const left = [c1 - r1, Math.min(c2 - r2, c1 + r1)], lens = [Math.max(c1 - r1, c2 - r2), Math.min(c1 + r1, c2 + r2)], right = [Math.max(c1 + r1, c2 - r2), c2 + r2];
        const fit = ([x0, x1], txt, out, anchor) => (x1 - x0 > 14 + 11 * txt.length ? label((x0 + x1) / 2, txt) : label(out, txt, anchor));
        fit(left, fmt(m.authors.mine.length), c1 - r1 - 6, 'end');
        if (nb) fit(lens, fmt(nb), cx, 'middle');
        fit(right, fmt(m.authors.theirs.length), c2 + r2 + 6, 'start');
      }
      const cols = el('div', 'tm-cols');
      const col = (title, list, fmtN) => {
        const c = el('div', 'tm-col');
        c.append(el('h4', null, title));
        const ul = el('ul');
        list.slice(0, 8).forEach((a) => { const li = el('li'); li.append(ref(a, 'author'), el('span', 'tm-n', fmtN(a))); ul.append(li); });
        if (list.length > 8) ul.append(el('li', 'tm-more', `and ${fmt(list.length - 8)} more`));
        if (!list.length) ul.append(el('li', 'tm-more', 'None'));
        c.append(ul);
        return c;
      };
      cols.append(col(`Only you (${fmt(m.authors.mine.length)})`, m.authors.mine, (a) => plural(a.n, 'book')),
        col(`Both of you (${fmt(nb)})`, m.authors.both, (a) => `${a.mine} · ${a.theirs}`),
        col(`Only ${f.name} (${fmt(m.authors.theirs.length)})`, m.authors.theirs, (a) => plural(a.n, 'book')));
      box.append(cols);

      // books you both read
      box.append(el('h3', 'tm-h', `Books you’ve both read (${fmt(m.books.length)})`));
      if (!m.books.length) { box.append(el('div', 'dy-empty', 'None yet.')); return; }
      const wrap = el('div', 'tm-tbl'), tbl = el('table'), thead = el('thead'), hr = el('tr');
      [['Book'], ['You', 'n'], [f.name, 'n'], ['Your speed', 'n hide-sm'], [`${f.name}’s speed`, 'n hide-sm']].forEach(([t, c]) => hr.append(el('th', c || null, t)));
      thead.append(hr);
      const tbody = el('tbody');
      const time = (td, s) => {
        if (!s) td.textContent = '—';
        else if (!s.finished) td.textContent = `left at ${Math.round(s.progress || 0)}%`;
        else { td.textContent = plural(s.days, 'day'); if (s.hours) td.append(el('span', 'hide-sm', ` · ${fmt(s.hours)} h`)); }
        return td;
      };
      m.books.slice(0, 40).forEach((b) => {
        const tr = el('tr');
        linkBook(tr, b.book_id);
        const t = el('td');
        t.append(el('div', 'tm-title', b.title), ref(b, 'author'));
        if (b.my_rating || b.their_rating) t.append(el('span', 'tm-stars', ` · ★ you ${b.my_rating ?? '–'}, ${f.name} ${b.their_rating ?? '–'}`));
        const quick = b.mine && b.theirs && b.mine.finished && b.theirs.finished ? (b.mine.days < b.theirs.days ? 'mine' : b.theirs.days < b.mine.days ? 'theirs' : null) : null;
        const cell = (s, side) => { const td = time(el('td', 'n'), s); if (quick === side) td.classList.add('tm-win'); return td; };
        const fast = b.mine?.wpm && b.theirs?.wpm ? (b.mine.wpm > b.theirs.wpm ? 'mine' : 'theirs') : null;
        const sp = (s, side) => { const td = el('td', 'n hide-sm', s?.wpm ? `${fmt(s.wpm)} wpm` : '—'); if (fast === side) td.classList.add('tm-win'); return td; };
        tr.append(t, cell(b.mine, 'mine'), cell(b.theirs, 'theirs'), sp(b.mine, 'mine'), sp(b.theirs, 'theirs'));
        tbody.append(tr);
      });
      tbl.append(thead, tbody);
      wrap.append(tbl);
      box.append(wrap, el('p', 'note', 'Bold: who finished in fewer days, or read faster.'));
    },
  });
})();
