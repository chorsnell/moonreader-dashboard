#!/usr/bin/env python3
"""Moon+ Reader dashboard server.

Serves the dashboard (to everyone, or only to people with the read password, as
the admin chooses), rebuilds its data whenever a newer Moon+ backup (.mrpro)
arrives (in /library/inbox, by upload, or over WebDAV) or catalogue.json is
edited, and accepts reading positions that Moon+ syncs over WebDAV.

Environment:
  PORT          port to listen on (default 8080)
  LIBRARY       folder holding inbox/, data/, dav/ and catalogue.json (default /library)
  BASE_PATH     the path the dashboard is served under, e.g. /reading (only needed
                when a reverse proxy forwards that path without stripping it)
  UPLOAD_TOKEN  the admin password: turns on uploads, WebDAV sync and the admin sign-in
  POLL_SECONDS  how often to look for new backups (default 30)
  KEEP_BACKUPS  how many backups to keep in inbox/ (default 5)
  COVER_LOOKUP  set to "off" to stop looking up missing book covers on Open Library
"""
import base64, email.utils, hashlib, hmac, html, http.server, json, mimetypes, os, re, shutil, socketserver, subprocess, sys
import threading, time, urllib.parse
from xml.sax.saxutils import escape as xml_escape

APP = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(APP, 'web')
SEED = os.path.join(APP, 'seed')
LIB = os.environ.get('LIBRARY', '/library')
INBOX, DATA, DAV = os.path.join(LIB, 'inbox'), os.path.join(LIB, 'data'), os.path.join(LIB, 'dav')
COVERS = os.path.join(LIB, 'covers')
CATALOGUE = os.path.join(LIB, 'catalogue.json')
LOG = os.path.join(LIB, 'update.log')
SETTINGS = os.path.join(LIB, 'settings.json')
SESSION_KEY = os.path.join(LIB, '.session-key')
COOKIE = 'mrd_session'
SESSION_DAYS = {'admin': 30, 'reader': 365}
PORT = int(os.environ.get('PORT', '8080'))
POLL = max(5, int(os.environ.get('POLL_SECONDS', '30')))
KEEP = max(1, int(os.environ.get('KEEP_BACKUPS', '5')))
TOKEN = os.environ.get('UPLOAD_TOKEN', '').strip()
BASE_PATH = '/' + os.environ.get('BASE_PATH', '').strip().strip('/') if os.environ.get('BASE_PATH', '').strip('/ ') else ''
MAX_UPLOAD = 1024 * 1024 * 1024  # 1 GB
SAFE_PREFIX = re.compile(r'^(/[A-Za-z0-9._~-]+)*$')
COVER_NAME = re.compile(r'^([a-z0-9-]+)\.(jpg|png)$')

wake = threading.Event()
cover_lock = threading.Lock()
status = {'last_build': None, 'last_error': None, 'building': False, 'last_sync': None}


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass


def seed():
    for d in (INBOX, DATA, DAV, COVERS):
        os.makedirs(d, exist_ok=True)
    if not os.path.exists(CATALOGUE):
        shutil.copy(os.path.join(SEED, 'catalogue.json'), CATALOGUE)
        log('Created catalogue.json from the built-in copy')


# ---------------------------------------------------------------- access

settings_lock = threading.Lock()


def load_settings():
    """{'access': 'public' or 'password', 'read_password': a pbkdf2 hash or ''}"""
    try:
        with open(SETTINGS, encoding='utf-8') as f:
            s = json.load(f)
    except (OSError, ValueError):
        s = {}
    access = s.get('access') if s.get('access') in ('public', 'password') else 'public'
    pw = s.get('read_password') or ''
    if access == 'password' and not pw:
        access = 'public'  # nothing anyone could type would open it
    return {'access': access, 'read_password': pw}


def save_settings(new):
    with settings_lock:
        tmp = SETTINGS + '.part'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(new, f, indent=2)
        os.replace(tmp, SETTINGS)


def hash_password(pw, salt=None, rounds=200_000):
    salt = salt or os.urandom(16).hex()
    return f"pbkdf2_sha256${rounds}${salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), rounds).hex()}"


def check_password(pw, stored):
    try:
        _, rounds, salt, _ = stored.split('$')
        return hmac.compare_digest(hash_password(pw, salt, int(rounds)), stored)
    except ValueError:
        return False


_key = None


def session_key():
    """A random key kept in the library, so sign-ins survive restarts."""
    global _key
    if _key is None:
        try:
            with open(SESSION_KEY, 'rb') as f:
                _key = f.read()
        except OSError:
            _key = b''
        if len(_key) < 32:
            _key = os.urandom(32)
            with open(SESSION_KEY, 'wb') as f:
                f.write(_key)
            try:
                os.chmod(SESSION_KEY, 0o600)
            except OSError:
                pass
    return _key


def session_stamp(role):
    """Changing the admin token or the read password signs out everyone who used the old one."""
    secret = TOKEN if role == 'admin' else load_settings()['read_password'] if role == 'reader' else ''
    return hashlib.sha256(secret.encode()).hexdigest() if secret else ''


def make_session(role):
    exp = int(time.time()) + SESSION_DAYS[role] * 86400
    msg = f'{role}.{exp}'
    sig = hmac.new(session_key(), f'{msg}.{session_stamp(role)}'.encode(), hashlib.sha256).hexdigest()
    return f'{msg}.{sig}', SESSION_DAYS[role] * 86400


def check_session(value):
    try:
        role, exp, sig = value.split('.')
        if role not in SESSION_DAYS or int(exp) < time.time():
            return None
    except ValueError:
        return None
    stamp = session_stamp(role)
    if not stamp:
        return None
    good = hmac.new(session_key(), f'{role}.{exp}.{stamp}'.encode(), hashlib.sha256).hexdigest()
    return role if hmac.compare_digest(sig, good) else None


# ---------------------------------------------------------------- rebuilding

def backups():
    files = [os.path.join(INBOX, f) for f in os.listdir(INBOX) if f.lower().endswith('.mrpro') and not f.startswith('.')]
    return sorted(files, key=os.path.getmtime, reverse=True)


def newest_sync():
    newest = 0
    for root, _, files in os.walk(DAV):
        for f in files:
            if f.lower().endswith('.po'):
                newest = max(newest, os.path.getmtime(os.path.join(root, f)))
    return newest


def needs_build():
    b = backups()
    if not b:
        return None
    meta = os.path.join(DATA, 'meta.json')
    built = os.path.getmtime(meta) if os.path.exists(meta) else 0
    if max(os.path.getmtime(b[0]), os.path.getmtime(CATALOGUE), newest_sync()) > built:
        return b[0]
    return None


def fail(path, why):
    """Keep the last good data and set the bad backup aside so it isn't retried."""
    status['last_error'] = why
    try:
        os.replace(path, path + '.failed')
        log(f'  Build failed, kept the previous data. Renamed it to {os.path.basename(path)}.failed')
    except OSError:
        pass


def build(path):
    status['building'] = True
    log(f'Rebuilding from {os.path.basename(path)}')
    env = dict(os.environ, CATALOGUE=CATALOGUE, DATA_DIR=DATA, SYNC_DIR=DAV, COVERS_DIR=COVERS)
    try:
        r = subprocess.run([sys.executable, os.path.join(APP, 'update.py'), path], env=env,
                           capture_output=True, text=True, timeout=600)
        for line in (r.stdout + r.stderr).strip().splitlines():
            log('  ' + line)
        if r.returncode == 0:
            status['last_build'], status['last_error'] = time.strftime('%Y-%m-%d %H:%M:%S'), None
            look_up_covers()
        else:
            lines = (r.stderr or r.stdout).strip().splitlines()
            fail(path, lines[-1] if lines else 'update failed')
    except Exception as e:  # noqa: BLE001
        fail(path, str(e))
    finally:
        status['building'] = False
    dav_backups = sorted((os.path.join(r, f) for r, _, fs in os.walk(DAV) for f in fs if f.lower().endswith('.mrpro')),
                         key=os.path.getmtime, reverse=True)
    for old in backups()[KEEP:] + dav_backups[KEEP:]:
        try:
            os.remove(old)
            log(f'Removed old backup {os.path.relpath(old, LIB)}')
        except OSError:
            pass


def look_up_covers():
    """Find covers the backup didn't have, in the background (it takes a few minutes the first time)."""
    if os.environ.get('COVER_LOOKUP', 'on').strip().lower() in ('off', 'no', 'false', '0'):
        return
    if not os.path.exists(os.path.join(DATA, 'books.json')) or not cover_lock.acquire(blocking=False):
        return

    def run():
        try:
            env = dict(os.environ, DATA_DIR=DATA, COVERS_DIR=COVERS)
            r = subprocess.run([sys.executable, os.path.join(APP, 'covers.py')], env=env,
                               capture_output=True, text=True, timeout=3600)
            for line in (r.stdout + r.stderr).strip().splitlines():
                log('  ' + line)
        except Exception as e:  # noqa: BLE001
            log(f'Cover lookup failed: {e}')
        finally:
            cover_lock.release()
    threading.Thread(target=run, daemon=True).start()


def cover_list():
    """{book id: URL} for every saved cover; the mtime in the URL lets browsers cache them for good."""
    out = {}
    try:
        names = os.listdir(COVERS)
    except OSError:
        return out
    for f in names:
        m = COVER_NAME.match(f)
        if m and m.group(1) not in out:
            try:
                out[m.group(1)] = f'covers/{f}?v={int(os.path.getmtime(os.path.join(COVERS, f)))}'
            except OSError:
                pass
    return out


def watcher():
    while True:
        try:
            p = needs_build()
            if p:
                # wait until a copy in progress has finished
                size = -1
                while size != os.path.getsize(p):
                    size = os.path.getsize(p)
                    time.sleep(2)
                build(p)
        except Exception as e:  # noqa: BLE001
            log(f'watcher error: {e}')
        wake.wait(POLL)
        wake.clear()


def receive_backup(src_path, name):
    """A backup arrived (upload or WebDAV): put it in the inbox and rebuild."""
    name = re.sub(r'[^A-Za-z0-9._-]+', '_', name)
    dest = os.path.join(INBOX, name)
    if os.path.abspath(src_path) != os.path.abspath(dest):
        try:  # a hard link costs no extra space when inbox/ and dav/ share a disk
            if os.path.exists(dest + '.part'):
                os.remove(dest + '.part')
            os.link(src_path, dest + '.part')
        except OSError:
            shutil.copyfile(src_path, dest + '.part')
        os.replace(dest + '.part', dest)
    wake.set()
    return name


# ---------------------------------------------------------------- HTTP

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'moonreader-dashboard'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass  # keep logs to builds, uploads and syncs

    # ----- helpers
    def prefix(self):
        """The public path the dashboard lives under, from the reverse proxy or BASE_PATH."""
        p = (self.headers.get('X-Forwarded-Prefix') or '').strip().rstrip('/')
        if p and SAFE_PREFIX.match(p):
            return p
        return BASE_PATH

    def route(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if BASE_PATH and (path == BASE_PATH or path.startswith(BASE_PATH + '/')):
            path = path[len(BASE_PATH):] or ''
        return path

    def send(self, code, body=b'', ctype='text/plain; charset=utf-8', extra=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        if body or code not in (204, 304):
            self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD' and body:
            self.wfile.write(body)

    def send_json(self, code, obj, extra=None):
        self.send(code, json.dumps(obj), 'application/json', extra)

    def drain(self):
        """Read and discard a request body we are refusing, so the connection stays usable."""
        try:
            left = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            left = 0
        while left > 0:
            chunk = self.rfile.read(min(left, 1 << 20))
            if not chunk:
                break
            left -= len(chunk)

    def authorised(self):
        """Admin, by token (upload scripts and WebDAV) or by the admin sign-in cookie."""
        if not TOKEN:
            return False
        tok = self.headers.get('X-Upload-Token', '')
        if tok:
            return hmac.compare_digest(tok, TOKEN)
        auth = self.headers.get('Authorization', '')
        if auth.lower().startswith('basic '):
            try:
                _, _, pw = base64.b64decode(auth[6:]).decode('utf-8', 'replace').partition(':')
            except ValueError:
                return False
            return hmac.compare_digest(pw, TOKEN)
        return self.role() == 'admin'

    def role(self):
        """'admin', 'reader' or None, from the sign-in cookie."""
        for part in self.headers.get('Cookie', '').split(';'):
            k, _, v = part.strip().partition('=')
            if k == COOKIE:
                role = check_session(v)
                return None if role == 'admin' and not TOKEN else role
        return None

    def can_read(self):
        return load_settings()['access'] == 'public' or self.role() is not None or self.authorised()

    def cookie(self, value, max_age):
        secure = '; Secure' if self.headers.get('X-Forwarded-Proto', '').lower() == 'https' else ''
        return f'{COOKIE}={value}; Path={self.prefix()}/; Max-Age={max_age}; HttpOnly; SameSite=Strict{secure}'

    def read_json(self, limit=4096):
        """A small JSON body, or None. Requiring the JSON content type means other sites
        can't post here from a visitor's browser without a CORS preflight, which we refuse."""
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = -1
        ctype = self.headers.get('Content-Type', '').split(';')[0].strip().lower()
        if ctype != 'application/json' or not 0 <= length <= limit:
            self.drain()
            return None
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            return None
        return body if isinstance(body, dict) else None

    def read_body_to(self, dest, check=None):
        """Stream the request body into dest. Returns an error string or None."""
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            if self.headers.get('Transfer-Encoding', '').lower() == 'chunked':
                return self.read_chunked_to(dest, check)
            return 'Missing Content-Length.'
        if length > MAX_UPLOAD:
            self.drain()
            return 'Upload too large.'
        tmp = dest + '.part'
        left, first = length, True
        with open(tmp, 'wb') as f:
            while left:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                if first and check and not check(chunk):
                    f.close(); os.remove(tmp); self.drain_rest(left - len(chunk))
                    return 'bad-content'
                first = False
                f.write(chunk)
                left -= len(chunk)
        if left:
            os.remove(tmp)
            return 'Upload was cut short.'
        os.replace(tmp, dest)
        return None

    def drain_rest(self, left):
        while left > 0:
            chunk = self.rfile.read(min(left, 1 << 20))
            if not chunk:
                break
            left -= len(chunk)

    def read_chunked_to(self, dest, check=None):
        tmp, total, first = dest + '.part', 0, True
        with open(tmp, 'wb') as f:
            while True:
                size = int(self.rfile.readline().split(b';')[0].strip() or b'0', 16)
                if size == 0:
                    self.rfile.readline()
                    break
                chunk = self.rfile.read(size)
                self.rfile.readline()
                if first and check and not check(chunk):
                    f.close(); os.remove(tmp)
                    return 'bad-content'
                first = False
                total += len(chunk)
                if total > MAX_UPLOAD:
                    f.close(); os.remove(tmp)
                    return 'Upload too large.'
                f.write(chunk)
        os.replace(tmp, dest)
        return None

    # ----- GET / HEAD
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self.route()
        if path.startswith('/dav'):
            return self.dav()
        if path == '' and BASE_PATH:
            return self.send(301, '', extra={'Location': BASE_PATH + '/'})
        if path == '/healthz':
            return self.send_json(200, {'ok': True, 'building': status['building']})
        if path == '/api/config':
            role = 'admin' if self.authorised() else self.role()
            access = dict(access=load_settings()['access'], role=role, admin=bool(TOKEN))
            access['can_read'] = access['access'] == 'public' or role is not None
            if not access['can_read']:
                return self.send_json(200, access, {'Cache-Control': 'no-store'})
            has_data = os.path.exists(os.path.join(DATA, 'books.json'))
            meta = {}
            try:
                meta = json.load(open(os.path.join(DATA, 'meta.json'), encoding='utf-8'))
            except (OSError, ValueError):
                pass
            admin = role == 'admin'
            return self.send_json(200, dict(access, uploads=admin, webdav=admin, has_data=has_data, meta=meta,
                                            building=status['building'], last_build=status['last_build'],
                                            last_error=status['last_error'] if admin else None),
                                  {'Cache-Control': 'no-store'})
        if (path == '/api/covers' or path.startswith(('/covers/', '/data/'))) and not self.can_read():
            return self.send_json(401, {'error': 'Sign in to see this dashboard.'})
        if path == '/api/covers':
            return self.send_json(200, cover_list(), {'Cache-Control': 'no-cache'})
        if path.startswith('/covers/'):
            name = path[len('/covers/'):]
            if not COVER_NAME.match(name):
                return self.send(404, 'Not found')
            scope = 'public' if load_settings()['access'] == 'public' else 'private'
            return self.file(os.path.join(COVERS, name), {'Cache-Control': f'{scope}, max-age=31536000, immutable'})
        if path == '/upload':
            return self.send(302, '', extra={'Location': self.prefix() + '/#upload'})
        if path.startswith('/data/'):
            name = path[len('/data/'):]
            if not re.fullmatch(r'[a-z_]+\.json', name):
                return self.send(404, 'Not found')
            return self.file(os.path.join(DATA, name), {'Cache-Control': 'no-cache'})
        if path in ('', '/', '/index.html'):
            return self.index()
        full = os.path.normpath(os.path.join(WEB, path.lstrip('/')))
        if not full.startswith(WEB + os.sep):
            return self.send(404, 'Not found')
        return self.file(full, {'Cache-Control': 'public, max-age=300'})

    def index(self):
        with open(os.path.join(WEB, 'index.html'), encoding='utf-8') as f:
            page = f.read()
        # every asset URL in the page is relative; <base> makes them resolve under the
        # public prefix whatever the proxy did with the trailing slash
        base = html.escape(self.prefix() + '/', quote=True)
        page = page.replace('<head>', f'<head>\n<base href="{base}">', 1)
        self.send(200, page, 'text/html; charset=utf-8', {'Cache-Control': 'no-cache'})

    def file(self, full, headers):
        if not os.path.isfile(full):
            return self.send(404, 'Not found')
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
            ctype += '; charset=utf-8'
        with open(full, 'rb') as f:
            self.send(200, f.read(), ctype, headers)

    # ----- signing in, and the admin's choice of who can see the dashboard
    def do_POST(self):
        path = self.route()
        if path == '/api/login':
            pw = str((self.read_json() or {}).get('password', ''))
            read_pw = load_settings()['read_password']
            if TOKEN and pw and hmac.compare_digest(pw, TOKEN):
                role = 'admin'
            elif read_pw and pw and check_password(pw, read_pw):
                role = 'reader'
            else:
                time.sleep(1)
                return self.send_json(403, {'error': 'Wrong password.'})
            value, age = make_session(role)
            return self.send_json(200, {'ok': True, 'role': role}, {'Set-Cookie': self.cookie(value, age)})
        if path == '/api/logout':
            self.drain()
            return self.send_json(200, {'ok': True}, {'Set-Cookie': self.cookie('', 0)})
        if path == '/api/access':
            if not self.authorised():
                self.drain()
                return self.send_json(403, {'error': 'Only the admin can change this.'})
            body = self.read_json()
            if body is None or body.get('access') not in ('public', 'password'):
                return self.send_json(400, {'error': 'Choose public or password.'})
            new = dict(load_settings(), access=body['access'])
            pw = str(body.get('password') or '')
            if pw:
                if len(pw) < 4:
                    return self.send_json(400, {'error': 'Use a read password of at least 4 characters.'})
                if TOKEN and hmac.compare_digest(pw, TOKEN):
                    return self.send_json(400, {'error': 'Use a read password that differs from the admin token.'})
                new['read_password'] = hash_password(pw)
            if new['access'] == 'password' and not new['read_password']:
                return self.send_json(400, {'error': 'Set a read password.'})
            save_settings(new)
            log(f"Dashboard is now {new['access']}" + (', with a new read password' if pw else ''))
            return self.send_json(200, {'ok': True, 'access': new['access']})
        self.drain()
        return self.send_json(404, {'error': 'Not found'})

    # ----- uploads from the dashboard
    def do_PUT(self):
        path = self.route()
        if path.startswith('/dav'):
            return self.dav()
        if path != '/upload' or not TOKEN:
            self.drain()
            return self.send_json(404, {'error': 'Uploads are turned off on this server.'})
        if not self.authorised():
            self.drain()
            time.sleep(1)
            return self.send_json(403, {'error': 'Sign in as the admin to upload.'})
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = re.sub(r'[^A-Za-z0-9._-]+', '_', os.path.basename(q.get('name', ['backup.mrpro'])[0]))
        if not name.lower().endswith('.mrpro'):
            self.drain()
            return self.send_json(400, {'error': 'That isn\'t a .mrpro backup file.'})
        err = self.read_body_to(os.path.join(INBOX, name), check=lambda c: c.startswith(b'PK'))
        if err == 'bad-content':
            return self.send_json(400, {'error': 'That file isn\'t a Moon+ backup.'})
        if err:
            return self.send_json(400, {'error': err})
        size = os.path.getsize(os.path.join(INBOX, name))
        log(f'Received upload {name} ({size // (1024 * 1024)} MB)')
        wake.set()
        return self.send_json(200, {'ok': True})

    # ----- WebDAV, for Moon+ Reader's sync and cloud backup
    def do_OPTIONS(self):
        if self.route().startswith('/dav'):
            return self.send(200, '', extra={'DAV': '1, 2', 'MS-Author-Via': 'DAV',
                                             'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK'})
        return self.send(200, '', extra={'Allow': 'OPTIONS, GET, HEAD, PUT, POST'})

    def do_PROPFIND(self): self.dav()
    def do_PROPPATCH(self): self.dav()
    def do_MKCOL(self): self.dav()
    def do_DELETE(self): self.dav()
    def do_MOVE(self): self.dav()
    def do_COPY(self): self.dav()
    def do_LOCK(self): self.dav()
    def do_UNLOCK(self): self.dav()

    def dav_path(self, path):
        rel = path[len('/dav'):].lstrip('/')
        if not rel:
            return DAV
        parts = [p for p in rel.split('/') if p]
        if any(p in ('.', '..') or '\x00' in p for p in parts):
            return None
        return os.path.join(DAV, *parts)

    def dav(self):
        path = self.route()
        if not TOKEN:
            self.drain()
            return self.send(404, 'WebDAV is turned off. Set UPLOAD_TOKEN to turn it on.')
        if not self.authorised():
            self.drain()
            return self.send(401, 'Log in with any username and your UPLOAD_TOKEN as the password.',
                             extra={'WWW-Authenticate': 'Basic realm="Moon+ Reader dashboard"'})
        full = self.dav_path(path)
        if full is None:
            self.drain()
            return self.send(400, 'Bad path')
        m = self.command
        if m in ('GET', 'HEAD'):
            if os.path.isdir(full):
                return self.send(200, 'Moon+ Reader dashboard WebDAV folder.\n')
            return self.file(full, {})
        if m == 'PUT':
            if os.path.isdir(full):
                self.drain()
                return self.send(409, 'That is a folder.')
            os.makedirs(os.path.dirname(full), exist_ok=True)
            existed = os.path.exists(full)
            err = self.read_body_to(full)
            if err:
                return self.send(400, err)
            self.after_dav_write(full)
            return self.send(204 if existed else 201)
        if m == 'MKCOL':
            self.drain()
            if os.path.exists(full):
                return self.send(405, 'Already exists')
            os.makedirs(full, exist_ok=True)
            return self.send(201)
        if m == 'DELETE':
            self.drain()
            if not os.path.exists(full):
                return self.send(404, 'Not found')
            if full == DAV:
                return self.send(403, 'Refusing to delete the root')
            shutil.rmtree(full) if os.path.isdir(full) else os.remove(full)
            return self.send(204)
        if m in ('MOVE', 'COPY'):
            self.drain()
            dest_hdr = urllib.parse.unquote(urllib.parse.urlparse(self.headers.get('Destination', '')).path)
            pre = self.prefix()
            if pre and dest_hdr.startswith(pre + '/'):
                dest_hdr = dest_hdr[len(pre):]
            elif BASE_PATH and dest_hdr.startswith(BASE_PATH + '/'):
                dest_hdr = dest_hdr[len(BASE_PATH):]
            dest = self.dav_path(dest_hdr) if dest_hdr.startswith('/dav') else None
            if dest is None or not os.path.exists(full):
                return self.send(400 if dest is None else 404, 'Bad move')
            existed = os.path.exists(dest)
            if existed and self.headers.get('Overwrite', 'T').upper() == 'F':
                return self.send(412, 'Destination exists')
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if existed:
                shutil.rmtree(dest) if os.path.isdir(dest) else os.remove(dest)
            if m == 'MOVE':
                os.replace(full, dest)
            elif os.path.isdir(full):
                shutil.copytree(full, dest)
            else:
                shutil.copyfile(full, dest)
            if os.path.isfile(dest):
                self.after_dav_write(dest)
            return self.send(204 if existed else 201)
        if m == 'PROPFIND':
            self.drain()
            if not os.path.exists(full):
                return self.send(404, 'Not found')
            depth = self.headers.get('Depth', '1')
            items = [full]
            if os.path.isdir(full) and depth != '0':
                items += [os.path.join(full, n) for n in sorted(os.listdir(full)) if not n.endswith('.part')]
            body = '<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">' + \
                   ''.join(self.propentry(i) for i in items) + '</D:multistatus>'
            return self.send(207, body, 'application/xml; charset=utf-8')
        if m == 'PROPPATCH':
            self.drain()
            href = xml_escape(self.href(full))
            body = ('<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:"><D:response>'
                    f'<D:href>{href}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status>'
                    '</D:propstat></D:response></D:multistatus>')
            return self.send(207, body, 'application/xml; charset=utf-8')
        if m == 'LOCK':
            self.drain()
            token = f'opaquelocktoken:{int(time.time() * 1000)}'
            body = ('<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>'
                    '<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth>'
                    f'<D:timeout>Second-3600</D:timeout><D:locktoken><D:href>{token}</D:href></D:locktoken>'
                    '</D:activelock></D:lockdiscovery></D:prop>')
            return self.send(200, body, 'application/xml; charset=utf-8', {'Lock-Token': f'<{token}>'})
        if m == 'UNLOCK':
            self.drain()
            return self.send(204)
        self.drain()
        return self.send(405, 'Method not allowed')

    def href(self, full):
        rel = os.path.relpath(full, DAV).replace(os.sep, '/')
        rel = '' if rel == '.' else rel
        h = self.prefix() + '/dav/' + urllib.parse.quote(rel)
        if os.path.isdir(full) and not h.endswith('/'):
            h += '/'
        return h

    def propentry(self, full):
        st = os.stat(full)
        is_dir = os.path.isdir(full)
        name = os.path.basename(full) if full != DAV else 'dav'
        mod = email.utils.formatdate(st.st_mtime, usegmt=True)
        created = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(st.st_mtime))
        props = [f'<D:displayname>{xml_escape(name)}</D:displayname>',
                 f'<D:getlastmodified>{mod}</D:getlastmodified>',
                 f'<D:creationdate>{created}</D:creationdate>']
        if is_dir:
            props.append('<D:resourcetype><D:collection/></D:resourcetype>')
        else:
            ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
            props += ['<D:resourcetype/>', f'<D:getcontentlength>{st.st_size}</D:getcontentlength>',
                      f'<D:getcontenttype>{ctype}</D:getcontenttype>',
                      f'<D:getetag>"{int(st.st_mtime * 1000):x}-{st.st_size:x}"</D:getetag>']
        return (f'<D:response><D:href>{xml_escape(self.href(full))}</D:href><D:propstat><D:prop>'
                + ''.join(props) + '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>')

    def after_dav_write(self, full):
        rel = os.path.relpath(full, DAV)
        low = full.lower()
        if low.endswith('.mrpro'):
            try:
                with open(full, 'rb') as f:
                    ok = f.read(2) == b'PK'
            except OSError:
                ok = False
            if ok:
                name = receive_backup(full, os.path.basename(full))
                log(f'WebDAV: received backup {rel} -> inbox/{name}')
            else:
                log(f'WebDAV: {rel} is not a valid backup, ignored')
        elif low.endswith('.po'):
            status['last_sync'] = time.strftime('%Y-%m-%d %H:%M:%S')
            log(f'WebDAV: reading position {rel}')
            wake.set()
        else:
            log(f'WebDAV: stored {rel}')


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def drop_privileges():
    """Started as root: give /library to PUID:PGID, then run as that user."""
    if os.getuid() != 0:
        return
    uid, gid = int(os.environ.get('PUID', '1000')), int(os.environ.get('PGID', '1000'))
    os.makedirs(LIB, exist_ok=True)
    for root, dirs, files in os.walk(LIB):
        for n in [root] + [os.path.join(root, x) for x in dirs + files]:
            try:
                os.lchown(n, uid, gid)
            except OSError:
                pass
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    os.environ['HOME'] = '/tmp'


def main():
    mimetypes.add_type('application/javascript', '.js')
    drop_privileges()
    seed()
    session_key()
    threading.Thread(target=watcher, daemon=True).start()
    look_up_covers()  # carry on with any lookups an earlier run didn't finish
    log(f"Serving on port {PORT}{' under ' + BASE_PATH if BASE_PATH else ''}; "
        f"uploads and WebDAV {'on' if TOKEN else 'off (set UPLOAD_TOKEN to turn them on)'}; "
        f"the dashboard is {load_settings()['access']}")
    Server(('', PORT), Handler).serve_forever()


if __name__ == '__main__':
    main()
