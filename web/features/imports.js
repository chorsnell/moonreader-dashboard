// Admin → Imports (BOO-53, BOO-57): a Goodreads or StoryGraph export adds ratings, shelves
// and books read outside Moon+; a Kobo database or Kindle files add days, reads and
// highlights; finished reads can go back to Goodreads as a CSV.
(() => {
  const NAMES = { goodreads: 'Goodreads', storygraph: 'StoryGraph', kobo: 'your Kobo', kindle: 'Kindle reading sessions', kindle_clippings: 'My Clippings', koreader: 'KOReader' };
  rh.adminSection({ id: 'imports', title: 'Imports', order: 15, draw(box, a) {
    const { h } = a;
    const list = h('div', {}, h('p', { class: 'note' }, 'Loading…'));
    const listMsg = a.msg();
    async function load() {
      let r;
      try { r = await a.get('api/admin/imports'); } catch (e) { list.replaceChildren(h('p', { class: 'up-msg' }, e.message)); return; }
      list.replaceChildren(r.imports.length
        ? h('ul', { class: 'ad-list' }, r.imports.map((f) => h('li', {},
          h('span', { class: 'ad-name' }, `${f.name}: ${f.file}`),
          h('span', { class: 'ad-meta' }, [`${f.books} books`, f.read && `${f.read} read`, f.rated && `${f.rated} rated`, f.days && `${f.days} reading days`, f.highlights && `${f.highlights} highlights`].filter(Boolean).join(', ') + ` · ${a.when(f.imported)}`),
          h('button', { class: 'up-link', type: 'button', onclick: async (e) => {
            if (!confirm(`Remove the ${f.name} import? Its ratings and the books only it knows about leave the dashboard.`)) return;
            e.target.disabled = true;
            try {
              const before = await a.status();
              const res = await fetch(`api/admin/imports/${f.source}`, { method: 'DELETE' });
              const j = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
              listMsg.textContent = 'Removed.';
              if (j.rebuilding) await a.waitForBuild(before, (t) => (listMsg.textContent = t));
            } catch (err) { listMsg.textContent = err.message; }
            load();
          } }, 'Remove'))))
        : h('p', { class: 'note' }, 'Nothing imported yet.'));
      if (r.kindle_titles) list.append(h('p', { class: 'up-note' }, `${r.kindle_titles} Kindle titles known, to name books in Kindle reading sessions.`));
      if (!r.has_backup && r.imports.length) list.append(h('p', { class: 'up-note' }, 'No Moon+ backup yet, so the dashboard is built from these imports alone.'));
    }

    const file = h('input', { type: 'file', accept: '.csv,.txt,.sqlite,.sqlite3,text/csv,text/plain', id: 'ad-import-file' });
    const msg = a.msg();
    const go = h('button', { class: 'up-primary ad-auto', type: 'button', onclick: async () => {
      const f = file.files[0];
      if (!f) { msg.textContent = 'Choose a file first.'; return; }
      go.disabled = true; msg.textContent = 'Importing…';
      try {
        const before = await a.status();
        const r = await a.put('api/admin/imports?name=' + encodeURIComponent(f.name), f, 'application/octet-stream');
        msg.textContent = r.source === 'kindle_titles' ? `Read ${r.titles} Kindle titles${r.renamed ? `, naming ${r.renamed} books` : ''}.`
          : `Imported ${r.books} books from ${NAMES[r.source] || r.source}` + (r.rated ? `, ${r.rated} rated` : '') + (r.days ? `, ${r.days} reading days` : '') + (r.highlights ? `, ${r.highlights} highlights` : '') + '.';
        file.value = '';
        load();
        if (r.rebuilding) await a.waitForBuild(before, (t) => (msg.textContent = t));
      } catch (e) { msg.textContent = e.message; }
      go.disabled = false;
      load();
    } }, 'Import');

    box.append(
      a.block('Import from another app', 'Brings in books, reads and highlights from outside Moon+. The file is recognised by what\'s in it; uploading the same kind again replaces the earlier one.',
        h('ul', { class: 'up-note ad-sources' },
          h('li', {}, h('b', {}, 'Goodreads'), ': My Books → Import and export → Export library. Adds ratings, shelves and books read on paper.'),
          h('li', {}, h('b', {}, 'StoryGraph'), ': Manage account → Export StoryGraph library.'),
          h('li', {}, h('b', {}, 'Kobo'), ': connect the e-reader by USB and upload .kobo/KoboReader.sqlite. Adds progress, time spent, highlights, and days if the device still has them.'),
          h('li', {}, h('b', {}, 'KOReader'), ': koreader/settings/statistics.sqlite3 on the device (over USB). Adds time and progress for every day read.'),
          h('li', {}, h('b', {}, 'Kindle highlights'), ': documents/My Clippings.txt on the Kindle.'),
          h('li', {}, h('b', {}, 'Kindle reading sessions'), ': Amazon → Request your data → Kindle; upload Kindle.Devices.ReadingSession.csv. It names books only by ASIN: upload a CSV with ASIN and Title columns (such as your digital orders) to name them, or name them in Catalogue.')),
        h('label', { for: 'ad-import-file' }, 'File'), file, h('div', { class: 'ad-actions' }, go), msg),
      a.block('Imported', 'Books are matched to your Moon+ books by ISBN, then by title and author; for a day Moon+ already has, Moon+ wins. Books only Goodreads knows show as finished on the day it gives, with no minutes, words or speed, so they count towards books per year and genres but not time. Give imported books a genre in the Catalogue section (their file is shown as goodreads:<id>, kobo:<id>, kindle:<ASIN>…). To-read shelves are left out.',
        list, listMsg),
      a.block('Export to Goodreads', 'Your finished books (with their ratings and the day you finished) as a CSV in the layout Goodreads imports: My Books → Import and export → Import. Books that came from Goodreads are left out.',
        h('div', { class: 'ad-actions' }, h('a', { class: 'up-primary ad-auto ad-download', href: 'api/admin/imports/export/goodreads', download: 'goodreads_import.csv' }, 'Download CSV'))));
    load();
  } });
})();
