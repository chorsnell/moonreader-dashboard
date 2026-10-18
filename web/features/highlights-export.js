// Admin → Highlights (BOO-82): export highlights and notes to Obsidian or Logseq (a Markdown
// file per book, zipped) and to Readwise (a CSV for its import, or pushed with your token).
(() => {
  rh.adminSection({ id: 'highlights', title: 'Highlights', order: 17, draw(box, a) {
    const { h } = a;
    const counts = h('p', { class: 'note' }, 'Loading…');
    const rwState = h('p', { class: 'up-note' });
    const token = h('input', { type: 'password', id: 'rw-token', autocomplete: 'off', placeholder: 'Readwise access token' });
    const rwMsg = a.msg();
    const forget = h('button', { class: 'up-link', type: 'button', hidden: true, onclick: async () => {
      if (!confirm('Forget the Readwise token? Highlights already in Readwise stay there.')) return;
      try {
        const res = await fetch('api/admin/highlights/readwise', { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        rwMsg.textContent = 'Forgotten.';
      } catch (e) { rwMsg.textContent = e.message; }
      load();
    } }, 'Forget token');
    const save = h('button', { class: 'up-primary ad-auto', type: 'submit' }, 'Save and test');
    const push = h('button', { class: 'up-primary ad-auto', type: 'button', hidden: true, onclick: () => send(false) }, 'Send new highlights');
    const again = h('button', { class: 'up-link', type: 'button', hidden: true, onclick: () => {
      if (confirm('Send every highlight again? Readwise matches them by text, title and author, so it updates rather than duplicates them.')) send(true);
    } }, 'Send all again');

    async function send(all) {
      push.disabled = true; rwMsg.textContent = 'Sending to Readwise…';
      try {
        const r = await a.post('api/admin/highlights/readwise/push', { all });
        rwMsg.textContent = r.sent ? `Sent ${r.sent} highlights${r.skipped ? ` (${r.skipped} were there already)` : ''}.` : 'Nothing new to send.';
      } catch (e) { rwMsg.textContent = e.message; }
      push.disabled = false;
      load();
    }

    async function load() {
      let s;
      try { s = await a.get('api/admin/highlights'); } catch (e) { counts.textContent = e.message; return; }
      counts.textContent = s.highlights ? `${s.highlights} highlights and notes in ${s.books} books, private books included (this is your own export).` : 'No highlights yet.';
      const rw = s.readwise;
      push.hidden = again.hidden = forget.hidden = !rw.token_set;
      token.placeholder = rw.token_set ? 'Saved (paste a new one to replace it)' : 'Readwise access token';
      rwState.textContent = rw.token_set
        ? `Connected. ${rw.pushed} of ${s.highlights} highlights sent so far` + (rw.last ? `; last sent ${a.when(rw.last.time)}.` : '.')
        : 'Not connected.';
    }

    const form = h('form', { class: 'ad-form', onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true; rwMsg.textContent = 'Checking with Readwise…';
      try { await a.put('api/admin/highlights/readwise', { token: token.value.trim() }); token.value = ''; rwMsg.textContent = 'Connected.'; }
      catch (err) { rwMsg.textContent = err.message; }
      save.disabled = false;
      load();
    } }, h('label', { for: 'rw-token' }, 'Access token'), token,
      h('p', { class: 'up-note' }, 'Get it at readwise.io/access_token. It’s kept in settings.json on this server and only ever sent to Readwise.'),
      h('div', { class: 'ad-actions' }, save, forget), rwState, h('div', { class: 'ad-actions' }, push, again), rwMsg);

    box.append(
      a.block('Highlights and notes', 'Everything you highlighted, from Moon+ and any Kobo or Kindle import.', counts),
      a.block('Obsidian or Logseq', 'A Markdown file per book: front matter with the author, series, genre, ISBN, rating and dates, then each highlight as a quote with your note, in the order they come in the book. Unzip it into your vault; each book keeps the same file name, so the next export replaces last time’s files instead of adding copies (edits you made in those files are overwritten).',
        h('div', { class: 'ad-actions' }, h('a', { class: 'up-primary ad-auto ad-download', href: 'api/admin/highlights/export/markdown.zip', download: 'highlights-markdown.zip' }, 'Download Markdown (zip)'))),
      a.block('Readwise: CSV', 'A CSV in the columns Readwise imports (Highlight, Title, Author, URL, Note, Location, Date): readwise.io/import_bulk. Readwise matches highlights by text, title and author, so importing again doesn’t add copies.',
        h('div', { class: 'ad-actions' }, h('a', { class: 'up-primary ad-auto ad-download', href: 'api/admin/highlights/export/readwise.csv', download: 'readwise_highlights.csv' }, 'Download CSV'))),
      a.block('Readwise: send directly', 'Sends your highlights to Readwise with your access token. Each send only includes highlights not sent before.', form),
    );
    load();
  } });
})();
