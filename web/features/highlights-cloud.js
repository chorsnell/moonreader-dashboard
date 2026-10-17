// Word clouds of what you highlighted: on each book page and each author page.
// The layout is our own (no library): words, biggest first, go at the first free spot on a
// spiral out from the middle, checked against the boxes of the words already placed.
(() => {
  const { el, fmt, plural, gColor, showTip, hideTip, tipLines } = rh;
  const MIN_WORDS = 12; // fewer distinct words than this make a poor cloud
  const MAX_WORDS = 70;

  // common English words that say nothing about a book
  const STOP = new Set(('a about above after again against all almost also am an and any are aren as at be because been before ' +
    'being below between both but by can cannot could did do does doing don down during each either else enough even ever every ' +
    'few for from further get got had has have having he her here hers herself him himself his how however i if in into is it its ' +
    'itself just least less let like made make many may me might mine more most much must my myself neither never no nor not now ' +
    'of off often on once one only or other ought our ours ourselves out over own perhaps quite rather really said same say says ' +
    'see shall she should since so some still such than that the their theirs them themselves then there these they thing things ' +
    'this those though through thus till to too under until up upon us very was we well were what when where whether which while ' +
    'who whom whose why will with within without would yet you your yours yourself yourselves ll ve re don didn doesn isn wasn ' +
    'won wouldn couldn shouldn ain oh mr mrs miss sir').split(' '));

  /** Word counts (and how many highlights each word is in) over highlight texts. */
  function countWords(rows) {
    const words = new Map();
    for (const h of rows) {
      const seen = new Set();
      for (const raw of h.text.toLowerCase().replace(/[’']/g, "'").match(/\p{L}[\p{L}'-]*/gu) || []) {
        const w = raw.replace(/'s$|'$/, '').replace(/^-+|-+$/g, '');
        if (w.length < 3 || STOP.has(w) || STOP.has(w.replace(/'.*/, ''))) continue;
        const o = words.get(w) || { word: w, n: 0, in: 0 };
        o.n++;
        if (!seen.has(w)) { o.in++; seen.add(w); }
        words.set(w, o);
      }
    }
    return [...words.values()].sort((a, b) => b.n - a.n || a.word.localeCompare(b.word));
  }

  const ctx = document.createElement('canvas').getContext('2d');
  const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font-anthropic-serif').trim() || 'Georgia, serif';

  /** Places words in a w x h box; returns those that fit, with x, y (centre) and size. */
  function layout(words, w, h) {
    const max = words[0].n, min = words[words.length - 1].n;
    const big = Math.max(22, Math.min(54, w / 9)), small = Math.max(11, big / 4);
    const size = max > min ? d3.scaleSqrt([min, max], [small, big]) : () => (small + big) / 2.5;
    const placed = [], pad = 2;
    const hit = (b) => placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
    const aspect = w / h;
    for (const word of words) {
      const s = Math.round(size(word.n));
      ctx.font = `${s}px ${FONT}`;
      const tw = ctx.measureText(word.word).width + pad * 2, th = s * 0.95 + pad * 2;
      // an Archimedean spiral, stretched to the box's shape
      for (let t = 0; t < 600; t += 0.35) {
        const r = 1.6 * t;
        const cx = w / 2 + r * Math.cos(t) * Math.sqrt(aspect), cy = h / 2 + (r * Math.sin(t)) / Math.sqrt(aspect);
        const b = { x0: cx - tw / 2, x1: cx + tw / 2, y0: cy - th / 2, y1: cy + th / 2 };
        if (b.x0 < 0 || b.x1 > w || b.y0 < 0 || b.y1 > h) { if (r > Math.max(w, h)) break; continue; }
        if (hit(b)) continue;
        placed.push({ ...b, ...word, x: cx, y: cy, size: s });
        break;
      }
    }
    return placed;
  }

  /** Draws the cloud for some highlights into box; false if there aren't enough words. */
  function cloud(box, rows, genre, note) {
    const words = countWords(rows).slice(0, MAX_WORDS);
    if (words.length < MIN_WORDS) return false;
    const w = Math.max(280, box.clientWidth), h = Math.round(Math.max(200, Math.min(340, w * 0.42)));
    box.querySelectorAll('svg,.tip').forEach((n) => n.remove());
    const placed = layout(words, w, h);
    // crop to the words, so a small cloud doesn't sit in a big empty box
    const y0 = Math.max(0, d3.min(placed, (p) => p.y0) - 6), y1 = Math.min(h, d3.max(placed, (p) => p.y1) + 6);
    box.style.minHeight = y1 - y0 + 'px';
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 ${y0} ${w} ${y1 - y0}`).attr('height', y1 - y0)
      .attr('role', 'img').attr('aria-label', 'Most highlighted words: ' + placed.slice(0, 10).map((p) => p.word).join(', '));
    const tip = d3.select(box).append('div').attr('class', 'tip');
    const top = placed[Math.min(placed.length - 1, Math.floor(placed.length * 0.2))].n;
    svg.append('g').selectAll('text').data(placed).join('text')
      .attr('class', 'wc-word').attr('x', (d) => d.x).attr('y', (d) => d.y)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .style('font-size', (d) => d.size + 'px').style('font-family', 'var(--font-anthropic-serif)')
      .attr('fill', (d) => (d.n >= top && d.n > 1 ? gColor(genre) : 'var(--color-fg)'))
      .attr('fill-opacity', (d, i) => (d.n >= top && d.n > 1 ? 1 : i < placed.length / 2 ? 0.85 : 0.6))
      .text((d) => d.word)
      .on('mousemove', (e, d) => showTip(tip, box, e, (t) => tipLines(t, d.word, [[null, 'Used', plural(d.n, 'time')], [null, 'In', plural(d.in, 'highlight')]])))
      .on('mouseleave', () => hideTip(tip));
    if (note) note(placed.length, words.length);
    return true;
  }

  const placedNote = (n, total) => (n < total ? ` ${fmt(n)} of the top ${fmt(total)} words fit.` : '');

  rh.bookCard({
    id: 'bk-hl-cloud',
    title: 'Words you highlighted',
    calc: 'highlights',
    before: 'card-bk-log',
    wide: true,
    draw(box, rows, parts, book) {
      const mine = rows.filter((h) => h.book_id === book.id && h.kind !== 'bookmark');
      parts.note.hidden = false;
      return cloud(box, mine, book.genre, (n, total) => {
        parts.note.textContent = `The words that come up most in your ${plural(mine.length, 'highlight')}, bigger the more often, leaving out common words.` + placedNote(n, total);
      });
    },
  });

  // author pages: one cloud over every book by them
  rh.extend('author', (name, root) => {
    const hl = rh.D('highlights'), bk = rh.D('books');
    if (hl.status !== 'ok' || bk.status !== 'ok') return;
    const books = bk.data.filter((b) => b.author === name);
    const ids = new Set(books.map((b) => b.id));
    const mine = hl.data.filter((h) => ids.has(h.book_id) && h.kind !== 'bookmark');
    if (!mine.length) return;
    // the author's main genre (by books) colours the biggest words
    const genre = d3.greatest(d3.rollups(books, (v) => v.length, (b) => b.genre), (d) => d[1])[0];
    const card = el('div', 'rh-card wide wc-card');
    card.id = 'card-au-hl-cloud';
    const note = el('p', 'note');
    const box = el('div', 'chart');
    card.append(el('h2', null, 'Words you highlighted'), note, box);
    root.append(card);
    const nBooks = new Set(mine.map((h) => h.book_id)).size;
    if (!cloud(box, mine, genre, (n, total) => {
      note.textContent = `Across your ${plural(mine.length, 'highlight')} in ${plural(nBooks, 'book')}, bigger the more often, leaving out common words.` + placedNote(n, total);
    })) card.remove();
  });
})();
