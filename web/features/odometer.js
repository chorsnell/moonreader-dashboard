// lifetime words odometer: every word in the daily log, rolled up on a counter and
// measured in books everyone has heard of
(() => {
  const { el, fmt, pDate, fDay } = rh;

  // well-known word counts; other views (Wrapped) compare against the same list
  dash.calc('word_units', {
    inputs: [], title: 'Word yardsticks',
    description: 'Approximate word counts of famous books, and of a metre of paperback shelf, for comparisons.',
    fn: () => [
      { id: 'kjv', one: 'King James Bible', many: 'King James Bibles', words: 783137 },
      { id: 'lotr', one: 'Lord of the Rings', many: 'Lord of the Rings', words: 481103 },
      { id: 'war_and_peace', one: 'War and Peace', many: 'War and Peace', words: 587287 },
      { id: 'hobbit', one: 'Hobbit', many: 'Hobbits', words: 95356 },
      // a 100,000-word paperback is about 2.5 cm thick
      { id: 'shelf_m', one: 'metre of shelf', many: 'metres of shelf', words: 4000000 },
    ],
  });

  dash.calc('lifetime_words', {
    inputs: ['daily', 'as_of'], title: 'Lifetime words',
    description: 'Words read since the daily log began, in the last 365 days, and the next round-number milestone.',
    fn: (daily, as_of) => {
      const end = as_of[0].date, DAY = 864e5, t = (s) => Date.parse(s + 'T00:00:00Z');
      let words = 0, year = 0, first = null;
      daily.forEach((d) => {
        if (!d.words) return;
        words += d.words;
        if (t(end) - t(d.date) < 365 * DAY) year += d.words;
        if (!first || d.date < first) first = d.date;
      });
      const step = words < 1e6 ? 1e5 : words < 1e7 ? 1e6 : 5e6, next = (Math.floor(words / step) + 1) * step;
      const eta = year > 0 ? new Date(t(end) + Math.ceil((next - words) / (year / 365)) * DAY).toISOString().slice(0, 10) : null;
      return [{ words, words_365: year, first_day: first, as_of: end, next_milestone: next, milestone_eta: eta }];
    },
  });

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // how many times a yardstick fits, with sensible precision
  const times = (n) => (n >= 100 ? fmt(Math.round(n)) : n >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.0+$/, '');

  // one rolling wheel per digit; built once, then only the offsets change
  let shown = null;
  function odometer(box, words) {
    let meter = box.querySelector('.odo');
    const digits = String(words).split('');
    if (!meter || meter.childElementCount !== digits.length + Math.floor((digits.length - 1) / 3)) {
      meter = el('div', 'odo');
      meter.setAttribute('role', 'img');
      digits.forEach((_, i) => {
        if (i && (digits.length - i) % 3 === 0) meter.append(el('span', 'odo-sep', ','));
        const w = el('span', 'odo-d'), strip = el('span', 'odo-strip');
        for (let n = 0; n <= 9; n++) strip.append(el('span', null, String(n)));
        w.append(strip); meter.append(w);
      });
      box.querySelector('.odo-box').replaceChildren(meter);
    }
    meter.setAttribute('aria-label', `${fmt(words)} words`);
    const strips = [...meter.querySelectorAll('.odo-strip')];
    const set = () => strips.forEach((s, i) => (s.style.transform = `translateY(${-digits[i] * 10}%)`));
    // roll up from zero the first time it's seen; later redraws just settle on the value
    if (shown == null && !reduced()) {
      strips.forEach((s) => (s.style.transform = 'translateY(0)'));
      meter.classList.add('rolling');
      requestAnimationFrame(() => requestAnimationFrame(set));
    } else set();
    shown = words;
  }

  rh.card({
    tab: 'overview', id: 'odometer', title: 'Lifetime words', calc: 'lifetime_words', before: 'card-years',
    draw(box, rows, parts) {
      const r = rows[0];
      if (!r || !r.words) { parts.card.hidden = true; return; }
      parts.card.hidden = false;
      parts.note.hidden = false;
      parts.note.textContent = `Every word in the app's daily log since ${fDay(pDate(r.first_day))}.`;
      if (!box.querySelector('.odo-box')) {
        box.classList.add('odo-chart');
        box.replaceChildren(el('div', 'odo-box'), el('div', 'odo-units'), el('p', 'odo-next'));
      }
      odometer(box, r.words);
      const units = dash.data('word_units').data;
      box.querySelector('.odo-units').replaceChildren(...['kjv', 'lotr', 'war_and_peace', 'shelf_m'].map((id) => {
        const u = units.find((x) => x.id === id), n = r.words / u.words, t = el('div', 'odo-unit');
        t.append(el('b', null, times(n)), el('span', null, n === 1 ? u.one : u.many));
        t.title = `${u.one}: about ${fmt(u.words)} words`;
        return t;
      }));
      const next = box.querySelector('.odo-next');
      next.replaceChildren();
      if (r.words_365) next.append(`${fmt(r.words_365)} words in the last 365 days. `);
      if (r.milestone_eta) next.append(`At that pace you'll pass ${fmt(r.next_milestone)} around ${fDay(pDate(r.milestone_eta))}.`);
    },
  });
})();
