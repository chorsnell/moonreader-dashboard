import { fileKey, fileNameDigest, matchKey, type PoFile, poForDocument } from './moonplus-files';

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
    const twins = [po('Dracula - Bram Stoker.epub'), po('Dracula Untold.epub')];
    expect(poForDocument('abc', { title: 'Dracula' }, twins)).toBeNull();
    expect(poForDocument('abc', { title: 'Dracula' }, twins.slice(0, 1))?.bookFile).toBe(
      'Dracula - Bram Stoker.epub',
    );
  });
});

describe('keys', () => {
  it('ignore case, accents, punctuation and extensions', () => {
    expect(fileKey('Les Misérables.kepub.epub')).toBe('les miserables');
    expect(matchKey('The Hobbit!')).toBe('hobbit');
  });
});
