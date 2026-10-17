// Cover colours: each cover's dominant colour, worked out in the browser from the cover image
// (a small canvas; covers are served from the same origin). Used for "Your year in colour"
// and to tint each book's page. Books without a cover fall back to their genre's colour.
(() => {
  const { el, fmt, gColor, linkBook, linkPage, pDate, fDay, plural } = rh;
  const STORE = 'moonreader-dashboard:cover-colours';

  // ---------- colour maths ----------
  const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const rgb = (s) => {
    s = String(s).trim();
    if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + [...s.slice(1)].map((c) => c + c).join('');
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
    return m ? m.slice(1).map((h) => parseInt(h, 16)) : null;
  };
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));

  /** The dominant colour of an image: the most common saturated hue, or the average when it has none. */
  function dominant(img) {
    const W = 32, H = 48, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data, bins = [], all = [0, 0, 0, 0];
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      all[0] += r; all[1] += g; all[2] += b; all[3]++;
      const chroma = (mx - mn) / 255, l = (mx + mn) / 510;
      if (chroma < 0.18 || l < 0.1 || l > 0.93) continue;
      let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
      h = (h + 6) % 6;
      const k = Math.floor(h * 3) % 18, wgt = chroma * chroma;
      const bin = bins[k] || (bins[k] = [0, 0, 0, 0]);
      bin[0] += r * wgt; bin[1] += g * wgt; bin[2] += b * wgt; bin[3] += wgt;
    }
    if (!all[3]) return null;
    const best = bins.filter(Boolean).sort((a, b) => b[3] - a[3])[0];
    // a mostly grey, black or white cover: its average
    if (!best || best[3] < all[3] * 0.02) return hex(all.slice(0, 3).map((v) => v / all[3]));
    return hex(best.slice(0, 3).map((v) => v / best[3]));
  }

  // ---------- cover colours, cached by cover URL (it changes when the cover does) ----------
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { saved = {}; }
  const pending = new Map();
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) { /* private mode or full */ } }, 500);
  };
  /** The cover's colour (#rrggbb) for a book id, or null when it has no cover or it can't be read. */
  function coverColour(id) {
    const url = dash.cover(id);
    if (!url) return Promise.resolve(null);
    if (url in saved) return Promise.resolve(saved[url]);
    if (pending.has(url)) return pending.get(url);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { let c = null; try { c = dominant(img); } catch (e) { /* unreadable */ } saved[url] = c; save(); resolve(c); };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    pending.set(url, p);
    return p;
  }
  rh.coverColour = coverColour;

  // the genre colour as a hex, for the maths (gColor gives a CSS variable)
  const cssColour = (c) => {
    const m = /^var\((--[\w-]+)\)$/.exec(c);
    return rgb(m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]) : c);
  };

  // ---------- cover-tinted book pages ----------
  /**
   * An accent for a page: the colour moved towards black (light mode) or white (dark mode)
   * until it stands out 3:1 against the panel, and a wash for the header that keeps the
   * text at 7:1 or more (muted text 4.5:1).
   */
  function tint(colour) {
    const css = getComputedStyle(document.documentElement);
    const panel = rgb(css.getPropertyValue('--color-panel')) || [255, 255, 255], fg = rgb(css.getPropertyValue('--color-fg')) || [0, 0, 0];
    const muted = rgb(css.getPropertyValue('--color-fg-muted')) || fg;
    const dark = lum(panel) < 0.2, toward = dark ? [255, 255, 255] : [0, 0, 0];
    let accent = colour;
    for (let t = 0.05; contrast(accent, panel) < 3 && t <= 1; t += 0.05) accent = mix(toward, colour, t);
    let w = dark ? 0.24 : 0.16, wash = mix(colour, panel, w);
    while (w > 0.02 && (contrast(fg, wash) < 7 || contrast(muted, wash) < 4.5)) { w -= 0.02; wash = mix(colour, panel, w); }
    return { accent: hex(accent), wash: hex(wash), edge: hex(mix(colour, panel, dark ? 0.55 : 0.45)) };
  }
  rh.tint = tint;

  let tinting = null;
  function tintBook(b) {
    tinting = b.id;
    const apply = (c, fromCover) => {
      if (tinting !== b.id || rh.current() !== 'book') return;
      const base = rgb(c) || cssColour(gColor(b.genre));
      if (!base) return;
      const t = tint(base), head = document.getElementById('bk-head');
      if (!head) return;
      head.classList.add('cv-tinted');
      head.style.setProperty('--bk-accent', t.accent);
      head.style.setProperty('--bk-wash', t.wash);
      head.style.setProperty('--bk-edge', t.edge);
      head.dataset.tint = fromCover ? 'cover' : 'genre';
      const fill = head.querySelector('.go-prog .pbar i');
      if (fill) fill.style.background = t.accent;
      document.querySelectorAll('#ch-bk-days path[fill-opacity="0.5"]').forEach((p) => p.setAttribute('fill', t.accent));
    };
    apply(null, false); // the genre colour straight away
    coverColour(b.id).then((c) => { if (c) apply(c, true); });
  }
  rh.bookCard({ id: 'bk-tint', title: '', draw(box, rows, parts, b) { tintBook(b); return false; } });

  // ---------- your year in colour ----------
  dash.calc('year_colours', {
    inputs: ['reads', 'daily'], title: 'Hours per book per year',
    description: 'For each year and book: hours read that year (from the daily log; a read without timed days counts its own hours in the year it ended) and the first day read that year.',
    fn: (reads, daily) => {
      const out = new Map(), row = (year, r) => {
        const k = year + '|' + r.book_id;
        if (!out.has(k)) out.set(k, { year, book_id: r.book_id, title: r.title, author: r.author, genre: r.genre, minutes: 0, first: null });
        return out.get(k);
      };
      daily.forEach((d) => {
        const o = row(+d.date.slice(0, 4), d);
        o.minutes += d.minutes || 0;
        if (!o.first || d.date < o.first) o.first = d.date;
      });
      reads.forEach((r) => {
        const y = +r.end.slice(0, 4), o = row(y, r);
        if (!o.minutes && r.hours) o.minutes = r.hours * 60;
        if (!o.first) o.first = r.start < y + '-01-01' ? y + '-01-01' : r.start;
      });
      return [...out.values()].filter((o) => o.minutes >= 1)
        .map((o) => ({ ...o, hours: Math.round((o.minutes / 60) * 10) / 10 }))
        .sort((a, b) => a.year - b.year || (a.first < b.first ? -1 : a.first > b.first ? 1 : 0));
    },
  });

  /** One year as a strip of colour: a segment per book, as wide as its hours. */
  function strip(rows, big) {
    const s = el('div', 'yc-strip' + (big ? ' big' : ''));
    const total = rows.reduce((a, r) => a + r.hours, 0) || 1;
    rows.forEach((r) => {
      const seg = linkBook(el('span', 'yc-seg gen'), r.book_id);
      seg.style.flexGrow = String(r.hours);
      seg.style.backgroundColor = gColor(r.genre);
      seg.title = `${r.title}${r.author ? ' · ' + r.author : ''}\n${fmt(r.hours)} h (${Math.round((r.hours / total) * 100)}% of the year), from ${fDay(pDate(r.first))}`;
      seg.setAttribute('aria-label', `${r.title}, ${fmt(r.hours)} hours`);
      s.append(seg);
      coverColour(r.book_id).then((c) => { if (c) { seg.style.backgroundColor = c; seg.classList.remove('gen'); } });
    });
    return s;
  }
  const NOTE = 'Each book you read, coloured by its cover and as wide as the hours you spent on it, in the order you started. Striped books have no cover yet, so they take their genre’s colour.';

  rh.card({
    tab: 'bookshelf', id: 'year-colour', title: 'Your years in colour', calc: 'year_colours', after: 'card-bookshelf',
    note: NOTE,
    draw(box, rows) {
      box.style.minHeight = '0';
      if (!rows.length) { box.replaceChildren(el('div', 'dy-empty', 'Nothing read yet.')); return; }
      const years = d3.groups(rows, (r) => r.year).sort((a, b) => b[0] - a[0]);
      box.replaceChildren(...years.map(([y, v]) => {
        const line = el('div', 'yc-row'), lab = linkPage(el('span', 'yc-year', String(y)), 'year', y);
        line.append(lab, strip(v, false), el('span', 'yc-hours', `${fmt(Math.round(d3.sum(v, (r) => r.hours)))} h`));
        return line;
      }));
    },
  });

  rh.extend('year', (id, root) => {
    const r = dash.data('year_colours');
    if (r.status !== 'ok') return;
    const v = r.data.filter((x) => String(x.year) === String(id));
    if (!v.length) return;
    const c = el('div', 'rh-card wide yc-card');
    c.append(el('h2', null, 'Your year in colour'), el('p', 'note', NOTE + ` ${plural(v.length, 'book')}, ${fmt(Math.round(d3.sum(v, (x) => x.hours)))} hours.`), strip(v, true));
    const kp = root.querySelector('.yr-kpis');
    if (kp) kp.after(c); else root.append(c);
  });
})();
