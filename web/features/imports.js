// Admin → Imports (BOO-53): a Goodreads or StoryGraph export adds ratings, shelves and books
// read outside Moon+; finished reads can go back to Goodreads as a CSV.
(() => {
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
          h('span', { class: 'ad-meta' }, `${f.books} books, ${f.read} read, ${f.rated} rated · ${a.when(f.imported)}`),
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
      if (!r.has_backup) list.append(h('p', { class: 'up-note' }, 'Imports are added to your Moon+ data, so they show once a backup has been uploaded.'));
    }

    const file = h('input', { type: 'file', accept: '.csv,text/csv', id: 'ad-import-file' });
    const msg = a.msg();
    const go = h('button', { class: 'up-primary ad-auto', type: 'button', onclick: async () => {
      const f = file.files[0];
      if (!f) { msg.textContent = 'Choose the exported .csv file first.'; return; }
      go.disabled = true; msg.textContent = 'Importing…';
      try {
        const before = await a.status();
        const r = await a.put('api/admin/imports?name=' + encodeURIComponent(f.name), await f.text(), 'text/csv');
        msg.textContent = `Imported ${r.books} books (${r.rated} rated) from ${r.source === 'storygraph' ? 'StoryGraph' : 'Goodreads'}.`;
        file.value = '';
        load();
        if (r.rebuilding) await a.waitForBuild(before, (t) => (msg.textContent = t));
      } catch (e) { msg.textContent = e.message; }
      go.disabled = false;
      load();
    } }, 'Import');

    box.append(
      a.block('Goodreads or StoryGraph', 'Brings in your ratings and shelves, and the books you read outside Moon+ (on paper, in other apps). On Goodreads: My Books → Import and export → Export library. On StoryGraph: Manage account → Export StoryGraph library. Uploading again replaces the earlier import.',
        h('label', { for: 'ad-import-file' }, 'Export file (.csv)'), file, h('div', { class: 'ad-actions' }, go), msg),
      a.block('Imported', 'Books are matched to your Moon+ books by ISBN, then by title and author. Books only the export knows show as finished on the day it gives, with no minutes, words or speed, so they count towards books per year and genres but not time. Give them a genre in the Catalogue section (their file is shown as goodreads:<id>). To-read shelves are left out.',
        list, listMsg),
      a.block('Export to Goodreads', 'Your finished books (with their ratings and the day you finished) as a CSV in the layout Goodreads imports: My Books → Import and export → Import. Books that came from Goodreads are left out.',
        h('div', { class: 'ad-actions' }, h('a', { class: 'up-primary ad-auto ad-download', href: 'api/admin/imports/export/goodreads', download: 'goodreads_import.csv' }, 'Download CSV'))));
    load();
  } });
})();
