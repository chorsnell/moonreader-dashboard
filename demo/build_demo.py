#!/usr/bin/env python3
"""Build the static demo site: a made-up reading history of public-domain classics,
run through the real update.py, with the page from app/web.

Usage:
    python3 demo/build_demo.py [OUT_DIR]        # default: ./site

It writes a fake Moon+ backup (demo-library.mrpro), turns it into data/*.json with
update.py, looks up covers on Open Library (skipped with COVER_LOOKUP=off), and adds
static stand-ins for /api/config and /api/covers so the page works on any static host,
such as GitHub Pages. The history always ends yesterday, so "this year" is never empty.
"""
import datetime as dt, json, os, random, shutil, sqlite3, subprocess, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP = os.path.join(ROOT, 'app')
EPOCH = dt.date(1970, 1, 1)

# title, author, genre, subgenre, series, series_no, words
BOOKS = [
    ('The Time Machine', 'H. G. Wells', 'Science Fiction', 'Time Travel', None, None, 32000),
    ('The War of the Worlds', 'H. G. Wells', 'Science Fiction', 'Alien Invasion', None, None, 60000),
    ('The Invisible Man', 'H. G. Wells', 'Science Fiction', 'Scientific Romance', None, None, 49000),
    ('The Island of Doctor Moreau', 'H. G. Wells', 'Science Fiction', 'Scientific Romance', None, None, 43000),
    ('Twenty Thousand Leagues Under the Seas', 'Jules Verne', 'Science Fiction', 'Voyages Extraordinaires', None, None, 138000),
    ('Journey to the Centre of the Earth', 'Jules Verne', 'Science Fiction', 'Voyages Extraordinaires', None, None, 80000),
    ('The Lost World', 'Arthur Conan Doyle', 'Science Fiction', 'Lost World', None, None, 75000),
    ('A Princess of Mars', 'Edgar Rice Burroughs', 'Science Fiction', 'Planetary Romance', 'Barsoom', 1, 63000),
    ('The Gods of Mars', 'Edgar Rice Burroughs', 'Science Fiction', 'Planetary Romance', 'Barsoom', 2, 75000),
    ('The Warlord of Mars', 'Edgar Rice Burroughs', 'Science Fiction', 'Planetary Romance', 'Barsoom', 3, 70000),
    ('Herland', 'Charlotte Perkins Gilman', 'Science Fiction', 'Utopia', None, None, 57000),
    ('A Study in Scarlet', 'Arthur Conan Doyle', 'Mystery', 'Detective', 'Sherlock Holmes', 1, 43000),
    ('The Sign of the Four', 'Arthur Conan Doyle', 'Mystery', 'Detective', 'Sherlock Holmes', 2, 43000),
    ('The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', 'Mystery', 'Detective', 'Sherlock Holmes', 3, 105000),
    ('The Memoirs of Sherlock Holmes', 'Arthur Conan Doyle', 'Mystery', 'Detective', 'Sherlock Holmes', 4, 92000),
    ('The Hound of the Baskervilles', 'Arthur Conan Doyle', 'Mystery', 'Detective', 'Sherlock Holmes', 5, 59000),
    ('The Moonstone', 'Wilkie Collins', 'Mystery', 'Sensation Novel', None, None, 196000),
    ('The Woman in White', 'Wilkie Collins', 'Mystery', 'Sensation Novel', None, None, 245000),
    ('The Mysterious Affair at Styles', 'Agatha Christie', 'Mystery', 'Detective', 'Hercule Poirot', 1, 57000),
    ('The Secret Adversary', 'Agatha Christie', 'Mystery', 'Spy', 'Tommy and Tuppence', 1, 75000),
    ('The Thirty-Nine Steps', 'John Buchan', 'Mystery', 'Spy', 'Richard Hannay', 1, 41000),
    ('Pride and Prejudice', 'Jane Austen', 'Classics', 'Romance', None, None, 122000),
    ('Emma', 'Jane Austen', 'Classics', 'Romance', None, None, 160000),
    ('Persuasion', 'Jane Austen', 'Classics', 'Romance', None, None, 84000),
    ('Sense and Sensibility', 'Jane Austen', 'Classics', 'Romance', None, None, 119000),
    ('Jane Eyre', 'Charlotte Brontë', 'Classics', 'Gothic', None, None, 183000),
    ('Wuthering Heights', 'Emily Brontë', 'Classics', 'Gothic', None, None, 107000),
    ('Great Expectations', 'Charles Dickens', 'Classics', 'Victorian', None, None, 183000),
    ('A Tale of Two Cities', 'Charles Dickens', 'Classics', 'Historical', None, None, 135000),
    ('A Christmas Carol', 'Charles Dickens', 'Classics', 'Victorian', None, None, 29000),
    ('Middlemarch', 'George Eliot', 'Classics', 'Victorian', None, None, 316000),
    ('Moby-Dick', 'Herman Melville', 'Classics', 'Sea Story', None, None, 206000),
    ('The Great Gatsby', 'F. Scott Fitzgerald', 'Classics', 'Modernist', None, None, 47000),
    ('Little Women', 'Louisa May Alcott', 'Classics', 'Coming of Age', None, None, 185000),
    ('The Picture of Dorian Gray', 'Oscar Wilde', 'Classics', 'Gothic', None, None, 78000),
    ('Anna Karenina', 'Leo Tolstoy', 'Classics', 'Russian', None, None, 350000),
    ('Crime and Punishment', 'Fyodor Dostoevsky', 'Classics', 'Russian', None, None, 211000),
    ('Treasure Island', 'Robert Louis Stevenson', 'Adventure', 'Pirates', None, None, 67000),
    ('Kidnapped', 'Robert Louis Stevenson', 'Adventure', 'Historical', None, None, 85000),
    ('The Count of Monte Cristo', 'Alexandre Dumas', 'Adventure', 'Revenge', None, None, 464000),
    ('The Three Musketeers', 'Alexandre Dumas', 'Adventure', 'Swashbuckler', None, None, 228000),
    ('Around the World in Eighty Days', 'Jules Verne', 'Adventure', 'Travel', None, None, 63000),
    ('The Call of the Wild', 'Jack London', 'Adventure', 'Wilderness', None, None, 32000),
    ('White Fang', 'Jack London', 'Adventure', 'Wilderness', None, None, 72000),
    ('The Prisoner of Zenda', 'Anthony Hope', 'Adventure', 'Swashbuckler', None, None, 58000),
    ("King Solomon's Mines", 'H. Rider Haggard', 'Adventure', 'Lost World', 'Allan Quatermain', 1, 80000),
    ('The Wonderful Wizard of Oz', 'L. Frank Baum', 'Fantasy', 'Portal Fantasy', 'Oz', 1, 39000),
    ('The Marvelous Land of Oz', 'L. Frank Baum', 'Fantasy', 'Portal Fantasy', 'Oz', 2, 41000),
    ('Ozma of Oz', 'L. Frank Baum', 'Fantasy', 'Portal Fantasy', 'Oz', 3, 40000),
    ("Alice's Adventures in Wonderland", 'Lewis Carroll', 'Fantasy', 'Portal Fantasy', None, None, 27000),
    ('Through the Looking-Glass', 'Lewis Carroll', 'Fantasy', 'Portal Fantasy', None, None, 30000),
    ('Peter Pan', 'J. M. Barrie', 'Fantasy', 'Fairy Tale', None, None, 47000),
    ('The Princess and the Goblin', 'George MacDonald', 'Fantasy', 'Fairy Tale', None, None, 54000),
    ('The King of Elfland\'s Daughter', 'Lord Dunsany', 'Fantasy', 'High Fantasy', None, None, 76000),
    ('Frankenstein', 'Mary Shelley', 'Horror', 'Gothic', None, None, 75000),
    ('Dracula', 'Bram Stoker', 'Horror', 'Vampires', None, None, 160000),
    ('Carmilla', 'Sheridan Le Fanu', 'Horror', 'Vampires', None, None, 30000),
    ('Strange Case of Dr Jekyll and Mr Hyde', 'Robert Louis Stevenson', 'Horror', 'Gothic', None, None, 25000),
    ('The Turn of the Screw', 'Henry James', 'Horror', 'Ghost Story', None, None, 42000),
    ('The Phantom of the Opera', 'Gaston Leroux', 'Horror', 'Gothic', None, None, 85000),
    ('Walden', 'Henry David Thoreau', 'Non-fiction', 'Philosophy', None, None, 114000),
    ('Meditations', 'Marcus Aurelius', 'Non-fiction', 'Philosophy', None, None, 67000),
    ('On the Origin of Species', 'Charles Darwin', 'Non-fiction', 'Science', None, None, 150000),
    ('Narrative of the Life of Frederick Douglass', 'Frederick Douglass', 'Non-fiction', 'Memoir', None, None, 41000),
    ('The Autobiography of Benjamin Franklin', 'Benjamin Franklin', 'Non-fiction', 'Memoir', None, None, 70000),
]
# typical reading speed (wpm) by genre; each book and each day varies around it
SPEED = {'Science Fiction': 270, 'Mystery': 300, 'Classics': 225, 'Adventure': 285, 'Fantasy': 290,
         'Horror': 265, 'Non-fiction': 190}
ABANDON = {'Middlemarch': 23.0, 'On the Origin of Species': 17.0, 'The Princess and the Goblin': 41.0}
REREAD = 'Pride and Prejudice'       # read again near the end
CURRENT = 'The Count of Monte Cristo'  # the book on the go, left part way through


def file_name(title, author):
    return f'{title} - {author}.epub'


def order(rng):
    """Shuffle the books, keeping each series in order."""
    singles = [b for b in BOOKS if not b[4] and b[0] not in (CURRENT, REREAD)]
    series = {}
    for b in BOOKS:
        if b[4]:
            series.setdefault(b[4], []).append(b)
    units = [[b] for b in singles] + list(series.values())
    rng.shuffle(units)
    out = [b for u in units for b in u]
    reread = next(b for b in BOOKS if b[0] == REREAD)
    out.insert(len(out) // 6, reread)                 # first read early on...
    out.append(reread)                                # ...and again years later
    out.append(next(b for b in BOOKS if b[0] == CURRENT))
    return out


def simulate(rng):
    """Day-by-day reading of the books in order. Returns {file: [(day, minutes, words, progress)]}
    with days counted from 0, and the number of days used."""
    log, day = {}, 0
    queue = order(rng)
    for i, (title, author, genre, _, _, _, words) in enumerate(queue):
        f = file_name(title, author)
        stop = ABANDON.get(title, 100.0)
        if title == CURRENT:
            stop = 38.0
        wpm = SPEED[genre] * rng.uniform(0.85, 1.18)
        done = 0
        entries = log.setdefault(f, [])
        while True:
            date = day
            day += 1
            if rng.random() < 0.004:              # the odd holiday away from books
                day += rng.randint(5, 14)
            weekend = (date + 3) % 7 >= 5          # day 0 is a Thursday
            if rng.random() > (0.86 if weekend else 0.72):
                continue
            minutes = max(6.0, rng.lognormvariate(3.65 if weekend else 3.3, 0.45))
            w = int(minutes * wpm * rng.uniform(0.85, 1.15))
            done = min(words, done + w)
            progress = round(done / words * 100, 1)
            if progress >= stop:
                progress = 100.0 if stop >= 100 else stop
                entries.append((date, round(minutes, 1), w, progress))
                break
            entries.append((date, round(minutes, 1), w, progress))
        if i < len(queue) - 1 and rng.random() < 0.3:
            day += rng.randint(1, 6)               # a few days between books
    return log, day


def make_backup(path, log, first_day):
    tmp = tempfile.mkdtemp()
    try:
        db = os.path.join(tmp, 'mrbooks.db')
        c = sqlite3.connect(db)
        c.execute('create table books (_id integer primary key, book text, filename text, lowerFilename text, author text, '
                  'description text, category text, thumbFile text, coverFile text, addTime text, favorite text, '
                  'downloadUrl text, rate text, bak1 text, bak2 text)')
        c.execute('create table tmpbooks as select * from books where 0')
        c.execute('create table statistics (_id integer primary key, filename text, usedTime numeric, readWords numeric, dates text)')
        positions = []
        authors = {file_name(b[0], b[1]): (b[0], b[1]) for b in BOOKS}
        for f, entries in log.items():
            full = '/sdcard/Books/' + f
            title, author = authors[f]
            c.execute('insert into books (book, filename, lowerFilename, author) values (?,?,?,?)', (title, full, full.lower(), author))
            dates = ''.join(f'{first_day + d}|{int(m * 60000)}@{w}\n#{p}%\n' for d, m, w, p in entries)
            c.execute('insert into statistics (filename, usedTime, readWords, dates) values (?,?,?,?)',
                      (full, sum(int(m * 60000) for _, m, _, _ in entries), sum(w for _, _, w, _ in entries), dates))
            positions.append(f'<string name="{full.lower()}">1@0#0:{entries[-1][3]}%</string>')
        c.commit()
        c.close()
        xml = "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n" + '\n'.join(positions) + '\n</map>\n'
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
            base = 'com.flyersoft.moonreaderp/'
            z.writestr(base + '_names.list', base + 'databases/mrbooks.db\n' + base + 'shared_prefs/positions10.xml\n')
            z.write(db, base + '1.tag')
            z.writestr(base + '2.tag', xml)
    finally:
        shutil.rmtree(tmp)


def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'site')
    rng = random.Random(int(os.environ.get('DEMO_SEED', '7')))
    log, days = simulate(rng)
    last = dt.date.today() - dt.timedelta(1)
    first_day = (last - EPOCH).days - days + 1
    first_day -= first_day % 7    # keep simulated weekends on real weekends (day 0 is a Thursday)
    last = EPOCH + dt.timedelta(first_day + days - 1)

    if os.path.isdir(out):
        shutil.rmtree(out)
    shutil.copytree(os.path.join(APP, 'web'), out)
    work = tempfile.mkdtemp()
    try:
        backup = os.path.join(work, 'demo-library.mrpro')
        make_backup(backup, log, first_day)
        catalogue = dict(exclude=[], books={file_name(t, a).lower(): dict(title=t, author=a, series=s, series_no=n,
                                                                           genre=g, subgenre=sg)
                                            for t, a, g, sg, s, n, _ in BOOKS})
        cat_path = os.path.join(work, 'catalogue.json')
        json.dump(catalogue, open(cat_path, 'w', encoding='utf-8'), ensure_ascii=False)
        covers_dir = os.path.join(out, 'covers')
        env = dict(os.environ, CATALOGUE=cat_path, DATA_DIR=os.path.join(out, 'data'), COVERS_DIR=covers_dir)
        subprocess.run([sys.executable, os.path.join(APP, 'update.py'), backup], env=env, check=True)
        if os.environ.get('COVER_LOOKUP', 'on').lower() != 'off':
            subprocess.run([sys.executable, os.path.join(APP, 'covers.py')], env=env, check=False)
    finally:
        shutil.rmtree(work)

    # static stand-ins for the server's JSON endpoints
    meta = json.load(open(os.path.join(out, 'data', 'meta.json'), encoding='utf-8'))
    covers = {}
    if os.path.isdir(covers_dir):
        for f in sorted(os.listdir(covers_dir)):
            stem, ext = os.path.splitext(f)
            if ext in ('.jpg', '.png'):
                covers[stem] = f'covers/{f}'
        for f in os.listdir(covers_dir):
            if f.startswith('.'):
                os.remove(os.path.join(covers_dir, f))
    os.makedirs(os.path.join(out, 'api'), exist_ok=True)
    json.dump(dict(uploads=False, webdav=False, has_data=True, demo=True, meta=meta),
              open(os.path.join(out, 'api', 'config'), 'w', encoding='utf-8'))
    json.dump(covers, open(os.path.join(out, 'api', 'covers'), 'w', encoding='utf-8'))
    open(os.path.join(out, '.nojekyll'), 'w').close()
    print(f'Demo site in {out}: {len(log)} books, {len(covers)} covers, {(EPOCH + dt.timedelta(first_day)).isoformat()} to {last.isoformat()}')


if __name__ == '__main__':
    main()
