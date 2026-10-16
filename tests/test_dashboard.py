"""End-to-end tests: build a tiny fake Moon+ backup, run the real server against a
temporary library, and check rebuilding, uploads, reverse-proxy prefixes and WebDAV.

Run with:  python3 -m unittest discover -s tests
"""
import base64, datetime as dt, http.client, json, os, shutil, socket, sqlite3, subprocess, sys, tempfile, time
import unittest, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = 'test-token'
DAY0 = (dt.date(2026, 3, 1) - dt.date(1970, 1, 1)).days


def make_backup(path):
    """A minimal .mrpro: a zip with _names.list, the mrbooks.db database and positions10.xml."""
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
                   'com.flyersoft.moonreaderp/shared_prefs/positions10.xml\n')
        z.write(db, base + '1.tag')
        z.writestr(base + '2.tag', xml)
    shutil.rmtree(tmp)


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Server:
    def __init__(self, base_path=''):
        self.lib = tempfile.mkdtemp()
        self.port = free_port()
        env = dict(os.environ, LIBRARY=self.lib, PORT=str(self.port), UPLOAD_TOKEN=TOKEN, POLL_SECONDS='5',
                   BASE_PATH=base_path, PUID=str(os.getuid()), PGID=str(os.getgid()))
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
        meta = json.load(open(os.path.join(s.lib, 'data', 'meta.json')))
        self.assertEqual(meta['synced_positions'], 1)


if __name__ == '__main__':
    unittest.main()
