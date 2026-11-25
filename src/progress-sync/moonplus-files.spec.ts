import {
  fileKey,
  fileNameDigest,
  matchKey,
  ownPoFile,
  type PoFile,
  poForDocument,
} from './moonplus-files';

const po = (bookFile: string, mtimeMs = 1): PoFile => ({
  path: `/dav/Apps/Books/.Moon+/Cache/${bookFile}.po`,
  bookFile,
  text: '1*1@0#1:1%',
  mtimeMs,
});

describe('poForDocument', () => {
  const files = [po('Dune.epub'), po('Project Hail Mary - Andy Weir.epub'), po('Scan.pdf')];

  it("finds the file by KOSync's file-name digest", () => {
    expect(poForDocument(fileNameDigest('Dune.epub'), null, files)?.bookFile).toBe('Dune.epub');
    expect(fileNameDigest('/mnt/onboard/Books/Dune.epub')).toBe(fileNameDigest('Dune.epub'));
  });

  it("finds it by the device's file name, whatever its extensions", () => {
    expect(poForDocument('abc', { file: 'dune.kepub.epub' }, files)?.bookFile).toBe('Dune.epub');
  });

  it('finds it by title, with an author in the file name', () => {
    expect(
      poForDocument('abc', { file: 'phm.epub', title: 'Project Hail Mary' }, files)?.bookFile,
    ).toBe('Project Hail Mary - Andy Weir.epub');
  });

  it('prefers the newest copy and skips PDFs', () => {
    const two = [po('Dune.epub', 1), { ...po('Dune.epub', 5), path: '/dav/other/Dune.epub.po' }];
    expect(poForDocument(fileNameDigest('Dune.epub'), null, two)?.path).toBe(
      '/dav/other/Dune.epub.po',
    );
    expect(poForDocument(fileNameDigest('Scan.pdf'), { file: 'Scan.pdf' }, files)).toBeNull();
  });

  it('matches nothing when a title names two books', () => {
    const twins = [po('Dracula - Bram Stoker.epub'), po('Dracula - Matt Kindt.epub')];
    expect(poForDocument('abc', { title: 'Dracula' }, twins)).toBeNull();
    expect(poForDocument('abc', { title: 'Dracula' }, twins.slice(0, 1))?.bookFile).toBe(
      'Dracula - Bram Stoker.epub',
    );
  });

  it('does not take a longer title for a shorter one', () => {
    expect(poForDocument('abc', { title: 'Dune' }, [po('Dune Messiah.epub')])).toBeNull();
  });

  it("doesn't take another format's file, or write by title", () => {
    expect(poForDocument('abc', { file: 'Dune.epub' }, [po('Dune.mobi')])).toBeNull();
    expect(ownPoFile('abc', { title: 'Dune' }, files)).toBeNull();
    expect(ownPoFile('abc', { file: 'DUNE.epub' }, files)?.bookFile).toBe('Dune.epub');
  });

  it('goes by the linked book only when it points to one file name', () => {
    const copies = [po('Dune A.epub'), po('Dune B.epub')];
    const hint = { file: 'x.epub', linked: ['Dune A.epub', 'Dune B.epub'] };
    expect(ownPoFile('abc', { ...hint, linked: ['Dune B.epub'] }, copies)?.bookFile).toBe(
      'Dune B.epub',
    );
    expect(ownPoFile('abc', hint, copies)).toBeNull();
  });
});

describe('keys', () => {
  it('ignore case, accents, punctuation and extensions', () => {
    expect(fileKey('Les Misérables.kepub.epub')).toBe('les miserables');
    expect(matchKey('The Hobbit!')).toBe('hobbit');
  });
});
