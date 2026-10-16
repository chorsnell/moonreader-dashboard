"""End-to-end tests: build a tiny fake Moon+ backup, run the real server against a
temporary library, and check rebuilding, uploads, reverse-proxy prefixes and WebDAV.

Run with:  python3 -m unittest discover -s tests
"""
import base64, datetime as dt, http.client, http.server, json, os, shutil, socket, sqlite3, subprocess, sys, tempfile
import struct, threading, time, unittest, urllib.parse, zipfile, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = 'test-token'
DAY0 = (dt.date(2026, 3, 1) - dt.date(1970, 1, 1)).days
PNG = b'\x89PNG\r\n\x1a\n' + b'\0' * 32
JPEG = b'\xff\xd8\xff\xe0' + b'\0' * 32


def make_backup(path):
    """A minimal .mrpro: a zip with _names.list, the mrbooks.db database, positions10.xml and
    Alpha's cover (Beta has none)."""
    tmp = tempfile.mkdtemp()
    db = os.path.join(tmp, 'mrbooks.db')
    c = sqlite3.connect(db)
    c.execute('create table books (_id integer primary key, book text, filename text, lowerFilename text, author text, '
              'description text, category text, thumbFile text, coverFile text, addTime text, favorite text, '
              'downloadUrl text, rate text, bak1 text, bak2 text)')
    c.execute('create table tmpbooks as select * from books where 0')
    c.execute('create table statistics (_id integer primary key, filename text, usedTime numeric, readWords numeric, dates text)')
    c.execute('create table notes (_id integer primary key, book text, filename text, time numeric, note text, original text)')
    a, b = '/sdcard/Books/Alpha - Ann Author.epub', '/sdcard/Books/Beta - Bob Writer.epub'
    c.execute("insert into books (book, filename, author) values ('Alpha', ?, 'Ann Author'), ('Beta', ?, 'Bob Writer')", (a, b))
    # Alpha: 3 days in March, finished. Beta: 2 days, half way.
    alpha = '\n'.join([f'{DAY0}|1800000@9000', '#40.0%', f'{DAY0 + 1}|1200000@6000', '#70.0%', f'{DAY0 + 2}|1500000@7000', '#100%']) + '\n'
    beta = '\n'.join([f'{DAY0 + 3}|600000@3000', '#20.0%', f'{DAY0 + 5}|900000@4000', '#50.0%']) + '\n'
    c.executemany('insert into statistics (filename, usedTime, readWords, dates) values (?,?,?,?)',
                  [(a, 4500000, 22000, alpha), (b, 1500000, 7000, beta)])
    c.commit(); c.close()
    xml = ("<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n"
           f'<string name="{a.lower()}">10@0#0:100%</string>\n<string name="{b.lower()}">5@0#0:50.0%</string>\n</map>\n')
    with zipfile.ZipFile(path, 'w') as z:
        base = 'com.flyersoft.moonreaderp/'
        z.writestr(base + '_names.list', 'com.flyersoft.moonreaderp/databases/mrbooks.db\n'
                   'com.flyersoft.moonreaderp/shared_prefs/positions10.xml\n'
                   '?/sdcard/Books/.MoonReader/Alpha - Ann Author.epub_1.png\n'
                   '?/sdcard/Books/.MoonReader/Alpha - Ann Author.epub_2.png\n')
        z.write(db, base + '1.tag')
        z.writestr(base + '2.tag', xml)
        z.writestr(base + '3.tag', PNG[:12])   # the small thumbnail
        z.writestr(base + '4.tag', PNG)        # the cover
    shutil.rmtree(tmp)


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Server:
    def __init__(self, base_path='', **extra_env):
        self.lib = tempfile.mkdtemp()
        self.port = free_port()
        env = dict(os.environ, LIBRARY=self.lib, PORT=str(self.port), UPLOAD_TOKEN=TOKEN, POLL_SECONDS='5',
                   BASE_PATH=base_path, PUID=str(os.getuid()), PGID=str(os.getgid()), COVER_LOOKUP='off')
        env.update(extra_env)
        self.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, 'app', 'server.py')], env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                self.request('GET', '/healthz')
                return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError('server did not start')

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        conn.request(method, path, body=body, headers=headers or {})
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, dict(r.getheaders()), data

    def wait_for(self, predicate, timeout=20):
        end = time.time() + timeout
        while time.time() < end:
            if predicate():
                return True
            time.sleep(0.3)
        return False

    def stop(self):
        self.proc.terminate()
        self.proc.wait(5)
        shutil.rmtree(self.lib, ignore_errors=True)


class FakeOpenLibrary(http.server.BaseHTTPRequestHandler):
    """Knows one book, Beta, whose cover is id 42."""
    searches = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == '/search.json':
            title = urllib.parse.parse_qs(url.query)['title'][0]
            self.searches.append(title)
            docs = [{'title': 'Beta', 'cover_i': 42}] if title == 'Beta' else []
            body, ctype = json.dumps({'docs': docs}).encode(), 'application/json'
        elif url.path == '/b/id/42-M.jpg':
            body, ctype = JPEG, 'image/jpeg'
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


DAV_AUTH = {'Authorization': 'Basic ' + base64.b64encode(f'moon:{TOKEN}'.encode()).decode()}


class DashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.backup = os.path.join(cls.tmp, 'test.mrpro')
        make_backup(cls.backup)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def setUp(self):
        self.s = None

    def tearDown(self):
        if self.s:
            self.s.stop()

    def upload(self, s, prefix=''):
        with open(self.backup, 'rb') as f:
            return s.request('PUT', prefix + '/upload?name=test.mrpro', f.read(), {'X-Upload-Token': TOKEN})

    def books(self, s):
        return json.load(open(os.path.join(s.lib, 'data', 'books.json')))

    def test_first_run_has_no_data(self):
        self.s = s = Server()
        status, _, body = s.request('GET', '/api/config')
        cfg = json.loads(body)
        self.assertEqual(status, 200)
        self.assertFalse(cfg['has_data'])
        self.assertTrue(cfg['uploads'])

    def test_upload_builds_data(self):
        self.s = s = Server()
        status, _, body = self.upload(s)
        self.assertEqual(status, 200, body)
        self.assertTrue(s.wait_for(lambda: os.path.exists(os.path.join(s.lib, 'data', 'books.json'))))
        books = {b['title']: b for b in self.books(s)}
        self.assertEqual(books['Alpha']['status'], 'finished')
        self.assertEqual(books['Beta']['progress'], 50.0)
        daily = json.load(open(os.path.join(s.lib, 'data', 'daily.json')))
        self.assertEqual(len(daily), 5)
        self.assertEqual(daily[0]['minutes'], 30.0)
        self.assertEqual(daily[0]['progress'], 40.0)

    def test_covers_from_backup(self):
        self.s = s = Server()
        self.upload(s)
        self.assertTrue(s.wait_for(lambda: os.path.exists(os.path.join(s.lib, 'data', 'books.json'))))
        with open(os.path.join(s.lib, 'covers', 'alpha.png'), 'rb') as f:
            self.assertEqual(f.read(), PNG)  # the larger of the two images
        covers = json.loads(s.request('GET', '/api/covers')[2])
        self.assertEqual(list(covers), ['alpha'])
        self.assertTrue(covers['alpha'].startswith('covers/alpha.png?v='))
        status, headers, body = s.request('GET', '/' + covers['alpha'])
        self.assertEqual((status, headers['Content-Type'], body), (200, 'image/png', PNG))
        for path in ('/covers/beta.png', '/covers/../catalogue.json', '/covers/.misses.json', '/covers/alpha.gif'):
            self.assertEqual(s.request('GET', path)[0], 404, path)

    def test_missing_covers_are_looked_up(self):
        FakeOpenLibrary.searches = []
        ol = http.server.ThreadingHTTPServer(('127.0.0.1', 0), FakeOpenLibrary)
        threading.Thread(target=ol.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{ol.server_address[1]}'
        try:
            self.s = s = Server(COVER_LOOKUP='on', OPENLIBRARY_URL=url, OPENLIBRARY_COVERS_URL=url, COVER_PAUSE='0')
            self.upload(s)
            self.assertTrue(s.wait_for(lambda: os.path.exists(os.path.join(s.lib, 'covers', 'beta.jpg'))))
            with open(os.path.join(s.lib, 'covers', 'beta.jpg'), 'rb') as f:
                self.assertEqual(f.read(), JPEG)
            self.assertNotIn('Alpha', FakeOpenLibrary.searches)  # the backup already had it
            self.assertEqual(sorted(json.loads(s.request('GET', '/api/covers')[2])), ['alpha', 'beta'])
        finally:
            ol.shutdown()

    def test_upload_rejects_bad_token_and_files(self):
        self.s = s = Server()
        self.assertEqual(s.request('PUT', '/upload?name=a.mrpro', b'PK..', {'X-Upload-Token': 'nope'})[0], 403)
        self.assertEqual(s.request('PUT', '/upload?name=a.mrpro', b'hello', {'X-Upload-Token': TOKEN})[0], 400)
        self.assertEqual(s.request('PUT', '/upload?name=a.zip', b'PK..', {'X-Upload-Token': TOKEN})[0], 400)

    def test_private_files_are_not_served(self):
        self.s = s = Server()
        for path in ('/server.py', '/update.py', '/catalogue.json', '/data/../catalogue.json', '/../app/server.py'):
            self.assertEqual(s.request('GET', path)[0], 404, path)

    def test_base_tag_follows_proxy_prefix(self):
        self.s = s = Server()
        _, _, body = s.request('GET', '/', headers={'X-Forwarded-Prefix': '/reading'})
        self.assertIn(b'<base href="/reading/">', body)
        _, _, body = s.request('GET', '/', headers={'X-Forwarded-Prefix': '/bad"><script>'})
        self.assertIn(b'<base href="/">', body)

    def test_base_path_without_stripping(self):
        self.s = s = Server(base_path='/books')
        status, headers, _ = s.request('GET', '/books')
        self.assertEqual(status, 301)
        self.assertEqual(headers['Location'], '/books/')
        status, _, body = s.request('GET', '/books/')
        self.assertEqual(status, 200)
        self.assertIn(b'<base href="/books/">', body)
        self.assertEqual(s.request('GET', '/books/runtime.js')[0], 200)
        self.assertEqual(s.request('GET', '/books/api/config')[0], 200)

    def test_webdav_requires_password(self):
        self.s = s = Server()
        self.assertEqual(s.request('PROPFIND', '/dav/')[0], 401)
        bad = {'Authorization': 'Basic ' + base64.b64encode(b'moon:wrong').decode()}
        self.assertEqual(s.request('PROPFIND', '/dav/', headers=bad)[0], 401)
        self.assertEqual(s.request('PROPFIND', '/dav/', headers={**DAV_AUTH, 'Depth': '0'})[0], 207)

    def test_webdav_folders_files_and_paths(self):
        self.s = s = Server()
        self.assertEqual(s.request('MKCOL', '/dav/Books/', headers=DAV_AUTH)[0], 201)
        self.assertEqual(s.request('PUT', '/dav/Books/a.txt', b'hi', DAV_AUTH)[0], 201)
        self.assertEqual(s.request('GET', '/dav/Books/a.txt', headers=DAV_AUTH)[2], b'hi')
        status, _, body = s.request('PROPFIND', '/dav/Books/', headers={**DAV_AUTH, 'Depth': '1'},)
        self.assertEqual(status, 207)
        self.assertIn(b'<D:href>/dav/Books/a.txt</D:href>', body)
        mv = {**DAV_AUTH, 'Destination': f'http://127.0.0.1:{s.port}/dav/Books/b.txt'}
        self.assertEqual(s.request('MOVE', '/dav/Books/a.txt', headers=mv)[0], 201)
        self.assertEqual(s.request('GET', '/dav/Books/b.txt', headers=DAV_AUTH)[0], 200)
        self.assertEqual(s.request('DELETE', '/dav/Books/b.txt', headers=DAV_AUTH)[0], 204)
        self.assertEqual(s.request('PUT', '/dav/../escape.txt', b'x', DAV_AUTH)[0], 400)
        self.assertFalse(os.path.exists(os.path.join(s.lib, 'escape.txt')))

    def test_webdav_backup_and_synced_position(self):
        self.s = s = Server()
        with open(self.backup, 'rb') as f:
            self.assertEqual(s.request('PUT', '/dav/Backup/test.mrpro', f.read(), DAV_AUTH)[0], 201)
        self.assertTrue(s.wait_for(lambda: os.path.exists(os.path.join(s.lib, 'data', 'books.json'))))
        # Moon+ syncs "<book file>.po" holding "<ms timestamp>*<chapter>@<split>#<pos>:<percent>%"
        later = int(dt.datetime(2026, 4, 2, 9, 30).timestamp() * 1000)
        s.request('MKCOL', '/dav/Books/', headers=DAV_AUTH)
        s.request('PUT', '/dav/Books/Beta%20-%20Bob%20Writer.epub.po', f'{later}*7@0#100:83.5%'.encode(), DAV_AUTH)
        self.assertTrue(s.wait_for(lambda: {b['title']: b for b in self.books(s)}['Beta']['progress'] == 83.5))
        beta = {b['title']: b for b in self.books(s)}['Beta']
        self.assertEqual(beta['last_read'], '2026-04-02')
        # meta.json is written after books.json, so it can briefly still be the previous build's
        def synced():
            with open(os.path.join(s.lib, 'data', 'meta.json')) as f:
                return json.load(f)['synced_positions']
        self.assertTrue(s.wait_for(lambda: synced() == 1), f'synced_positions is {synced()}')


class CoverTests(unittest.TestCase):
    def test_large_png_is_scaled_down(self):
        sys.path.insert(0, os.path.join(ROOT, 'app'))
        import covers
        w, h = 400, 30  # red on the left half, blue on the right, rows stored with the "Sub" filter
        row = bytearray()
        for x in range(w):
            px = (255, 0, 0) if x < w // 2 else (0, 0, 255)
            prev = (255, 0, 0) if x and x - 1 < w // 2 else (0, 0, 255) if x else (0, 0, 0)
            row += bytes((a - b) & 255 for a, b in zip(px, prev))
        raw = b''.join(b'\x01' + bytes(row) for _ in range(h))
        chunk = lambda t, b: struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b))
        png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
               + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
        small = covers.shrink_png(png, max_width=160)
        nw, nh = struct.unpack('>II', small[16:24])
        self.assertEqual((nw, nh), (133, 10))
        pixels = zlib.decompress(small[small.index(b'IDAT') + 4:-16])
        self.assertEqual(pixels[1:4], b'\xff\x00\x00')     # first pixel still red
        self.assertEqual(pixels[-3:], b'\x00\x00\xff')     # last pixel still blue
        self.assertEqual(covers.shrink_png(PNG), PNG)      # not a real PNG: left alone


if __name__ == '__main__':
    unittest.main()
