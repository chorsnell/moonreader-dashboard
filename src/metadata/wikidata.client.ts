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

  /** Requests are spaced COVER_PAUSE apart, to be polite. */
  private async api(q: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
    const wait = this.last + this.config.coverPauseMs - Date.now();
    if (wait > 0) await sleep(wait, undefined, { signal });
    this.last = Date.now();
    const body = await httpGet(`${this.config.wikidataUrl}/w/api.php?${q}`, signal);
    return JSON.parse(body.toString('utf8'));
  }
}
