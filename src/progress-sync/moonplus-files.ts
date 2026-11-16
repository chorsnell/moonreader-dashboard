import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { titleFromFileName } from '../backup-import/reading-history';

/** A .po file Moon+ synced (or the dashboard wrote) in the WebDAV folder. */
export interface PoFile {
  /** Its path on disk. */
  path: string;
  /** The book's file name: the .po file's name without ".po". */
  bookFile: string;
  text: string;
  mtimeMs: number;
}

/** What is known about a KOSync document: the device's file name and title, when known. */
export interface DocumentHint {
  file?: string | null;
  title?: string | null;
}

/** KOSync's "file name" document id: the MD5 of the book's file name. */
export const fileNameDigest = (fileName: string) =>
  createHash('md5').update(basename(fileName), 'utf8').digest('hex');

const BOOK_EXTENSIONS = /\.(kepub|epub|azw3?|mobi|fb2|zip|txt|html?|docx?|rtf)$/i;

/** A file name for matching: lower case, without extensions, accents or punctuation. */
export function fileKey(fileName: string): string {
  let name = basename(fileName);
  while (BOOK_EXTENSIONS.test(name)) name = name.replace(BOOK_EXTENSIONS, '');
  return matchKey(name);
}

/** A title for matching: lower case, no accents or punctuation, no leading article. */
export function matchKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

/** Shorter titles than this only match a file name exactly ("It" shouldn't match "It Ends…"). */
const MIN_PARTIAL_TITLE = 6;

/** Moon+ syncs positions of reflowable books; PDFs and comics keep page numbers elsewhere. */
export const isReflowable = (fileName: string) =>
  /\.(epub|fb2|txt|html?|mobi|azw3?|docx?|rtf)$/i.test(fileName);

/**
 * The .po file for a KOSync document, newest first when several match: by the MD5 of its
 * file name (KOSync's "file name" matching), then by the device's file name, then by title.
 */
export function poForDocument(
  document: string,
  hint: DocumentHint | null,
  files: PoFile[],
): PoFile | null {
  const candidates = files
    .filter((f) => isReflowable(f.bookFile))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const byDigest = candidates.find((f) => fileNameDigest(f.bookFile) === document);
  if (byDigest) return byDigest;
  if (hint?.file) {
    const want = fileKey(hint.file);
    const byFile = want && candidates.find((f) => fileKey(f.bookFile) === want);
    if (byFile) return byFile;
  }
  if (hint?.title) {
    const want = matchKey(hint.title);
    const titled = (f: PoFile) => {
      const key = matchKey(titleFromFileName(f.bookFile));
      // "Dune - Frank Herbert.epub": the title with an author before or after it
      return (
        key === want ||
        (want.length >= MIN_PARTIAL_TITLE &&
          (key.startsWith(`${want} `) || key.endsWith(` ${want}`)))
      );
    };
    const byTitle = want ? candidates.filter(titled) : [];
    // a title that names two different books is no match
    if (new Set(byTitle.map((f) => fileKey(f.bookFile))).size === 1) return byTitle[0];
  }
  return null;
}
