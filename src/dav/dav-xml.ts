import type { Stats } from 'node:fs';

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Percent-encodes a path like Python's urllib.parse.quote: everything but A-Z a-z 0-9 _.-~/ */
export function quotePath(path: string): string {
  return Array.from(Buffer.from(path, 'utf8'))
    .map((b) => {
      const c = String.fromCharCode(b);
      return /[A-Za-z0-9_.\-~/]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.zip': 'application/zip',
};

export function contentType(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot >= 0 && TYPES[name.slice(dot).toLowerCase()]) || 'application/octet-stream';
}

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n';

/** One <D:response> of a PROPFIND answer. */
export function propEntry(href: string, name: string, st: Stats): string {
  const props = [
    `<D:displayname>${xmlEscape(name)}</D:displayname>`,
    `<D:getlastmodified>${st.mtime.toUTCString()}</D:getlastmodified>`,
    `<D:creationdate>${st.mtime.toISOString().replace(/\.\d{3}Z$/, 'Z')}</D:creationdate>`,
  ];
  if (st.isDirectory()) {
    props.push('<D:resourcetype><D:collection/></D:resourcetype>');
  } else {
    props.push(
      '<D:resourcetype/>',
      `<D:getcontentlength>${st.size}</D:getcontentlength>`,
      `<D:getcontenttype>${contentType(name)}</D:getcontenttype>`,
      `<D:getetag>"${Math.floor(st.mtimeMs).toString(16)}-${st.size.toString(16)}"</D:getetag>`,
    );
  }
  return (
    `<D:response><D:href>${xmlEscape(href)}</D:href><D:propstat><D:prop>` +
    props.join('') +
    '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
  );
}

export function multistatus(responses: string[]): string {
  return `${XML_HEAD}<D:multistatus xmlns:D="DAV:">${responses.join('')}</D:multistatus>`;
}

/** PROPPATCH: we keep no dead properties, but say yes so clients carry on. */
export function proppatchOk(href: string): string {
  return multistatus([
    `<D:response><D:href>${xmlEscape(href)}</D:href><D:propstat><D:prop/>` +
      '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>',
  ]);
}

/** LOCK: a fake exclusive lock, enough for clients that insist on locking before writing. */
export function lockGranted(token: string): string {
  return (
    `${XML_HEAD}<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>` +
    '<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth>' +
    `<D:timeout>Second-3600</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken>` +
    '</D:activelock></D:lockdiscovery></D:prop>'
  );
}
