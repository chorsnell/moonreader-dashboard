// The admin's "Prices" section (#admin/prices): what each book cost, typed in per book or
// imported from a CSV, plus the home currency, exchange rates, budgets and subscriptions.
// Saved to library/prices.json; the page reads a copy without the notes (data/prices.json).
(() => {
  if (!rh.adminSection) return; // a page without the admin area

  const ACQ = { bought: 'Bought', free: 'Free', library: 'Library loan', subscription: 'Subscription', gift: 'Gift' };
  const money = (n, cur) => (n == null ? '' : (cur ? cur + ' ' : '') + Number(n).toFixed(2));

  rh.adminSection({ id: 'prices', title: 'Prices', order: 45, draw(box, a) {
    const { h } = a;
    let data = null, query = '', which = 'all', limit = 30, flash = '';
    const head = h('p', { class: 'up-note' }, 'What you paid for each book, for the Money tab. Prices are kept in prices.json in your library; notes stay private to you.');
    const settingsBox = h('div', {}), subsBox = h('div', {}), importBox = h('div', {}), booksBox = h('div', {});
    box.append(head, booksBox, importBox, subsBox, settingsBox);

    async function load() {
      try { data = await a.get('api/admin/prices'); } catch (e) { booksBox.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }
      drawBooks(); drawImport(); drawSubs(); drawSettings();
    }
    const home = () => data.prices.settings.home_currency;
    const reloadDash = () => window.dash.reload();

    // ---------- books ----------
    const list = h('ul', { class: 'ad-list ad-books' });
    const count = h('p', { class: 'up-note' });
    const more = h('button', { class: 'up-link', type: 'button', hidden: true, onclick: () => { limit += 30; renderBooks(); } }, 'Show more');
    function drawBooks() {
      const search = h('input', { type: 'search', placeholder: 'Search titles and authors', 'aria-label': 'Search books', value: query });
      const pick = h('select', { 'aria-label': 'Which books' },
        h('option', { value: 'all' }, 'All books'), h('option', { value: 'missing' }, 'Without a price'),
        h('option', { value: 'priced' }, 'With a price'), h('option', { value: 'unopened' }, 'Never opened'));
      pick.value = which;
      search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); limit = 30; renderBooks(); });
      pick.addEventListener('change', () => { which = pick.value; limit = 30; renderBooks(); });
      const add = h('button', { class: 'up-copy', type: 'button' }, 'Add a book you haven\'t opened');
      const addSlot = h('div', {});
      add.addEventListener('click', () => {
        if (addSlot.firstChild) { addSlot.replaceChildren(); return; }
        addSlot.append(editor({ id: null, title: '', author: '' }, null, () => addSlot.replaceChildren()));
      });
      booksBox.replaceChildren(a.block('Books', 'Open a book to set its price. Books bought but never opened in Moon+ can be added too; they count towards spending and the unread pile.',
        h('div', { class: 'ad-toolbar' }, pick, search), h('div', { class: 'ad-actions pr-add' }, add), addSlot, count, list, more));
      renderBooks();
    }
    function rows() {
      const p = data.prices.books, seen = new Set(data.books.map((b) => b.id));
      const unopened = Object.entries(p).filter(([id]) => !seen.has(id)).map(([id, e]) => ({ id, title: e.title, author: e.author, unopened: true }));
      return [...data.books, ...unopened].sort((x, y) => x.title.localeCompare(y.title));
    }
    function renderBooks() {
      const p = data.prices.books;
      const all = rows();
      const shown = all.filter((b) => (which === 'all' || (which === 'missing' && !p[b.id]) || (which === 'priced' && p[b.id]) || (which === 'unopened' && b.unopened)) &&
        (!query || [b.title, b.author].some((s) => s && s.toLowerCase().includes(query))));
      const priced = all.filter((b) => p[b.id]).length;
      count.textContent = flash + (all.length ? `${shown.length} shown · ${priced} of ${all.length} books have a price` : 'No books yet: upload a backup first, or add one you haven\'t opened.');
      flash = '';
      list.replaceChildren(...shown.slice(0, limit).map(row));
      more.hidden = shown.length <= limit;
    }
    function summary(e) {
      if (!e) return 'No price yet';
      const bits = [ACQ[e.acquisition]];
      if (e.price != null && (e.price > 0 || e.acquisition === 'bought')) bits.push(money(e.price, e.currency || home()));
      if (e.store) bits.push(e.store);
      if (e.date) bits.push(e.date);
      if (e.bundle) bits.push('part of ' + e.bundle);
      return bits.join(' · ');
    }
    function row(b) {
      const e = data.prices.books[b.id];
      const item = h('li', { class: 'ad-book' });
      const edit = h('button', { class: 'up-copy', type: 'button', 'aria-expanded': 'false' }, e ? 'Edit' : 'Add price');
      const title = b.unopened ? h('span', { class: 'ad-name' }, b.title) : rh.linkBook(h('span', { class: 'ad-name' }, b.title), b.id);
      item.append(h('div', { class: 'ad-book-head' },
        h('div', { class: 'ad-book-text' },
          h('div', {}, title, b.unopened ? h('span', { class: 'ad-tag pr-tag' }, 'Never opened') : null),
          b.unopened ? h('div', { class: 'ad-meta' }, b.author || '') : rh.byline('div', 'ad-meta', b, ['author']),
          h('div', { class: 'ad-meta' }, summary(e))),
        edit));
      edit.addEventListener('click', () => {
        const open = item.querySelector('form');
        if (open) { open.remove(); edit.setAttribute('aria-expanded', 'false'); return; }
        edit.setAttribute('aria-expanded', 'true');
        item.append(editor(b, e, () => { item.querySelector('form')?.remove(); edit.setAttribute('aria-expanded', 'false'); }));
      });
      return item;
    }
    function editor(b, e, close) {
      const id = 'pr-' + (b.id || 'new');
      const field = (name, label, value, attrs = {}) => h('div', { class: 'ad-field' + (attrs.wide ? ' ad-wide' : '') },
        h('label', { for: `${id}-${name}` }, label),
        h('input', { id: `${id}-${name}`, name, value: value ?? '', ...attrs, wide: null }));
      const acq = h('select', { id: `${id}-acquisition`, name: 'acquisition' }, Object.entries(ACQ).map(([v, t]) => h('option', { value: v }, t)));
      acq.value = e ? e.acquisition : 'bought';
      const subs = data.prices.subscriptions.map((s) => s.name);
      const sub = h('select', { id: `${id}-subscription`, name: 'subscription' }, h('option', { value: '' }, subs.length ? 'Which subscription?' : 'Add one under Subscriptions'), subs.map((s) => h('option', { value: s }, s)));
      sub.value = e?.subscription || (subs.length === 1 ? subs[0] : '');
      const subRow = h('div', { class: 'ad-field' }, h('label', { for: sub.id }, 'Subscription'), sub);
      const listRow = field('list_price', 'What buying it would cost', e?.list_price, { type: 'number', step: '0.01', min: '0', inputmode: 'decimal' });
      const msg = a.msg();
      const save = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save');
      const remove = h('button', { class: 'up-link', type: 'button', hidden: !e }, 'Remove price');
      const form = h('form', { class: 'ad-edit' },
        b.id && !b.unopened ? null : field('title', 'Title', b.title, { required: true }),
        b.id && !b.unopened ? null : field('author', 'Author', b.author),
        field('price', `Price paid`, e?.price, { type: 'number', step: '0.01', min: '0', inputmode: 'decimal' }),
        field('currency', 'Currency', e?.currency || home(), { maxlength: 3, autocapitalize: 'characters', pattern: '[A-Za-z]{3}' }),
        h('div', { class: 'ad-field' }, h('label', { for: acq.id }, 'How you got it'), acq),
        field('date', 'Date', e?.date, { type: 'date' }),
        subRow, listRow,
        field('store', 'Store', e?.store, { list: 'pr-stores' }),
        field('bundle', 'Bundle or box set', e?.bundle),
        field('isbn', 'ISBN', e?.isbn),
        field('notes', 'Notes (only you see these)', e?.notes, { wide: true }),
        h('div', { class: 'ad-actions ad-wide' }, save, remove), msg);
      const sync = () => { subRow.hidden = acq.value !== 'subscription'; listRow.hidden = acq.value === 'bought' || acq.value === 'free'; };
      acq.addEventListener('change', sync); sync();
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const v = Object.fromEntries(new FormData(form));
        const body = { title: b.title, author: b.author, ...v, isbn: v.isbn, currency: (v.currency || '').toUpperCase() };
        if (subRow.hidden) delete body.subscription;
        if (listRow.hidden) body.list_price = '';
        save.disabled = true; msg.textContent = 'Saving…';
        try {
          if (b.id) {
            const r = await a.put('api/admin/prices/books/' + encodeURIComponent(b.id), body);
            data.prices.books[b.id] = r.entry;
          } else {
            const r = await a.post('api/admin/prices/books', body);
            data.prices.books[r.id] = r.entry;
          }
          flash = `Saved "${body.title}". `;
          close(); renderBooks(); reloadDash();
        } catch (err) { msg.textContent = err.message; save.disabled = false; }
      });
      remove.addEventListener('click', async () => {
        if (!confirm(`Remove the price for "${b.title}"?`)) return;
        try {
          await call('DELETE', 'api/admin/prices/books/' + encodeURIComponent(b.id));
          delete data.prices.books[b.id];
          flash = `Removed the price for "${b.title}". `;
          close(); renderBooks(); reloadDash();
        } catch (err) { msg.textContent = err.message; }
      });
      const stores = [...new Set(Object.values(data.prices.books).map((x) => x.store).filter(Boolean))].sort();
      form.append(h('datalist', { id: 'pr-stores' }, stores.map((s) => h('option', { value: s }))));
      return form;
    }

    // a request the section api doesn't cover (DELETE, a CSV body)
    async function call(method, url, body, type) {
      const r = await fetch(url, { method, cache: 'no-store', headers: type ? { 'Content-Type': type } : {}, body });
      let j = {}; try { j = await r.json(); } catch (e) { /* not JSON */ }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    }

    // ---------- CSV import ----------
    function drawImport() {
      const file = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'CSV file' });
      const addAll = h('input', { type: 'checkbox', id: 'pr-add-unmatched' });
      const preview = h('button', { class: 'up-primary ad-auto', type: 'button', disabled: true }, 'Preview');
      const confirmBtn = h('button', { class: 'up-primary ad-auto', type: 'button', hidden: true }, 'Save these prices');
      const msg = a.msg();
      const out = h('div', { class: 'pr-preview' });
      let csv = null;
      file.addEventListener('change', async () => {
        csv = file.files[0] ? await file.files[0].text() : null;
        preview.disabled = !csv; confirmBtn.hidden = true; out.replaceChildren(); msg.textContent = '';
      });
      const send = (confirm) => call('POST', 'api/admin/prices/import' + (confirm ? `?confirm=1${addAll.checked ? '&add_unmatched=1' : ''}` : ''), csv, 'text/csv');
      preview.addEventListener('click', async () => {
        msg.textContent = 'Reading…';
        try {
          const r = await send(false);
          msg.textContent = `${r.matched} matched, ${r.unmatched} not found, ${r.errors} not understood. Columns read: ${r.columns.join(', ')}.`;
          out.replaceChildren(table(r.rows));
          confirmBtn.hidden = !(r.matched || r.unmatched);
        } catch (e) { msg.textContent = e.message; }
      });
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true; msg.textContent = 'Saving…';
        try {
          const r = await send(true);
          flash = `Imported ${r.saved} price${r.saved === 1 ? '' : 's'}` + (r.added ? ` and added ${r.added} unopened book${r.added === 1 ? '' : 's'}` : '') + '. ';
          out.replaceChildren(); confirmBtn.hidden = true; file.value = ''; preview.disabled = true;
          msg.textContent = flash;
          await load(); reloadDash();
        } catch (e) { msg.textContent = e.message; }
        confirmBtn.disabled = false;
      });
      importBox.replaceChildren(a.block('Import a CSV',
        'From a store\'s order history or a spreadsheet. It needs a header row with a title column; it also reads author, ISBN, price, currency, date, acquisition (bought, free, library, subscription, gift), store, subscription, list price, bundle and notes. ' +
        'Books are matched by ISBN, then title and author. Rows with the same bundle share its price by length. Nothing is saved until you confirm.',
        file, h('label', { class: 'up-radio', for: addAll.id }, addAll, 'Add books it can\'t find as bought but never opened'),
        h('div', { class: 'ad-actions' }, preview, confirmBtn, h('a', { class: 'up-link', href: 'api/admin/prices/export.csv', download: 'prices.csv' }, 'Download all as CSV')), msg, out));
    }
    function table(rowsIn) {
      const STATUS = { matched: 'Matched', unmatched: 'Not found', error: 'Not understood' };
      const BY = { isbn: 'by ISBN', title_author: 'by title and author', title: 'by title', price_entry: 'earlier entry' };
      return h('ul', { class: 'ad-list pr-rows' }, rowsIn.slice(0, 300).map((r) => h('li', { class: 'pr-row pr-' + r.status },
        h('span', { class: 'ad-name' }, `${r.line}. ${r.title || '(no title)'}`, r.author ? h('span', { class: 'ad-meta' }, ' · ' + r.author) : null),
        h('span', { class: 'ad-meta' }, r.status === 'error' ? r.error
          : `${STATUS[r.status]}${r.matched_by ? ' ' + BY[r.matched_by] : ''}${r.replaces ? ', replaces its price' : ''} · ${summary(r.entry)}`))));
    }

    // ---------- subscriptions ----------
    function drawSubs() {
      let subs = data.prices.subscriptions.map((s) => ({ ...s }));
      const rowsBox = h('div', { class: 'pr-subs' });
      const msg = a.msg();
      const render = () => rowsBox.replaceChildren(...subs.map((s, i) => {
        const inp = (k, label, attrs = {}) => h('div', { class: 'ad-field' }, h('label', { for: `pr-sub-${i}-${k}` }, label),
          h('input', { id: `pr-sub-${i}-${k}`, value: s[k] ?? '', ...attrs, oninput: (e) => (s[k] = e.target.value) }));
        return h('div', { class: 'ad-edit pr-sub' },
          inp('name', 'Name', { required: true }), inp('monthly_fee', 'Monthly fee', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal' }),
          inp('currency', 'Currency', { maxlength: 3 }), inp('start', 'From (month)', { type: 'month' }), inp('end', 'Until (blank while it runs)', { type: 'month' }),
          h('div', { class: 'ad-actions' }, h('button', { class: 'up-link', type: 'button', onclick: () => { subs.splice(i, 1); render(); } }, 'Remove')));
      }));
      render();
      const add = h('button', { class: 'up-copy', type: 'button', onclick: () => { subs.push({ name: '', monthly_fee: '', currency: home(), start: new Date().toISOString().slice(0, 7), end: '' }); render(); } }, 'Add a subscription');
      const save = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Save subscriptions');
      save.addEventListener('click', async () => {
        msg.textContent = 'Saving…';
        try {
          const r = await a.put('api/admin/prices/subscriptions', subs);
          data.prices.subscriptions = r.subscriptions; subs = r.subscriptions.map((s) => ({ ...s }));
          msg.textContent = 'Saved.'; render(); reloadDash();
        } catch (e) { msg.textContent = e.message; }
      });
      subsBox.replaceChildren(a.block('Subscriptions', 'Kindle Unlimited, Kobo Plus and the like. Mark books read through one as "Subscription" and give what buying them would cost, to see whether it paid off.',
        rowsBox, h('div', { class: 'ad-actions' }, add, save), msg));
    }

    // ---------- settings ----------
    function drawSettings() {
      const s = data.prices.settings;
      const lines = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join('\n');
      const pairs = (text) => Object.fromEntries(text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = /^(.+?)[\s=:]+([\d.]+)$/.exec(l);
        if (!m) throw new Error(`"${l}" should be a name and a number.`);
        return [m[1].trim(), Number(m[2])];
      }));
      const cur = h('input', { id: 'pr-home', value: s.home_currency, maxlength: 3 });
      const rates = h('textarea', { id: 'pr-rates', rows: 3, class: 'pr-text', placeholder: 'USD 0.79\nEUR 0.86' }); rates.value = lines(s.rates);
      const budgets = h('textarea', { id: 'pr-budgets', rows: 3, class: 'pr-text', placeholder: '2026 150' }); budgets.value = lines(s.budgets);
      const bench = h('textarea', { id: 'pr-bench', rows: 5, class: 'pr-text' }); bench.value = s.benchmarks.map((b) => `${b.name} = ${b.per_hour}`).join('\n');
      const missing = h('p', { class: 'up-note ad-bad', hidden: !data.missing_rates.length }, `No rate yet for ${data.missing_rates.join(', ')}: those prices are left out until you add one.`);
      const msg = a.msg();
      const save = h('button', { class: 'up-primary ad-auto', type: 'button' }, 'Save settings');
      save.addEventListener('click', async () => {
        msg.textContent = 'Saving…';
        try {
          const benchmarks = Object.entries(pairs(bench.value)).map(([name, per_hour]) => ({ name, per_hour }));
          const r = await a.put('api/admin/prices/settings', { home_currency: cur.value.toUpperCase(), rates: pairs(rates.value), budgets: pairs(budgets.value), benchmarks });
          data.prices.settings = r.settings; data.missing_rates = r.missing_rates;
          msg.textContent = 'Saved.'; drawSettings(); reloadDash();
        } catch (e) { msg.textContent = e.message; }
      });
      settingsBox.replaceChildren(a.block('Currency, budgets and benchmarks', null,
        h('label', { for: cur.id }, 'Home currency (everything is shown in this)'), cur,
        h('label', { for: rates.id }, `Exchange rates: what 1 of each currency is worth in ${s.home_currency}, one per line. Fixed rates you set; nothing is looked up.`), rates, missing,
        h('label', { for: budgets.id }, 'Yearly budgets, one per line (year and amount)'), budgets,
        h('label', { for: bench.id }, 'Benchmarks: rough cost of an hour of other things, one per line'), bench,
        h('div', { class: 'ad-actions' }, save), msg));
    }

    load();
  } });
})();
