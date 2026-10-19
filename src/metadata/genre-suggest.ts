/**
 * Suggests a genre and subgenre for a book, in the owner's own words: the genre/subgenre
 * names already used in catalogue.json. Two kinds of evidence, strongest first:
 *
 * 1. Other books in the same series, or by the same author, that are already tagged.
 * 2. The book's Open Library subjects, through a keyword map onto common genre names, each
 *    matched against the catalogue's names (falling back to the map's own name only when
 *    nothing in the catalogue fits).
 *
 * Everything here is pure, so it's easy to test and to reason about.
 */

export const UNTAGGED = 'Untagged';

/** A genre/subgenre pair and how many tagged books use it. */
export interface VocabEntry {
  genre: string;
  subgenre: string;
  count: number;
}

export interface TaggedBook {
  title: string;
  author: string;
  series: string | null;
  genre: string;
  subgenre: string;
}

export type SuggestionBasis = 'series' | 'author' | 'subjects';

export interface GenreSuggestion {
  genre: string;
  subgenre: string;
  basis: SuggestionBasis;
  /** How sure: "high" (series, or many matching subjects), "medium" or "low". */
  confidence: 'high' | 'medium' | 'low';
  /** For basis "subjects": the subjects that led to it. */
  subjects: string[];
  /** For basis "series"/"author": a few of the tagged books it follows. */
  like: string[];
}

/** Lower-case letters and digits only: "Sci-Fi" and "sci fi" are the same name. */
const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');

/** The distinct genre/subgenre pairs of the tagged books, most used first. */
export function vocabulary(books: { genre: string; subgenre: string }[]): VocabEntry[] {
  const pairs = new Map<string, VocabEntry>();
  for (const b of books) {
    if (!b.genre || b.genre === UNTAGGED) continue;
    const subgenre = b.subgenre && b.subgenre !== UNTAGGED ? b.subgenre : '';
    const k = `${b.genre}\u0000${subgenre}`;
    const e = pairs.get(k) ?? { genre: b.genre, subgenre, count: 0 };
    e.count++;
    pairs.set(k, e);
  }
  return [...pairs.values()].sort(
    (a, b) =>
      b.count - a.count || a.genre.localeCompare(b.genre) || a.subgenre.localeCompare(b.subgenre),
  );
}

// ---------- 1. series and author ----------

/** The most used pair among some books, and its share of them. */
function commonest(books: TaggedBook[]): { genre: string; subgenre: string; share: number } {
  const [top] = vocabulary(books);
  return { genre: top.genre, subgenre: top.subgenre, share: top.count / books.length };
}

const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && key(a) === key(b) && key(a) !== '' && key(a) !== 'unknown';

/**
 * What the book's series or author is already tagged as. A series counts when at least half
 * its tagged books agree; an author only when two thirds of theirs share a genre (authors
 * change genre more often than series do).
 */
export function suggestFromPeers(
  book: { author: string; series: string | null },
  tagged: TaggedBook[],
): GenreSuggestion | null {
  const like = (books: TaggedBook[], genre: string, subgenre: string) =>
    books
      .filter((b) => b.genre === genre && b.subgenre === subgenre)
      .map((b) => b.title)
      .slice(0, 3);
  tagged = tagged.filter((b) => b.genre && b.genre !== UNTAGGED);
  const inSeries = tagged.filter((b) => sameName(b.series, book.series));
  if (inSeries.length) {
    const top = commonest(inSeries);
    if (top.share >= 0.5) {
      return {
        genre: top.genre,
        subgenre: top.subgenre,
        basis: 'series',
        confidence: 'high',
        subjects: [],
        like: like(inSeries, top.genre, top.subgenre),
      };
    }
  }
  const byAuthor = tagged.filter((b) => sameName(b.author, book.author));
  if (byAuthor.length) {
    const genres = new Map<string, number>();
    for (const b of byAuthor) genres.set(b.genre, (genres.get(b.genre) ?? 0) + 1);
    const [genre, n] = [...genres].sort((a, b) => b[1] - a[1])[0];
    if (n / byAuthor.length >= 2 / 3) {
      const top = commonest(byAuthor.filter((b) => b.genre === genre));
      return {
        genre,
        subgenre: top.subgenre,
        basis: 'author',
        confidence: byAuthor.length >= 3 && n === byAuthor.length ? 'high' : 'medium',
        subjects: [],
        like: like(byAuthor, genre, top.subgenre),
      };
    }
  }
  return null;
}

// ---------- 2. Open Library subjects ----------

interface Rule {
  /** Matched against each subject, lower-cased with "&" as "and". */
  match: RegExp;
  /** Genre names to look for in the catalogue, in order; the first is the fallback. */
  genre?: string[];
  /** How much a matching subject counts towards that genre. */
  weight?: number;
  /** Subgenre names, the same way (only used under that genre, or one the catalogue pairs it with). */
  sub?: string[];
  /** Counts only for books that aren't fiction (a history of Rome, not historical fiction). */
  nonFiction?: true;
}

const SF = ['Science Fiction', 'Sci-Fi', 'SF', 'Speculative Fiction'];
const FANTASY = ['Fantasy'];
const HORROR = ['Horror'];
const THRILLER = ['Thriller', 'Thrillers', 'Thriller and Suspense', 'Suspense'];
const CRIME = ['Crime', 'Mystery', 'Crime Fiction', 'Mystery and Crime', ...THRILLER];
const NON_FICTION = ['Non-fiction', 'Nonfiction'];
const LITERARY = ['Literary Fiction', 'Fiction', 'Literature', 'Classics'];
export const YOUNG_ADULT = ['Young Adult', 'YA'];

/** The keyword map: common Open Library subjects onto common genre and subgenre names. */
export const RULES: Rule[] = [
  // science fiction
  { match: /science fiction|\bsci-?fi\b|speculative fiction/, genre: SF, weight: 2 },
  {
    match:
      /interplanetary|interstellar|outer space|space (flight|travel|ships?|colonies|stations?)|starships?|life on other planets|extraterrestrial|\baliens?\b|robots?\b|androids?\b|artificial intelligence|cloning/,
    genre: SF,
    weight: 1,
  },
  {
    match: /space opera|galactic (empire|federation)s?/,
    genre: SF,
    weight: 2,
    sub: ['Space Opera'],
  },
  {
    match: /military (science fiction|sf|sci-?fi)|space warfare|interstellar (war|conflict)/,
    genre: SF,
    weight: 2,
    sub: ['Military SF', 'Military Science Fiction', 'Military Sci-Fi'],
  },
  {
    match: /hard science fiction|science fiction, hard/,
    genre: SF,
    weight: 2,
    sub: ['Hard SF', 'Hard Science Fiction'],
  },
  {
    match: /cyberpunk|virtual reality|computer hackers|cyberspace/,
    genre: SF,
    weight: 1,
    sub: ['Cyberpunk'],
  },
  { match: /steampunk/, genre: SF, weight: 2, sub: ['Steampunk'] },
  { match: /time travel|time machines/, genre: SF, weight: 1, sub: ['Time Travel'] },
  { match: /time loops?/, sub: ['Time Loop'] },
  {
    match: /alternative histor|alternate histor/,
    genre: SF,
    weight: 1,
    sub: ['Alternate History'],
  },
  { match: /first contact|human-alien encounters/, genre: SF, weight: 2, sub: ['First Contact'] },
  {
    match: /alien invasion|invasion of (the )?earth|extraterrestrial invasion/,
    genre: SF,
    weight: 2,
    sub: ['Alien Invasion'],
  },
  { match: /\bmars \(planet\)|\bmars\b/, genre: SF, weight: 1, sub: ['Mars'] },
  {
    match: /generation ships?|multigenerational (ships|voyages)/,
    genre: SF,
    weight: 2,
    sub: ['Generation Ship'],
  },
  {
    match: /parallel (universes|worlds)|alternate (universes|worlds)/,
    genre: SF,
    weight: 1,
    sub: ['Parallel Worlds', 'Multiverse'],
  },
  { match: /multiverse/, genre: SF, weight: 1, sub: ['Multiverse', 'Parallel Worlds'] },
  { match: /superhero/, genre: SF, weight: 1, sub: ['Superhero', 'Superheroes'] },
  { match: /star wars/, genre: SF, weight: 3, sub: ['Star Wars'] },
  { match: /warhammer/, genre: SF, weight: 3, sub: ['Warhammer 40k', 'Warhammer'] },
  { match: /near future/, genre: SF, weight: 1, sub: ['Near Future'] },
  { match: /new weird/, sub: ['New Weird'] },
  {
    match: /humou?rous (fiction|stories)|\bhumou?r\b/,
    sub: ['Comic SF', 'Comic Fantasy', 'Humour', 'Humor'],
  },
  {
    match: /post-?apocalyptic|end of the world|nuclear warfare|regression \(civilization\)/,
    genre: SF,
    weight: 1,
    sub: ['Post-Apocalyptic'],
  },
  { match: /dystopia|totalitarianism/, genre: SF, weight: 1, sub: ['Dystopian', 'Dystopia'] },
  { match: /pandemics|epidemics|virus diseases/, sub: ['Post-Apocalyptic', 'Medical Thriller'] },
  { match: /philosoph/, sub: ['Philosophical SF'] },
  // fantasy
  {
    match:
      /fantasy|\bmagic\b|magicians|wizards|sorcer|witches|dragons|elves|imaginary (places|wars)|\bquests?\b/,
    genre: FANTASY,
    weight: 2,
  },
  {
    match: /epic fantasy|high fantasy|fantasy, epic/,
    genre: FANTASY,
    weight: 2,
    sub: ['Epic Fantasy', 'High Fantasy'],
  },
  { match: /dark fantasy|fantasy, dark/, genre: FANTASY, weight: 2, sub: ['Dark Fantasy'] },
  { match: /grimdark/, genre: FANTASY, weight: 2, sub: ['Grimdark'] },
  {
    match: /urban fantasy|fantasy, urban|fantasy, paranormal/,
    genre: FANTASY,
    weight: 2,
    sub: ['Urban Fantasy'],
  },
  {
    match: /historical fantasy|fantasy, historical/,
    genre: FANTASY,
    weight: 2,
    sub: ['Historical Fantasy'],
  },
  {
    match: /romantic fantasy|romantasy|romance, fantasy|romance, paranormal/,
    genre: FANTASY,
    weight: 1,
    sub: ['Romantic Fantasy'],
  },
  {
    match: /fairy tales|fairy-tale|folklore/,
    genre: FANTASY,
    weight: 1,
    sub: ['Fairy-tale Fantasy', 'Fairy Tale'],
  },
  { match: /portal fantasy|portals|other worlds/, sub: ['Portal Fantasy'] },
  { match: /flintlock|gunpowder fantasy/, genre: FANTASY, weight: 2, sub: ['Flintlock Fantasy'] },
  {
    match: /sword and sorcery/,
    genre: FANTASY,
    weight: 2,
    sub: ['Sword and Sorcery', 'Sword & Sorcery'],
  },
  {
    match: /heists?\b|thieves|robbery|robberies|swindlers|capers?\b/,
    sub: ['Heist Fantasy', 'Heist'],
  },
  // LitRPG
  {
    match: /litrpg|gamelit|progression fantasy|role-?playing games/,
    genre: ['LitRPG', 'GameLit'],
    weight: 4,
    sub: ['LitRPG', 'GameLit'],
  },
  // horror
  {
    match: /horror|ghost stories|haunted|vampires|werewolves|monsters|occult/,
    genre: HORROR,
    weight: 2,
  },
  {
    match: /supernatural|paranormal|\bghosts?\b|haunted/,
    genre: HORROR,
    weight: 1,
    sub: ['Supernatural'],
  },
  { match: /zombies/, genre: HORROR, weight: 2, sub: ['Zombie', 'Zombies'] },
  {
    match: /psychological (fiction|horror|thriller|suspense)/,
    sub: ['Psychological', 'Psychological Thriller'],
  },
  { match: /short stories|anthologies/, sub: ['Short Story', 'Short Stories'] },
  // thrillers and crime
  {
    match: /thriller|suspense|espionage|spy stories|spies|conspiracies|terrorism/,
    genre: THRILLER,
    weight: 2,
  },
  {
    match: /techno-?thriller|thrillers, technological|thrillers, techno/,
    genre: THRILLER,
    weight: 1,
    sub: ['Techno-thriller', 'Technothriller'],
  },
  {
    match: /detective|mystery|mysteries|crime|murder|police|criminals|private investigators/,
    genre: CRIME,
    weight: 2,
    sub: ['Crime', 'Mystery', 'Detective'],
  },
  // romance
  {
    match: /romance|love stories/,
    genre: ['Romance'],
    weight: 2,
    sub: ['Romance', 'Contemporary Romance'],
  },
  // young adult (see suggestFromSubjects: it adds "YA" to the book's other genre)
  {
    match: /young adult|juvenile fiction|teenagers|adolescence|high schools/,
    genre: YOUNG_ADULT,
    weight: 1,
  },
  // literary fiction and classics
  {
    match:
      /literary fiction|fiction, literary|psychological fiction|domestic fiction|bildungsromans/,
    genre: LITERARY,
    weight: 1,
    sub: ['Literary', 'Contemporary'],
  },
  { match: /magic(al)? realism/, genre: LITERARY, weight: 2, sub: ['Magical Realism'] },
  {
    match: /\bclassics?\b|classic literature/,
    genre: ['Classics', 'Literary Fiction'],
    weight: 1,
    sub: ['Literary', 'Classic'],
  },
  {
    match: /children's (stories|literature|fiction)|picture books/,
    genre: ['Classics', "Children's", ...LITERARY],
    weight: 1,
    sub: ["Children's Classic", "Children's"],
  },
  // non-fiction
  {
    match: /biography|autobiograph|memoirs?\b|diaries|correspondence/,
    genre: ['Biography', 'Memoir', ...NON_FICTION],
    weight: 2,
    sub: ['Biography', 'Memoir'],
    nonFiction: true,
  },
  {
    match: /^history\b|\bhistory$|, history|historiography|world war|civilization$/,
    genre: ['History', ...NON_FICTION],
    weight: 2,
    sub: ['History'],
    nonFiction: true,
  },
  {
    match:
      /business|management|entrepreneurship|leadership|economics|marketing|personal finance|investments/,
    genre: NON_FICTION,
    weight: 2,
    sub: ['Business'],
    nonFiction: true,
  },
  {
    match:
      /computer programming|programming languages|software engineering|computer software|computer science|algorithms|javascript|python \(computer/,
    genre: NON_FICTION,
    weight: 2,
    sub: ['Programming', 'Computing'],
    nonFiction: true,
  },
  {
    match: /psychology|self-help|habit|cognition|happiness|motivation \(psychology\)/,
    genre: NON_FICTION,
    weight: 2,
    sub: ['Psychology', 'Self-help'],
    nonFiction: true,
  },
  {
    match: /\bdesign\b|typography|user interfaces|graphic arts/,
    genre: NON_FICTION,
    weight: 2,
    sub: ['Design'],
    nonFiction: true,
  },
  {
    match: /popular works|physics|astronomy|biology|evolution|mathematics|cosmology|neuroscience/,
    genre: NON_FICTION,
    weight: 1,
    sub: ['Science', 'Popular Science'],
    nonFiction: true,
  },
  {
    match: /^philosophy|, philosophy$/,
    genre: NON_FICTION,
    weight: 1,
    sub: ['Philosophy'],
    nonFiction: true,
  },
];

/** Subjects that say the book is a story. */
const FICTION = /fiction|novel|stories|tales\b|fantasy|thriller|romance|horror/;

const normalise = (subject: string) =>
  subject.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();

/** The catalogue's name for one of a rule's names (by key), or null. */
function inCatalogue(names: string[], have: string[]): string | null {
  for (const name of names) {
    const found = have.find((h) => key(h) === key(name));
    if (found) return found;
  }
  return null;
}

/**
 * A genre and subgenre from Open Library subjects, in the catalogue's words. Null when no
 * subject says anything about genre.
 */
export function suggestFromSubjects(
  subjects: string[],
  vocab: VocabEntry[],
): GenreSuggestion | null {
  const genres = [...new Set(vocab.map((v) => v.genre))];
  const subsOf = (genre: string) =>
    vocab.filter((v) => v.genre === genre && v.subgenre).map((v) => v.subgenre);
  const allSubs = [...new Set(vocab.filter((v) => v.subgenre).map((v) => v.subgenre))];
  const resolveGenre = (names: string[]) => inCatalogue(names, genres) ?? names[0];
  const subjectsNorm = subjects.map(normalise);
  const fiction = subjectsNorm.some((s) => FICTION.test(s));

  interface Hit {
    rule: Rule;
    genre: string | null;
    subject: string;
    weight: number;
  }
  const hits: Hit[] = [];
  subjectsNorm.forEach((s, i) => {
    for (const rule of RULES) {
      if (!rule.match.test(s)) continue;
      if (rule.nonFiction && fiction) continue;
      hits.push({
        rule,
        genre: rule.genre ? resolveGenre(rule.genre) : null,
        subject: subjects[i],
        weight: rule.weight ?? 0,
      });
    }
  });

  // each rule counts at most three times, so twenty "Science fiction, American" don't swamp
  const score = new Map<string, number>();
  const counted = new Map<Rule, number>();
  for (const hit of hits) {
    if (!hit.genre || !hit.weight) continue;
    const n = counted.get(hit.rule) ?? 0;
    if (n >= 3) continue;
    counted.set(hit.rule, n + 1);
    score.set(hit.genre, (score.get(hit.genre) ?? 0) + hit.weight);
  }
  const ya = inCatalogue(YOUNG_ADULT, genres);
  const yaScore = ya ? (score.get(ya) ?? 0) : 0;
  if (ya) score.delete(ya);
  if (!ya) score.delete(YOUNG_ADULT[0]);
  // the best genre; the catalogue's most used one breaks ties
  const rank = (g: string) => {
    const i = genres.indexOf(g);
    return i < 0 ? genres.length : i;
  };
  const best = [...score].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))[0];
  if (!best && !yaScore) return null;
  const genre = best?.[0] ?? ya!;
  const total = best?.[1] ?? yaScore;

  // the subgenre: a matched rule's subgenre the catalogue uses under this genre, else the
  // first subgenre of a rule that belongs to this genre, else the genre's own name
  const subScore = new Map<string, number>();
  const subHits: Hit[] = [];
  for (const hit of hits) {
    if (!hit.rule.sub) continue;
    const found = inCatalogue(hit.rule.sub, subsOf(genre));
    const name = found ?? (hit.genre === genre ? hit.rule.sub[0] : null);
    if (!name) continue;
    // a subgenre the owner already uses counts double
    subScore.set(name, (subScore.get(name) ?? 0) + (found ? 2 : 1) + hit.weight);
    subHits.push(hit);
  }
  const bestSub = [...subScore].sort(
    (a, b) => b[1] - a[1] || allSubs.indexOf(a[0]) - allSubs.indexOf(b[0]),
  )[0]?.[0];
  let subgenre = bestSub ?? inCatalogue([genre], subsOf(genre)) ?? genre;
  let finalGenre = genre;

  // young adult: when the owner files YA as its own genre, it becomes "YA <what it is>"
  if (ya && yaScore) {
    const isSf = SF.some((n) => key(n) === key(genre));
    const kind = best
      ? isSf
        ? ['YA Sci-Fi', 'YA Science Fiction', 'YA SF']
        : [`YA ${genre}`]
      : [];
    const names = [...(bestSub ? [`YA ${bestSub}`] : []), ...kind, 'YA Contemporary'];
    finalGenre = ya;
    subgenre = inCatalogue(names, subsOf(ya)) ?? (kind[0] || 'YA Contemporary');
  }

  const used = new Set(
    hits
      .filter((h) => h.genre === genre || (ya && h.genre === ya) || subHits.includes(h))
      .map((h) => h.subject),
  );
  const strength = total + yaScore;
  return {
    genre: finalGenre,
    subgenre,
    basis: 'subjects',
    confidence: strength >= 5 ? 'high' : strength >= 3 ? 'medium' : 'low',
    subjects: subjects.filter((s) => used.has(s)).slice(0, 8),
    like: [],
  };
}

/** Series first, then author, then subjects. */
export function suggestGenre(
  book: { author: string; series: string | null },
  subjects: string[],
  tagged: TaggedBook[],
  vocab: VocabEntry[] = vocabulary(tagged),
): GenreSuggestion | null {
  return suggestFromPeers(book, tagged) ?? suggestFromSubjects(subjects, vocab);
}
