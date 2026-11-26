/**
 * Search links: the admin's own "look this book up on…" links, shown on book pages, the
 * to-read pile and What to read next. Each is a URL template; the page fills in the book.
 * Kept in settings.json under `search_links`. Nothing is fetched by the server: these are
 * plain links the reader follows.
 *
 * Placeholders, each URL-encoded: {query} (title and author), {title}, {author}, {isbn}.
 */

export const SEARCH_LINKS_SECTION = 'search_links';
export const MAX_LINKS = 12;
const MAX_NAME = 40;
const MAX_URL = 500;
export const PLACEHOLDERS = ['{query}', '{title}', '{author}', '{isbn}'] as const;

export interface SearchLink {
  name: string;
  /** An http(s) address with at least one placeholder. */
  url: string;
  /** Shown to visitors too; otherwise only to the admin. */
  visitors: boolean;
}

export class SearchLinkError extends Error {}

/** Checks what the admin sent (PUT { links: [...] }). Throws a SearchLinkError to show. */
export function toSearchLinks(raw: unknown): SearchLink[] {
  const body = raw && typeof raw === 'object' ? (raw as { links?: unknown }) : {};
  if (!Array.isArray(body.links)) throw new SearchLinkError('Send { "links": [...] }.');
  if (body.links.length > MAX_LINKS) throw new SearchLinkError(`At most ${MAX_LINKS} links.`);
  const names = new Set<string>();
  return body.links.map((l, i) => {
    const o = l && typeof l === 'object' ? (l as Record<string, unknown>) : {};
    const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim() : '';
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    const which = name ? `“${name}”` : `Link ${i + 1}`;
    if (!name) throw new SearchLinkError(`${which} needs a name.`);
    if (name.length > MAX_NAME) throw new SearchLinkError(`${which}: the name is too long.`);
    if (names.has(name.toLowerCase())) throw new SearchLinkError(`Two links are called ${which}.`);
    names.add(name.toLowerCase());
    if (url.length > MAX_URL) throw new SearchLinkError(`${which}: the address is too long.`);
    let parsed: URL;
    try {
      // the placeholders aren't valid in every part of a URL, so check a filled-in copy
      parsed = new URL(fillTemplate(url, { title: 't', author: 'a', isbn: '1' }));
    } catch {
      throw new SearchLinkError(`${which}: that isn't a web address.`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new SearchLinkError(`${which}: the address must start with https:// or http://.`);
    }
    if (!PLACEHOLDERS.some((p) => url.includes(p))) {
      throw new SearchLinkError(
        `${which}: put {query}, {title}, {author} or {isbn} where the book goes.`,
      );
    }
    return { name, url, visitors: o.visitors === true };
  });
}

/** Reads the saved section leniently: anything malformed is left out. */
export function readSearchLinks(raw: unknown): SearchLink[] {
  if (!Array.isArray(raw)) return [];
  const out: SearchLink[] = [];
  for (const l of raw) {
    try {
      out.push(...toSearchLinks({ links: [l] }));
    } catch {
      // skip it
    }
  }
  return out.slice(0, MAX_LINKS);
}

/** The links a viewer gets: all of them for the admin, the visitors' ones for anyone else. */
export function linksFor(links: SearchLink[], admin: boolean): SearchLink[] {
  return admin ? links : links.filter((l) => l.visitors);
}

/** A template with a book filled in (the page does the same in web/features/search-links.js). */
export function fillTemplate(
  url: string,
  book: { title?: string | null; author?: string | null; isbn?: string | null },
): string {
  const title = (book.title ?? '').trim();
  const author = (book.author ?? '').split(/\s*(?:&|,| and )\s*/)[0].trim();
  const values: Record<string, string> = {
    '{query}': [title, author].filter(Boolean).join(' '),
    '{title}': title,
    '{author}': author,
    '{isbn}': (book.isbn ?? '').trim(),
  };
  return url.replace(/\{(query|title|author|isbn)\}/g, (m) => encodeURIComponent(values[m]));
}
