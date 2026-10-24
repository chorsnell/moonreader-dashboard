import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfigType } from '../config/app.config';
import { httpGet } from '../covers/open-library.client';
import type { Gender } from './metadata.types';

/** Wikidata properties used here. */
const P = {
  gender: 'P21',
  citizenship: 'P27',
  birthplace: 'P19',
  country: 'P17',
  iso2: 'P297',
  replacedBy: 'P1366',
  openLibrary: 'P648',
};

/** Values of "sex or gender" (P21). Anything else counts as other. */
const GENDERS: Record<string, Gender> = {
  Q6581097: 'male',
  Q6581072: 'female',
  Q2449503: 'male', // trans man
  Q1052281: 'female', // trans woman
  Q48270: 'non-binary',
  Q505371: 'non-binary', // agender
  Q12964198: 'non-binary', // genderqueer
  Q18116794: 'non-binary', // genderfluid
};

interface Snak {
  snaktype?: string;
  datavalue?: { value?: unknown };
}
interface Claim {
  mainsnak?: Snak;
  rank?: 'preferred' | 'normal' | 'deprecated';
}
export interface Entity {
  id?: string;
  claims?: Record<string, Claim[]>;
}

/** A property's values, preferred ones first and deprecated ones left out. */
export function claimValues(entity: Entity | undefined, prop: string): unknown[] {
  const claims = (entity?.claims?.[prop] ?? []).filter((c) => c.rank !== 'deprecated');
  claims.sort((a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'));
  return claims
    .filter((c) => c.mainsnak?.snaktype === 'value')
    .map((c) => c.mainsnak?.datavalue?.value);
}

/** Item values (Q ids) of a property. */
export function itemValues(entity: Entity | undefined, prop: string): string[] {
  return claimValues(entity, prop)
    .map((v) => (v as { id?: string } | undefined)?.id)
    .filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id));
}

const iso2 = (e: Entity | undefined) => {
  const v = claimValues(e, P.iso2).find((x) => typeof x === 'string' && /^[A-Z]{2}$/.test(x));
  return (v as string | undefined) ?? null;
};

/** A work Wikidata credits to an author (P50), with its series (P179) when it has one. */
export interface WikidataWork {
  /** The item, e.g. "Q170583". */
  id: string;
  /** Its English label. */
  title: string;
  /** The year of its earliest publication date (P577), or null. */
  year: number | null;
  /** The English label of the series it's part of, or null. */
  series: string | null;
  /** Its place in the series (the P1545 "series ordinal" qualifier) as a number, or null. */
  series_no: number | null;
}

interface SparqlBinding {
  [name: string]: { value?: string } | undefined;
}

/** A series ordinal ("3", "2.5") as a number; anything else ("III", "prequel") is null. */
const ordinal = (s: string | undefined) => {
  const t = (s ?? '').trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/**
 * The works in a SPARQL answer, one per item: its earliest year, and a series with an
 * ordinal when it has one. Items without an English label (the label service then gives
 * the Q id) are left out.
 */
export function parseAuthorWorks(body: unknown): WikidataWork[] {
  const rows = (body as { results?: { bindings?: unknown } } | null)?.results?.bindings;
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, WikidataWork>();
  for (const row of rows as SparqlBinding[]) {
    const id = /Q\d+$/.exec(row.work?.value ?? '')?.[0];
    const title = (row.workLabel?.value ?? '').trim();
    if (!id || !title || /^Q\d+$/.test(title)) continue;
    const y = /^([+-]?\d{1,4})-/.exec(row.date?.value ?? '')?.[1];
    const year = y ? Number(y) : null;
    const seriesLabel = (row.seriesLabel?.value ?? '').trim();
    const series = seriesLabel && !/^Q\d+$/.test(seriesLabel) ? seriesLabel : null;
    const no = ordinal(row.ordinal?.value);
    const had = byId.get(id);
    if (!had) {
      byId.set(id, { id, title, year, series, series_no: series ? no : null });
      continue;
    }
    if (year !== null && (had.year === null || year < had.year)) had.year = year;
    // a series with a number beats one without
    if (series && (!had.series || (had.series_no === null && no !== null))) {
      had.series = series;
      had.series_no = no;
    }
  }
  return [...byId.values()];
}

export interface AuthorFacts {
  gender: Gender | null;
  country: string | null;
}

/** Talks to Wikidata's API. Every method throws when it can't be reached. */
@Injectable()
export class WikidataClient {
  private last = 0;

  constructor(@Inject(appConfig.KEY) private readonly config: AppConfigType) {}

  /** The item whose Open Library id (P648) is this author key, or null. */
  async findByOpenLibrary(authorKey: string, signal?: AbortSignal): Promise<string | null> {
    const q = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: `haswbstatement:${P.openLibrary}=${authorKey}`,
      srlimit: '1',
      format: 'json',
    });
    const body = await this.api(q, signal);
    const title = (body as { query?: { search?: { title?: string }[] } }).query?.search?.[0]?.title;
    return title && /^Q\d+$/.test(title) ? title : null;
  }

  /**
   * An author's gender and country. The country is their citizenship when that's a country
   * with an ISO code; otherwise the country their birthplace is in today; otherwise what a
   * historical state of citizenship became (Kingdom of Great Britain -> United Kingdom).
   */
  async authorFacts(id: string, signal?: AbortSignal): Promise<AuthorFacts> {
    const author = (await this.entities([id], signal))[id];
    const g = itemValues(author, P.gender)[0];
    const gender = g ? (GENDERS[g] ?? 'other') : null;

    const citizenships = itemValues(author, P.citizenship).slice(0, 5);
    const states = await this.entities(citizenships, signal);
    let country = citizenships.map((c) => iso2(states[c])).find(Boolean) ?? null;
    if (!country) {
      const place = itemValues(author, P.birthplace)[0];
      if (place) {
        const where = itemValues((await this.entities([place], signal))[place], P.country)[0];
        if (where) country = iso2((await this.entities([where], signal))[where]);
      }
    }
    // historical states: follow "replaced by" a few steps
    for (let step = 0, ids = citizenships; !country && ids.length && step < 4; step++) {
      const next = [...new Set(ids.flatMap((c) => itemValues(states[c], P.replacedBy)))];
      Object.assign(states, await this.entities(next.slice(0, 10), signal));
      country = next.map((c) => iso2(states[c])).find(Boolean) ?? null;
      ids = next;
    }
    return { gender, country };
  }

  /**
   * The works Wikidata credits to an author (P50), with series, ordinal and publication date,
   * from its SPARQL endpoint. Editions (P629) and scholarly articles are left out.
   */
  async authorWorks(id: string, signal?: AbortSignal): Promise<WikidataWork[]> {
    if (!/^Q\d+$/.test(id)) return [];
    const query = `SELECT ?work ?workLabel ?seriesLabel ?ordinal ?date WHERE {
  ?work wdt:P50 wd:${id} .
  FILTER NOT EXISTS { ?work wdt:P629 ?edition_of }
  FILTER NOT EXISTS { ?work wdt:P31 wd:Q13442814 }
  OPTIONAL { ?work p:P179 ?statement . ?statement ps:P179 ?series .
    OPTIONAL { ?statement pq:P1545 ?ordinal } }
  OPTIONAL { ?work wdt:P577 ?date }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 1000`;
    const q = new URLSearchParams({ query, format: 'json' });
    await this.pace(signal);
    const body = await httpGet(`${this.config.wikidataSparqlUrl}/sparql?${q}`, signal);
    return parseAuthorWorks(JSON.parse(body.toString('utf8')));
  }

  /** Items by id, with their statements. */
  async entities(ids: string[], signal?: AbortSignal): Promise<Record<string, Entity>> {
    if (!ids.length) return {};
    const q = new URLSearchParams({
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'claims',
      format: 'json',
    });
    return ((await this.api(q, signal)) as { entities?: Record<string, Entity> }).entities ?? {};
  }

  /** Waits until COVER_PAUSE has passed since the last request. */
  private async pace(signal?: AbortSignal): Promise<void> {
    const wait = this.last + this.config.coverPauseMs - Date.now();
    if (wait > 0) await sleep(wait, undefined, { signal });
    this.last = Date.now();
  }

  /** Requests are spaced COVER_PAUSE apart, to be polite. */
  private async api(q: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
    await this.pace(signal);
    const body = await httpGet(`${this.config.wikidataUrl}/w/api.php?${q}`, signal);
    return JSON.parse(body.toString('utf8'));
  }
}
