import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
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

/** What is known about a KOSync document. */
export interface DocumentHint {
  /** The device's file name. */
  file?: string | null;
  title?: string | null;
  /** The file names of the dashboard book the file is linked to. */
  linked?: string[];
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

/** Moon+ syncs positions of reflowable books; PDFs and comics keep page numbers elsewhere. */
export const isReflowable = (fileName: string) =>
  /\.(epub|fb2|txt|html?|mobi|azw3?|docx?|rtf)$/i.test(fileName);

/** The same file name, whatever its case and however its accents are encoded. */
const sameName = (a: string, b: string) =>
  basename(a).normalize('NFC').toLowerCase() === basename(b).normalize('NFC').toLowerCase();

/** Another format's positions mean nothing in this file. */
const sameFormat = (a: string, b: string) => extname(a).toLowerCase() === extname(b).toLowerCase();

/**
 * The .po file that is certainly this document's, newest first when several match: by the MD5
 * of its file name (KOSync's "file name" matching), then by the device's file name, then by
 * the names of the dashboard book it's linked to (when they point to one name only). This is
 * the only file a KOReader position is written over.
 */
export function ownPoFile(
  document: string,
  hint: DocumentHint | null,
  files: PoFile[],
): PoFile | null {
  const candidates = newestFirst(files);
  const byDigest = candidates.find((f) => fileNameDigest(f.bookFile) === document);
  if (byDigest) return byDigest;
  const file = hint?.file;
  if (file) {
    const exact = candidates.find((f) => sameName(f.bookFile, file));
    if (exact) return exact;
    const want = fileKey(file);
    const close =
      want && candidates.find((f) => sameFormat(f.bookFile, file) && fileKey(f.bookFile) === want);
    if (close) return close;
  }
  const linked = candidates.filter(
    (f) =>
      (!file || sameFormat(f.bookFile, file)) &&
      hint?.linked?.some((name) => sameName(name, f.bookFile)),
  );
  return linked.length && linked.every((f) => sameName(f.bookFile, linked[0].bookFile))
    ? linked[0]
    : null;
}

/**
 * The .po file to read a document's Moon+ position from: its own, or else one named after the
 * title, alone or with an author before or after it ("Dune - Frank Herbert.epub"). A title is
 * too weak to write over a file by.
 */
export function poForDocument(
  document: string,
  hint: DocumentHint | null,
  files: PoFile[],
): PoFile | null {
  const own = ownPoFile(document, hint, files);
  if (own) return own;
  const want = hint?.title ? matchKey(hint.title) : '';
  if (!want) return null;
  const titled = newestFirst(files).filter((f) => {
    if (hint?.file && !sameFormat(f.bookFile, hint.file)) return false;
    const name = titleFromFileName(f.bookFile);
    return [name, ...name.split(/\s+-\s+/)].some((part) => matchKey(part) === want);
  });
  // a title that names two different books is no match
  return new Set(titled.map((f) => fileKey(f.bookFile))).size === 1 ? titled[0] : null;
}

const newestFirst = (files: PoFile[]) =>
  files.filter((f) => isReflowable(f.bookFile)).sort((a, b) => b.mtimeMs - a.mtimeMs);
