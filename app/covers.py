#!/usr/bin/env python3
"""Book covers for the reading dashboard.

update.py saves the covers Moon+ keeps in its backup. Running this script looks up
the rest on Open Library (https://openlibrary.org) by title and author:

    python3 covers.py                         # reads data/books.json, writes covers/

Covers are saved as covers/<book id>.jpg or .png and an existing file is never
replaced, so to use your own image for a book, put it there under that name.
Books Open Library doesn't know are retried after 30 days.

Environment:
  DATA_DIR      folder holding books.json (default: data/ next to this script)
  COVERS_DIR    where covers are saved (default: covers/ next to this script)
  COVER_LOOKUP  set to "off" to never ask Open Library
"""
import datetime as dt, json, os, re, struct, sys, time, unicodedata, urllib.parse, urllib.request, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get('OPENLIBRARY_URL', 'https://openlibrary.org').rstrip('/')
COVER_API = os.environ.get('OPENLIBRARY_COVERS_URL', 'https://covers.openlibrary.org').rstrip('/')
AGENT = 'moonreader-dashboard (+https://github.com/chorsnell/moonreader-dashboard)'
RETRY_DAYS = 30
COVER_WIDTH = 240       # covers from the backup are scaled down to this (sharp at the large size)
PAUSE = float(os.environ.get('COVER_PAUSE', '1'))  # seconds between lookups, to be polite
NAME = re.compile(r'^([a-z0-9-]+)\.(jpg|png)$')


def lookup_enabled():
    return os.environ.get('COVER_LOOKUP', 'on').strip().lower() not in ('off', 'no', 'false', '0')


def existing(covers_dir):
    """{book id: file name} for every cover saved so far."""
    out = {}
    if os.path.isdir(covers_dir):
        for f in os.listdir(covers_dir):
            m = NAME.match(f)
            if m:
                out.setdefault(m.group(1), f)
    return out


def image_ext(data):
    if data[:3] == b'\xff\xd8\xff':
        return 'jpg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    return None


def shrink_png(data, max_width=COVER_WIDTH):
    """Scale a PNG down to max_width (Moon+ keeps covers up to 1500px wide and 3 MB). Uses only
    the standard library, so it handles the common 8-bit non-interlaced kinds and returns
    anything else unchanged."""
    try:
        pos, idat, plte, trns = 8, [], b'', b''
        while pos < len(data):
            n, typ = struct.unpack('>I4s', data[pos:pos + 8])
            body = data[pos + 8:pos + 8 + n]
            pos += 12 + n
            if typ == b'IHDR':
                w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', body)
            elif typ == b'IDAT':
                idat.append(body)
            elif typ == b'PLTE':
                plte = body
            elif typ == b'tRNS':
                trns = body
            elif typ == b'IEND':
                break
        if w <= max_width or depth != 8 or interlace or ctype not in (0, 2, 3, 4, 6):
            return data
        bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
        raw, stride = zlib.decompress(b''.join(idat)), w * bpp
        rows, prev, p = [], bytearray(stride), 0
        for _ in range(h):  # undo the PNG row filters
            f, line = raw[p], bytearray(raw[p + 1:p + 1 + stride])
            p += 1 + stride
            if f == 1:
                for i in range(bpp, stride):
                    line[i] = (line[i] + line[i - bpp]) & 255
            elif f == 2:
                line = bytearray((a + b) & 255 for a, b in zip(line, prev))
            elif f == 3:
                for i in range(stride):
                    line[i] = (line[i] + (((line[i - bpp] if i >= bpp else 0) + prev[i]) >> 1)) & 255
            elif f == 4:
                for i in range(stride):
                    a, b, c = (line[i - bpp], prev[i], prev[i - bpp]) if i >= bpp else (0, prev[i], 0)
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            rows.append(line)
            prev = line
        alpha = ctype in (4, 6) or (ctype == 3 and trns)

        def pixel(x, y):  # -> (r, g, b, a)
            r = rows[y]
            if ctype == 2:
                return r[x * 3], r[x * 3 + 1], r[x * 3 + 2], 255
            if ctype == 6:
                return tuple(r[x * 4:x * 4 + 4])
            if ctype == 3:
                i = r[x]
                return plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], trns[i] if i < len(trns) else 255
            g = r[x * bpp]
            return g, g, g, r[x * 2 + 1] if ctype == 4 else 255

        k = -(-w // max_width)  # each new pixel averages a few samples from a k x k block
        nw, nh, taps = w // k, h // k, [k * (2 * j + 1) // 6 for j in range(3)] if k >= 3 else range(k)
        out = bytearray()
        for y in range(nh):
            out.append(0)
            for x in range(nw):
                s = [pixel(x * k + dx, y * k + dy) for dy in taps for dx in taps]
                px = [sum(c) // len(s) for c in zip(*s)]
                out += bytes(px if alpha else px[:3])

        def chunk(typ, body):
            return struct.pack('>I', len(body)) + typ + body + struct.pack('>I', zlib.crc32(typ + body))
        return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', nw, nh, 8, 6 if alpha else 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(out), 9)) + chunk(b'IEND', b''))
    except (struct.error, zlib.error, IndexError, KeyError, NameError, ValueError):
        return data


def save(covers_dir, book_id, data):
    """Save a cover unless the book already has one. Returns True if it was written."""
    if not image_ext(data) or not re.fullmatch(r'[a-z0-9-]+', book_id) or book_id in existing(covers_dir):
        return False
    if image_ext(data) == 'png':
        data = shrink_png(data)
    ext = image_ext(data)
    os.makedirs(covers_dir, exist_ok=True)
    path = os.path.join(covers_dir, f'{book_id}.{ext}')
    with open(path + '.part', 'wb') as f:
        f.write(data)
    os.replace(path + '.part', path)
    return True


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.split(r'[:(\[]', s)[0]
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def find_cover(title, author):
    """The Open Library cover id for a book, or None. Raises OSError when it can't be reached."""
    def search(**q):
        url = f'{API}/search.json?' + urllib.parse.urlencode(dict(q, fields='cover_i,title', limit=5))
        return json.loads(get(url)).get('docs') or []

    short = re.split(r'\s*[:(\[]', title)[0].strip() or title
    if author:
        # Moon+ authors look like "King, Stephen & Straub, Peter": keep the first one's surname
        first = re.split(r'\s*(?:&|;| and )\s*', author)[0]
        surname = first.split(',')[0].strip() if ',' in first else first.split()[-1] if first.split() else ''
        for d in search(title=short, author=surname):
            if d.get('cover_i'):
                return d['cover_i']
    # without an author, only trust an exact title match
    for d in search(title=short):
        if d.get('cover_i') and norm(d.get('title')) == norm(short):
            return d['cover_i']
    return None


def main():
    data_dir = os.environ.get('DATA_DIR', os.path.join(HERE, 'data'))
    covers_dir = os.environ.get('COVERS_DIR', os.path.join(HERE, 'covers'))
    if not lookup_enabled():
        print('Cover lookup is off (COVER_LOOKUP).')
        return
    try:
        books = json.load(open(os.path.join(data_dir, 'books.json'), encoding='utf-8'))
    except (OSError, ValueError):
        sys.exit('No books.json yet, so there are no covers to look up.')
    os.makedirs(covers_dir, exist_ok=True)
    misses_path = os.path.join(covers_dir, '.misses.json')
    try:
        misses = json.load(open(misses_path, encoding='utf-8'))
    except (OSError, ValueError):
        misses = {}
    today = dt.date.today()
    retry_from = (today - dt.timedelta(days=RETRY_DAYS)).isoformat()
    have = existing(covers_dir)
    todo = [b for b in books if b['id'] not in have and misses.get(b['id'], '') < retry_from]
    if not todo:
        return
    print(f'Looking up {len(todo)} cover(s) on Open Library')
    found, failures = 0, 0
    for n, b in enumerate(todo):
        if n:
            time.sleep(PAUSE)
        try:
            cover = find_cover(b['title'], b.get('author') or '')
            data = get(f'{COVER_API}/b/id/{cover}-M.jpg?default=false') if cover else None
        except (OSError, ValueError) as e:
            failures += 1
            if failures >= 3:
                print(f'  Stopped: Open Library could not be reached ({e}). The rest will be tried after the next rebuild.')
                break
            continue
        failures = 0
        if data and save(covers_dir, b['id'], data):
            found += 1
            misses.pop(b['id'], None)
        else:
            misses[b['id']] = today.isoformat()
        if n % 20 == 19:
            json.dump(misses, open(misses_path, 'w', encoding='utf-8'))
    json.dump(misses, open(misses_path, 'w', encoding='utf-8'))
    left = sum(1 for b in todo if b['id'] in misses)
    print(f'Found {found} cover(s) on Open Library' + (f'; {left} book(s) not found, retried after {RETRY_DAYS} days' if left else ''))


if __name__ == '__main__':
    main()
