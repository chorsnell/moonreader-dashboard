#!/usr/bin/env python3
"""Rebuild the reading dashboard's data from a Moon+ Reader backup.

Usage:
    python3 update.py BACKUP.mrpro            # writes data/*.json next to this script
    python3 update.py inbox/                  # uses the newest .mrpro in a folder

Only needs the Python standard library. Book titles, authors, series and genres
come from catalogue.json; books it doesn't know yet are listed at the end and
show as "Untagged" until you add them to the catalogue. Book covers Moon+ keeps
in the backup are saved to covers/ (see covers.py for the rest).
"""
import datetime as dt, html, json, os, re, sqlite3, sys, tempfile, zipfile
from collections import defaultdict

import covers as cover_store

HERE = os.path.dirname(os.path.abspath(__file__))
GAP_DAYS = 365          # a return after this many days starts a new read
FINISHED = 99.0         # progress (%) that counts as finished
EPOCH = dt.date(1970, 1, 1)


def find_backup(arg):
    if os.path.isdir(arg):
        files = [os.path.join(arg, f) for f in os.listdir(arg) if f.lower().endswith('.mrpro')]
        if not files:
            sys.exit(f'No .mrpro files in {arg}')
        return max(files, key=os.path.getmtime)
    return arg


def extract(backup, tmp):
    with zipfile.ZipFile(backup) as z:
        names = [n for n in z.namelist() if n.endswith('_names.list')]
        if not names:
            sys.exit('This does not look like a Moon+ Reader backup (no _names.list).')
        base = names[0][: -len('_names.list')]
        listing = z.read(names[0]).decode('utf-8', 'replace').splitlines()

        def get(suffix):
            for i, line in enumerate(listing, 1):
                if line.strip().endswith(suffix):
                    out = os.path.join(tmp, suffix.replace('/', '_'))
                    with open(out, 'wb') as f:
                        f.write(z.read(f'{base}{i}.tag'))
                    return out
            return None

        # Moon+ caches each book's cover as .MoonReader/<book file>_<n>.png; keep the largest
        best, sizes = {}, {i.filename: i.file_size for i in z.infolist()}
        for i, line in enumerate(listing, 1):
            m = re.search(r'/\.moonreader/([^/]+)_\d\.png$', line.strip().lower())
            tag = f'{base}{i}.tag'
            if m and sizes.get(tag, 0) > best.get(m.group(1), ('', 0))[1]:
                best[m.group(1)] = (tag, sizes[tag])
        covers = {name: z.read(tag) for name, (tag, _) in best.items()}
        return get('databases/mrbooks.db'), get('shared_prefs/positions10.xml'), covers


def clean(fn):
    b = os.path.splitext(os.path.basename(fn))[0]
    b = re.sub(r'\s*--\s*[0-9a-f]{32}.*$', '', b)
    b = re.sub(r'\s*-\s*libgen\.li$', '', b)
    b = re.sub(r'\s*z-lib\.org$', '', b)
    b = re.sub(r'\((BookSee|Booksee)\.(org|Org)\)', '', b)
    return b.replace('_', ' ').strip()

POSITION = re.compile(r'(?:(\d{10,13})\*)?\d+@\d+#\d+:([\d.]+)%')


def apply_sync(sync_dir, by_file, book_for):
    """Read reading-position files Moon+ syncs over WebDAV (*.po) and attach the newest
    position to each book. Returns how many were applied."""
    if not sync_dir or not os.path.isdir(sync_dir):
        return 0
    stems = {}
    for name, b in by_file.items():
        stems.setdefault(os.path.splitext(name)[0], b)
    applied, unknown = 0, []
    for root, _, files in os.walk(sync_dir):
        for f in files:
            if not f.lower().endswith('.po'):
                continue
            full = os.path.join(root, f)
            try:
                text = open(full, encoding='utf-8', errors='replace').read(2000)
            except OSError:
                continue
            m = POSITION.search(text)
            if not m:
                unknown.append(f'{f}: {text.strip()[:60]!r}')
                continue
            ts = int(m.group(1)) / (1000 if len(m.group(1)) == 13 else 1) if m.group(1) else os.path.getmtime(full)
            when = dt.datetime.fromtimestamp(ts)
            name = f[:-3].lower()
            b = by_file.get(name) or stems.get(name) or stems.get(os.path.splitext(name)[0]) or book_for(f[:-3])
            if not b:
                continue
            prev = b.get('sync')
            if not prev or when.isoformat() > prev['time']:
                b['sync'] = dict(date=when.date().isoformat(), time=when.isoformat(timespec='minutes'),
                                 progress=float(m.group(2)))
                applied += 1
    if unknown:
        print(f'{len(unknown)} synced .po file(s) not understood (please report):')
        for u in unknown[:10]:
            print('  ' + u)
    return applied


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    backup = find_backup(sys.argv[1])
    catalogue = json.load(open(os.environ.get('CATALOGUE', os.path.join(HERE, 'catalogue.json')), encoding='utf-8'))
    known, exclude = catalogue['books'], set(catalogue['exclude'])

    with tempfile.TemporaryDirectory() as tmp:
        db_path, pos_path, backup_covers = extract(backup, tmp)
        c = sqlite3.connect(db_path)
        meta = {}
        for table in ('tmpbooks', 'books'):
            for title, path, author in c.execute(f'select book, filename, author from {table}'):
                if path:
                    meta[path.lower()] = (title or '', author or '')
        stats = list(c.execute('select filename, usedTime, readWords, dates from statistics'))
        positions = {}
        if pos_path:
            xml = open(pos_path, encoding='utf-8').read()
            for k, v in re.findall(r'<string name="(.*?)">(.*?)</string>', xml):
                m = re.search(r':([\d.]+)%', v)
                if m:
                    positions[html.unescape(k).lower()] = float(m.group(1))
        c.close()

    untagged = set()

    def identify(path):
        base = os.path.basename(path).lower()
        if not path or base in exclude:
            return None
        if base in known:
            return known[base]
        title, author = meta.get(path.lower(), ('', ''))
        if not title:
            title = clean(path)
            if not any(ch.isupper() for ch in title):
                title = title.title()
        untagged.add(f'{base}  ->  {title}')
        return dict(title=title, author=author, series=None, series_no=None, genre='Untagged', subgenre='Untagged')

    books, by_file = {}, {}

    def book_for(path):
        info = identify(path)
        if not info:
            return None
        key = (info['title'] + '|' + info['author']).lower()
        if key not in books:
            books[key] = dict(info, files=set(), days={}, ms=0, words=0, finals=[])
        books[key]['files'].add(os.path.basename(path))
        by_file[os.path.basename(path).lower()] = books[key]
        return books[key]

    for path, used, words, dates in stats:
        b = book_for(path or '')
        if not b:
            continue
        b['ms'] += used or 0
        b['words'] += words or 0
        last, file_last, prog = None, None, None
        for tok in (dates or '').split():
            if tok.startswith('#'):
                try:
                    p = float(tok[1:].rstrip('%'))
                except ValueError:
                    continue
                if last:
                    last['progress'] = p
                continue
            m = re.match(r'(\d+)(?:\|(\d+)(?:@(\d+))?)?$', tok)
            if not m:
                continue
            day = EPOCH + dt.timedelta(int(m.group(1)))
            d = b['days'].setdefault(day, dict(date=day.isoformat(), minutes=None, words=None, progress=None))
            if m.group(2):
                d['minutes'] = round((d['minutes'] or 0) + int(m.group(2)) / 60000, 1)
            if m.group(3):
                d['words'] = (d['words'] or 0) + int(m.group(3))
            last, file_last = d, day
        p = positions.get((path or '').lower())
        if p is not None:
            b['finals'].append((file_last or EPOCH, p, file_last is not None))

    stat_paths = {(p or '').lower() for p, *_ in stats}
    for path, p in positions.items():
        if path in stat_paths or p <= 0:
            continue
        b = book_for(path)
        if b:
            b['finals'].append((EPOCH, p, False))

    synced = apply_sync(os.environ.get('SYNC_DIR'), by_file, book_for)

    out = []
    for b in books.values():
        days = [b['days'][k] for k in sorted(b['days'])]
        reads = []
        for d in days:
            day = dt.date.fromisoformat(d['date'])
            if not reads or (day - dt.date.fromisoformat(reads[-1][-1]['date'])).days >= GAP_DAYS:
                reads.append([])
            reads[-1].append(d)
        # a lone day of reading only counts as its own read if nothing longer exists
        if any(len(r) > 1 for r in reads):
            reads = [r for r in reads if len(r) > 1]
        elif len(reads) > 1:
            reads = [sum(reads, [])]
        # furthest progress any copy reached during the latest read; copies with no
        # reading log only count when there's a single read (so an old finished copy
        # can't mark a re-read in progress as finished)
        final = None
        if b['finals']:
            start = dt.date.fromisoformat(reads[-1][0]['date']) if reads else EPOCH
            cand = [p for day, p, logged in b['finals'] if (logged and day >= start) or (not logged and len(reads) <= 1)]
            final = max(cand) if cand else max(b['finals'])[1]
        if not days and final is None and not b.get('sync'):
            continue
        rl = []
        for n, r in enumerate(reads, 1):
            mins = [x['minutes'] for x in r if x['minutes']]
            prog = next((x['progress'] for x in reversed(r) if x['progress'] is not None), None)
            if prog is None and n == len(reads):
                prog = final
            rl.append(dict(read_no=n, start=r[0]['date'], end=r[-1]['date'], days_read=len(r),
                           minutes=round(sum(mins), 1) if mins else None, progress=prog,
                           finished=(prog >= FINISHED) if prog is not None else None))
        last_read = days[-1]['date'] if days else None
        sync = b.get('sync')
        if sync and (not last_read or sync['date'] >= last_read):
            # a position synced from the app after the backup was made
            final = sync['progress']
            if rl:
                r = rl[-1]
                r['end'] = max(r['end'], sync['date'])
                r['progress'] = final
                r['finished'] = final >= FINISHED
            else:
                rl.append(dict(read_no=1, start=sync['date'], end=sync['date'], days_read=0, minutes=None,
                               progress=final, finished=final >= FINISHED))
            last_read = max(last_read or '', sync['date'])
        if final is not None and final >= FINISHED:
            status = 'finished'
        elif final:
            status = 'in_progress'
        elif final == 0 or not days:
            status = 'not_started'
        else:
            status = 'unknown'
        out.append(dict(id=re.sub(r'[^a-z0-9]+', '-', b['title'].lower()).strip('-'), title=b['title'], author=b['author'],
                        series=b['series'], series_no=b['series_no'], genre=b['genre'], subgenre=b['subgenre'],
                        status=status, progress=final, total_minutes=round(b['ms'] / 60000, 1), total_words=b['words'],
                        times_read=len(rl), first_read=days[0]['date'] if days else (rl[0]['start'] if rl else None),
                        last_read=last_read, reads=rl, daily=days, synced=sync['time'] if sync else None,
                        source_files=sorted(b['files'])))
    out.sort(key=lambda x: x['last_read'] or '', reverse=True)
    seen = defaultdict(int)
    for b in out:
        seen[b['id']] += 1
        if seen[b['id']] > 1:
            b['id'] += f"-{seen[b['id']]}"

    data_dir = os.environ.get('DATA_DIR', os.path.join(HERE, 'data'))
    os.makedirs(data_dir, exist_ok=True)
    covers_dir = os.environ.get('COVERS_DIR', os.path.join(HERE, 'covers'))
    new_covers = 0
    for b in out:
        for f in b['source_files']:
            data = backup_covers.get(f.lower())
            if data and cover_store.save(covers_dir, b['id'], data):
                new_covers += 1
                break

    def dump(name, value, pretty=False):
        tmp = os.path.join(data_dir, name + '.tmp')
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=1 if pretty else None, separators=None if pretty else (',', ':'))
        os.replace(tmp, os.path.join(data_dir, name))

    books_rows, reads_rows, daily_rows = [], [], []
    for b in out:
        books_rows.append(dict(id=b['id'], title=b['title'], author=b['author'], series=b['series'], series_no=b['series_no'],
                               genre=b['genre'], subgenre=b['subgenre'], status=b['status'], progress=b['progress'],
                               hours=round(b['total_minutes'] / 60, 1), words=b['total_words'], times_read=b['times_read'],
                               first_read=b['first_read'], last_read=b['last_read']))
        for r in b['reads']:
            reads_rows.append(dict(read_id=f"{b['id']}#{r['read_no']}", book_id=b['id'], title=b['title'], author=b['author'],
                                   genre=b['genre'], subgenre=b['subgenre'], series=b['series'], read_no=r['read_no'],
                                   times_read=b['times_read'], start=r['start'], end=r['end'], days_read=r['days_read'],
                                   hours=round(r['minutes'] / 60, 1) if r['minutes'] else None, progress=r['progress'],
                                   finished=r['finished']))
        for d in b['daily']:
            daily_rows.append(dict(date=d['date'], book_id=b['id'], title=b['title'], author=b['author'], genre=b['genre'],
                                   minutes=d['minutes'], words=d['words'], progress=d['progress']))
    reads_rows.sort(key=lambda r: r['start'])
    daily_rows.sort(key=lambda r: r['date'])
    dump('books.json', books_rows)
    dump('reads.json', reads_rows)
    dump('daily.json', daily_rows)
    dump('reading_history.json', dict(schema_version=1, source=dict(app='Moon+ Reader Pro', backup_file=os.path.basename(backup),
         generated=dt.datetime.now().isoformat(timespec='seconds')), books=out), pretty=True)
    dump('meta.json', dict(backup_file=os.path.basename(backup), generated=dt.datetime.now().isoformat(timespec='seconds'),
                           untagged=len(untagged), synced_positions=synced))

    print(f'{os.path.basename(backup)}: {len(out)} books, {len(reads_rows)} reads, {len(daily_rows)} reading days'
          + (f', {synced} synced position(s) applied' if synced else '')
          + (f', {new_covers} new cover(s) from the backup' if new_covers else ''))
    if untagged:
        print(f'\n{len(untagged)} file(s) not in catalogue.json (shown as "Untagged"):')
        for u in sorted(untagged):
            print('  ' + u)


if __name__ == '__main__':
    main()
