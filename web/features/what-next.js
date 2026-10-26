// What should I read next? (BOO-79): the to-read pile (to-read.js) ranked by your own patterns,
// after the books you've put in your own order ("Up next", saved in want_to_read.json and
// marked up_next on the pile), which the admin drags, or moves with the arrow buttons,
// each pick with the reasons it scored. The scoring is one pure calc, next_reads, so the
// server works it out too; friends' opinions are page-only data, so on the server they're
// an empty input (next_friend_votes) and the page works the ranking out again with them.
//
// Score (0–100) = the sum of weight × signal, each signal between 0 and 1:
//   series pull     30  the next book in a series you've been reading (fading over 3 years);
//                       else an author you've finished 2+ books by (up to 0.6)
//   genre fit       20  half how much of the genre you read in the last 2 years, a quarter
//                       how fast you get through it, a quarter how often you finish it
//   friends         20  a friend rated it 4–5, devoured it or re-read it (finished: a little;
//                       gave up or rated it 1–2: counts against), weighted by taste match
//   palate cleanser 15  after a long read (just finished, or on the go), a short book in
//                       another genre
//   season          10  a genre you finish more of around this time of year than usual
//   waiting          5  how long it has waited (full marks at 2 years)
(() => {
  const { el, fmt, plural } = rh;
  const DAY = 864e5, t = (s) => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');
  const WEIGHTS = { series: 30, genre: 20, friends: 20, cleanser: 15, season: 10, waiting: 5 };
  const NEXT = { fadeDays: 3 * 365, authorBooks: 2, longTimes: 1.5, longDays: 28, recentDays: 30, shortTimes: 0.6, minYears: 2, waitFull: 730, giveUpDays: 60 };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const median = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const lower = (g) => (/[A-Z]{2}/.test(g) ? g : String(g).toLowerCase());
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  // friends' opinions of books on your pile: none unless the page passes them in
  dash.calc('next_friend_votes', { inputs: [], title: 'Friends’ opinions of your to-read pile', description: 'Filled in on the page from friends’ data; empty on the server.', fn: () => [] });

  dash.calc('next_reads', {
    inputs: ['to_read_pile', 'books', 'reads', 'as_of', 'next_friend_votes'],
    title: 'What to read next',
    description: 'Your Up next books first, in your order; then the rest of the to-read pile ranked 0–100 from your own patterns: series pull (30), genre fit (20: how much, how fast and how often you finish it), friends’ opinions weighted by taste match (20), a palate cleanser after a long read (15), seasonal habits (10) and how long it has waited (5); with the reasons each book scored.',
    fn: (pile, books, reads, asOf, votes) => {
      if (!pile.length) return [];
      const end = (asOf[0] && asOf[0].date) || new Date().toISOString().slice(0, 10), now = t(end);
      const { keys, authorKey } = dash.sameBook;
      const meta = new Map(books.map((b) => [b.id, b]));
      const lengthOf = (b) => (b && b.words > 0 ? b.words / Math.max(1, b.times_read || 1) : null);
      const typical = median(books.filter((b) => b.status === 'finished').map(lengthOf)) || 80000;
      // first reads, finished or given up
      const firsts = reads.filter((r) => r.read_no === 1 || r.read_no == null).map((r) => {
        const b = meta.get(r.book_id) || {};
        const gaveUp = r.finished !== true && now - t(r.end) > NEXT.giveUpDays * DAY;
        return { ...r, title: r.title || b.title, genre: r.genre || b.genre, words: lengthOf(b), days: Math.max(1, Math.round((t(r.end) - t(r.start)) / DAY) + 1), finished: r.finished === true, gaveUp };
      });
      const done = firsts.filter((r) => r.finished);

      // ---- genre fit: how much (last 2 years), how fast, how often finished ----
      const recent = firsts.filter((r) => now - t(r.start) < 730 * DAY);
      const share = {};
      recent.forEach((r) => { share[r.genre] = (share[r.genre] || 0) + 1; });
      const topShare = Math.max(1, ...Object.values(share));
      const pace = (v) => median(v.filter((r) => r.words > 0).map((r) => (r.days / r.words) * 1e5));
      const allPace = pace(done);
      const genreFit = {};
      [...new Set(firsts.map((r) => r.genre))].forEach((g) => {
        const v = firsts.filter((r) => r.genre === g), fin = v.filter((r) => r.finished), out = fin.length + v.filter((r) => r.gaveUp).length;
        const gp = pace(fin);
        const fast = gp && allPace ? clamp(allPace / gp / 2) : 0.5;
        const rate = out >= 3 ? fin.length / out : 0.5;
        genreFit[g] = { amount: (share[g] || 0) / topShare, fast, rate, pace: gp, finished: fin.length, tried: out };
      });

      // ---- series and authors ----
      // finished books of each series, by number
      const finishedNo = new Map();
      books.forEach((b) => {
        if (!b.series || b.series_no == null || b.status !== 'finished') return;
        const k = norm(b.series);
        if (!finishedNo.has(k)) finishedNo.set(k, []);
        finishedNo.get(k).push({ no: b.series_no, title: b.title, when: b.last_read });
      });
      // the finished book just before this one in its series
      const before = (series, no) => (finishedNo.get(norm(series)) || []).filter((x) => x.no < no).sort((a, b) => b.no - a.no)[0] || null;
      const openNos = new Set(books.filter((b) => b.series && b.series_no != null && b.status !== 'finished').map((b) => norm(b.series) + '#' + b.series_no));
      const byAuthor = {};
      books.forEach((b) => { if (b.status === 'finished') { const k = authorKey(b.author); if (k) byAuthor[k] = (byAuthor[k] || 0) + 1; } });

      // ---- palate cleanser: a long read just finished, or on the go ----
      const longRead = (r) => (r.words || 0) >= NEXT.longTimes * typical || r.days >= NEXT.longDays;
      const lastLong = done.filter((r) => now - t(r.end) <= NEXT.recentDays * DAY && longRead(r)).sort((a, b) => (a.end < b.end ? 1 : -1))[0]
        || books.filter((b) => b.status === 'in_progress' && b.last_read && now - t(b.last_read) <= 14 * DAY && (lengthOf(b) || 0) / Math.max(0.05, (b.progress || 0) / 100) >= NEXT.longTimes * typical)
          .map((b) => ({ title: b.title, genre: b.genre, current: true }))[0] || null;

      // ---- season: genres finished more around this month (±1) than through the year ----
      const years = new Set(done.map((r) => r.end.slice(0, 4))).size;
      const m = new Date(now).getUTCMonth(), near = (d) => { const k = new Date(t(d)).getUTCMonth(); return [m, (m + 11) % 12, (m + 1) % 12].includes(k); };
      const season = {};
      if (years >= NEXT.minYears) {
        const inWin = done.filter((r) => near(r.end));
        [...new Set(done.map((r) => r.genre))].forEach((g) => {
          const w = inWin.filter((r) => r.genre === g).length, all = done.filter((r) => r.genre === g).length;
          if (w < 2 || !inWin.length) return;
          const lift = (w / inWin.length) / (all / done.length);
          season[g] = { lift, signal: clamp(lift - 1) };
        });
      }

      // ---- friends: their opinions, weighted by how alike your taste is ----
      const voteKeys = votes.map((v) => ({ v, k: new Set(keys(v)) }));

      return pile.map((p) => {
        const parts = {}, why = [];
        const say = (kind, s, text) => { parts[kind] = Math.round(s * 1000) / 1000; if (s !== 0 && text) why.push({ kind, points: Math.round(WEIGHTS[kind] * s * 10) / 10, text }); };

        // series pull
        const prev = p.series && p.series_no != null ? before(p.series, p.series_no) : null;
        let gapOk = false;
        if (prev) {
          gapOk = true;
          for (let n = Math.floor(prev.no) + 1; n < p.series_no; n++) if (!openNos.has(norm(p.series) + '#' + n)) { gapOk = false; break; }
        }
        if (prev && gapOk) {
          const since = prev.when ? Math.max(0, (now - t(prev.when)) / DAY) : NEXT.fadeDays;
          say('series', 1 - 0.5 * clamp(since / NEXT.fadeDays), `next in ${p.series} (#${p.series_no}) after ${prev.title}`);
        } else {
          const n = byAuthor[authorKey(p.author)] || 0;
          if (n >= NEXT.authorBooks) say('series', clamp(0.3 + 0.1 * n, 0, 0.6), `you’ve finished ${plural(n, 'book')} by ${p.author}`);
          else say('series', 0);
        }

        // genre fit
        const g = genreFit[p.genre];
        if (g && p.genre !== 'Untagged') {
          const s = 0.5 * g.amount + 0.25 * g.fast + 0.25 * g.rate;
          const bits = [];
          if (g.amount >= 0.5) bits.push(`a lot of ${lower(p.genre)} lately`);
          if (g.pace && allPace && g.pace < allPace * 0.85) bits.push(`${lower(p.genre)} goes quickly for you`);
          if (g.tried >= 3 && g.rate >= 0.85) bits.push(`you finish ${Math.round(g.rate * 100)}% of the ${lower(p.genre)} you start`);
          say('genre', s, bits.length ? bits.join('; ') : null);
        } else say('genre', 0.15);

        // friends
        const mine = new Set(keys(p));
        const vs = voteKeys.filter(({ k }) => [...mine].some((x) => k.has(x))).map(({ v }) => v);
        if (vs.length) {
          const scored = vs.map((v) => {
            const s = v.rating >= 4 ? 1 : v.rating === 3 ? 0.3 : v.rating > 0 ? -0.5 : v.devoured || v.reread ? 0.9 : v.finished ? 0.4 : v.gave_up ? -0.5 : 0;
            const taste = v.taste == null ? 0.5 : v.taste / 100;
            return { v, s: s * (0.5 + 0.5 * taste) };
          }).sort((a, b) => b.s - a.s);
          const best = scored[0].s > 0 ? scored[0] : scored[scored.length - 1];
          const v = best.v, how = v.rating >= 4 ? `rated it ${v.rating}★` : v.devoured ? 'devoured it' : v.reread ? 're-read it' : v.finished ? 'finished it' : v.gave_up ? 'gave up on it' : v.rating ? `rated it ${v.rating}★` : 'read it';
          say('friends', clamp(best.s, -0.5, 1), `${v.name} ${how}${v.taste != null ? ` (${v.taste}% taste match)` : ''}`);
        } else say('friends', 0);

        // palate cleanser
        if (lastLong && p.words && p.words <= NEXT.shortTimes * typical && p.genre !== lastLong.genre) {
          say('cleanser', clamp((NEXT.shortTimes * typical - p.words) / (0.3 * typical) + 0.5), `short and different after ${lastLong.current ? 'the long ' + lastLong.title + ' you’re on' : lastLong.title}`);
        } else say('cleanser', 0);

        // season
        const sz = season[p.genre];
        if (sz && sz.signal > 0) say('season', sz.signal, `you read more ${lower(p.genre)} around ${MONTHS[m]}`);
        else say('season', 0);

        // waiting
        const age = p.added ? (now - t(p.added)) / DAY : null;
        if (age != null) say('waiting', clamp(age / NEXT.waitFull), age >= 365 ? `waiting ${age >= 730 ? Math.floor(age / 365) + ' years' : 'over a year'}` : null);
        else say('waiting', 0);

        const score = Math.round(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * (parts[k] || 0), 0));
        return {
          book_id: p.book_id, title: p.title, author: p.author, series: p.series, series_no: p.series_no, genre: p.genre, subgenre: p.subgenre,
          in_library: p.in_library, words: p.words, added: p.added, sources: p.sources, up_next: p.up_next ?? null, isbn13: p.isbn13 || null, want_id: p.want_id || null,
          score: Math.max(0, score), parts, reasons: why.filter((r) => r.points >= 2 || r.points < 0).sort((a, b) => b.points - a.points),
        };
      }).sort((a, b) => (a.up_next ?? Infinity) - (b.up_next ?? Infinity) || b.score - a.score || (a.added || '9999').localeCompare(b.added || '9999') || a.title.localeCompare(b.title));
    },
  });

  // ---------- friends' votes (page only) ----------
  let votesMemo = { key: null, rows: [] };
  function friendVotes(pile) {
    const fr = rh.friends;
    if (!fr || fr.status() !== 'ok' || !fr.list().length) return [];
    const mine = (k) => dash.data(k).data || [];
    const key = fr.list().map((f) => f.slug + ':' + (f.books || []).length).join('|') + '#' + pile.length + '#' + mine('books').length;
    if (votesMemo.key === key) return votesMemo.rows;
    const onPile = dash.sameBook.matcher(pile), rows = [];
    fr.list().forEach((f) => {
      let taste = null;
      try { taste = dash.calcWith('taste_match', { books: mine('books'), reads: mine('reads'), daily: mine('daily'), friend_books: f.books, friend_reads: f.reads, friend_daily: f.daily })[0]?.score ?? null; } catch (e) { /* no score */ }
      const prints = new Map();
      (fr.calc(f.slug, 'fingerprints') || []).forEach((p) => prints.set(p.book_id, p));
      (f.books || []).forEach((b) => {
        if (!onPile(b)) return;
        const p = prints.get(b.id);
        rows.push({ title: b.title, author: b.author, isbn13: b.isbn13 || null, work_id: b.work_id || null, name: f.name, slug: f.slug, taste,
          rating: b.rating ?? null, finished: b.status === 'finished', reread: (b.times_read || 1) > 1,
          devoured: !!(p && p.finished && p.shape === 'devoured'), gave_up: !!(p && p.shape === 'abandoned') });
      });
    });
    votesMemo = { key, rows };
    return rows;
  }

  // ---------- the card ----------
  const LABEL = { series: 'Series', genre: 'Genre', friends: 'Friends', cleanser: 'Cleanser', season: 'Season', waiting: 'Waiting' };
  const SHOW = 6;
  let showAll = false;
  rh.card({
    tab: 'toread', id: 'what-next', title: 'What to read next', calc: 'next_reads', after: 'card-toread-kpis', copesWithout: 'prices',
    note: 'Up next first: the books you’ve put in your own order (signed in, drag them or use the arrows). Then the rest of your pile ranked by your own habits, out of 100: series pull (30), how much, how fast and how reliably you read the genre (20), friends who loved it, weighted by taste match (20), something short and different after a long read (15), what you read at this time of year (10) and how long it has waited (5).',
    draw(box, rows) {
      if (!rows.length) { box.replaceChildren(el('div', 'dy-empty', 'Nothing on your pile to choose from yet.')); return; }
      // with friends, the same ranking again with their opinions in it
      const pile = dash.data('to_read_pile').data || [];
      const votes = friendVotes(pile);
      if (votes.length) {
        const mine = (k) => dash.data(k).data || [];
        try { rows = dash.calcWith('next_reads', { to_read_pile: pile, books: mine('books'), reads: mine('reads'), as_of: mine('as_of'), next_friend_votes: votes }); } catch (e) { console.error('next_reads', e); }
      }
      // signed in, the live order (moves show at once); otherwise the order in the data
      const want = rh.wantToRead, order = want && want.order ? want.order() : null;
      const placeOf = (r) => (order ? want.inOrder(r, order) : r.up_next != null ? r.up_next - 1 : null);
      const next = rows.filter((r) => placeOf(r) != null).sort((x, y) => placeOf(x) - placeOf(y));
      const ranked = rows.filter((r) => placeOf(r) == null);
      const canMove = !!order;
      const shownRanked = showAll ? ranked : ranked.slice(0, Math.max(0, SHOW - next.length));

      // dragging (mouse) and arrow buttons (keyboard and touch) both end in want.move
      let dragged = null;
      const dropAt = (target, to) => {
        target.addEventListener('dragover', (e) => { if (dragged) { e.preventDefault(); target.classList.add('wn-drop'); } });
        target.addEventListener('dragleave', () => target.classList.remove('wn-drop'));
        target.addEventListener('drop', (e) => {
          e.preventDefault(); target.classList.remove('wn-drop');
          const r = dragged; dragged = null;
          if (r) want.move(r, to);
        });
      };
      const btn = (text, label, onClick, disabled) => {
        const b = el('button', 'wn-btn', text);
        b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.disabled = !!disabled;
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
        return b;
      };

      const item = (r, rank, place) => {
        const li = el('li', 'wn-item' + (place != null ? ' wn-pinned' : '')), head = el('div', 'wn-head'), ttl = el('div', 'ttl');
        if (r.in_library) rh.linkBook(li, r.book_id);
        ttl.append(el('b', 'wn-title', r.title), rh.byline('small', null, r, ['author', 'series']));
        const sc = el('div', 'wn-score');
        if (place != null) sc.append(el('span', 'wn-mine', 'Up next'));
        else {
          const bar = el('div', 'wn-bar'), fill = el('i');
          fill.style.width = r.score + '%'; bar.append(fill);
          sc.append(el('span', 'wn-n', fmt(r.score)), bar);
        }
        head.append(el('span', 'wn-rank', String(rank)), rh.cover(r.in_library ? r.book_id : null, r.title, r.genre), ttl, sc);
        li.append(head);
        if (place == null || r.reasons.length) {
          const why = el('ul', 'wn-why');
          (r.reasons.length ? r.reasons.slice(0, place != null ? 2 : 3) : [{ kind: 'waiting', text: 'nothing stands out: a wildcard' }]).forEach((x) => {
            const w = el('li', x.points < 0 ? 'neg' : null);
            w.append(el('span', 'wn-kind', LABEL[x.kind]), ' ', x.text);
            why.append(w);
          });
          li.append(why);
        }
        const foot = el('div', 'wn-foot');
        if (canMove) {
          const acts = el('span', 'wn-acts');
          if (place != null) {
            acts.append(
              btn('↑', `Move ${r.title} up`, () => want.move(r, place - 1), place === 0),
              btn('↓', `Move ${r.title} down`, () => want.move(r, place + 1), place === next.length - 1),
              btn('✕', `Take ${r.title} out of Up next`, () => want.move(r, null)));
          } else {
            acts.append(btn('↑ Up next', `Put ${r.title} at the end of Up next`, () => want.move(r, next.length)));
          }
          foot.append(acts);
          li.draggable = true;
          li.classList.add('wn-drag');
          li.addEventListener('dragstart', (e) => { dragged = r; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', r.title); } catch (err) { /* old browsers */ } li.classList.add('wn-dragging'); });
          li.addEventListener('dragend', () => { dragged = null; li.classList.remove('wn-dragging'); });
          // dropping on a book in Up next puts the dragged one in its place; on a ranked one, takes it out
          // (moving down, it lands just after that book; moving up, just before it)
          dropAt(li, place);
        }
        const links = rh.searchLinks && rh.searchLinks(r, 'small');
        if (links) foot.append(links);
        if (foot.childNodes.length) li.append(foot);
        return li;
      };

      const parts = [];
      if (next.length || canMove) {
        const head = el('div', 'wn-section');
        head.append(el('b', null, 'Up next'), el('span', 'note', next.length ? ' your order' : (canMove ? ' drag a book here, or press ↑ Up next, to read it before the ranking' : '')));
        if (canMove && next.length) head.append(btn('Clear', 'Clear your Up next order', () => { if (window.confirm('Clear your Up next order? The books stay on your pile.')) want.resetOrder(); }));
        if (canMove) dropAt(head, next.length);
        parts.push(head);
        if (next.length) {
          const ol = el('ol', 'wn-list');
          next.forEach((r, i) => ol.append(item(r, i + 1, i)));
          parts.push(ol);
        }
      }
      if (shownRanked.length) {
        if (next.length || canMove) {
          const h2 = el('div', 'wn-section');
          h2.append(el('b', null, 'Ranked for you'), el('span', 'note', ' by your habits, out of 100'));
          if (canMove) dropAt(h2, null);
          parts.push(h2);
        }
        const ol = el('ol', 'wn-list');
        ol.start = next.length + 1;
        shownRanked.forEach((r, i) => ol.append(item(r, next.length + i + 1, null)));
        parts.push(ol);
      }
      box.replaceChildren(...parts);
      const hiddenCount = ranked.length - shownRanked.length;
      if (hiddenCount > 0 || showAll) {
        const more = el('button', 'up-link wn-more', showAll ? 'Show fewer' : `Show ${plural(hiddenCount, 'more book')}`);
        more.type = 'button';
        more.addEventListener('click', () => { showAll = !showAll; rh.redraw(); });
        box.append(more);
      }
    },
  });
})();
