import { fileName, REREADS } from './demo-books';
import { Random } from './random';
import type { DemoDay } from './simulate';

/** [how far into the book (%), the passage, an optional note of the reader's own]. */
type Quote = [at: number, text: string, note?: string];

/** Passages from the demo books (all public domain), roughly where they come in each. */
export const QUOTES: Record<string, [author: string, quotes: Quote[]]> = {
  'The Time Machine': [
    'H. G. Wells',
    [
      [
        2,
        'There is no difference between Time and any of the three dimensions of Space except that our consciousness moves along it.',
      ],
      [
        84,
        'It is a law of nature we overlook, that intellectual versatility is the compensation for change, danger, and trouble.',
      ],
      [85, 'Nature never appeals to intelligence until habit and instinct are useless.'],
    ],
  ],
  'The War of the Worlds': [
    'H. G. Wells',
    [
      [
        1,
        'No one would have believed in the last years of the nineteenth century that this world was being watched keenly and closely by intelligences greater than man’s and yet as mortal as his own.',
        'What an opening.',
      ],
      [
        1.5,
        'Yet across the gulf of space, minds that are to our minds as ours are to those of the beasts that perish, intellects vast and cool and unsympathetic, regarded this earth with envious eyes, and slowly and surely drew their plans against us.',
      ],
      [
        96,
        'Slain, after all man’s devices had failed, by the humblest things that God, in his wisdom, has put upon this earth.',
      ],
    ],
  ],
  'Twenty Thousand Leagues Under the Seas': [
    'Jules Verne',
    [[12, 'The sea is everything. It covers seven tenths of the terrestrial globe.']],
  ],
  'A Study in Scarlet': [
    'Arthur Conan Doyle',
    [
      [
        24,
        'It is a capital mistake to theorize before you have all the evidence. It biases the judgment.',
      ],
      [
        34,
        'There’s the scarlet thread of murder running through the colourless skein of life, and our duty is to unravel it, and isolate it, and expose every inch of it.',
        'So that’s the title.',
      ],
    ],
  ],
  'The Sign of the Four': [
    'Arthur Conan Doyle',
    [
      [
        2,
        'My mind rebels at stagnation. Give me problems, give me work, give me the most abstruse cryptogram, or the most intricate analysis, and I am in my own proper atmosphere.',
      ],
      [
        45,
        'How often have I said to you that when you have eliminated the impossible, whatever remains, however improbable, must be the truth?',
      ],
    ],
  ],
  'The Adventures of Sherlock Holmes': [
    'Arthur Conan Doyle',
    [
      [0.5, 'To Sherlock Holmes she is always the woman.'],
      [3, 'You see, but you do not observe. The distinction is clear.'],
      [
        24,
        'It has long been an axiom of mine that the little things are infinitely the most important.',
      ],
    ],
  ],
  'The Hound of the Baskervilles': [
    'Arthur Conan Doyle',
    [
      [10, 'Mr. Holmes, they were the footprints of a gigantic hound!', 'Chills.'],
      [26, 'The world is full of obvious things which nobody by any chance ever observes.'],
    ],
  ],
  'Pride and Prejudice': [
    'Jane Austen',
    [
      [
        0.3,
        'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
      ],
      [9, 'I could easily forgive his pride, if he had not mortified mine.'],
      [
        18,
        'I declare after all there is no enjoyment like reading!',
        'Miss Bingley, of all people.',
      ],
      [
        55,
        'In vain have I struggled. It will not do. My feelings will not be repressed. You must allow me to tell you how ardently I admire and love you.',
      ],
      [61, 'Till this moment I never knew myself.'],
    ],
  ],
  Emma: [
    'Jane Austen',
    [
      [12, 'One half of the world cannot understand the pleasures of the other.'],
      [
        34,
        'Silly things do cease to be silly if they are done by sensible people in an impudent way.',
      ],
      [86, 'If I loved you less, I might be able to talk about it more.'],
    ],
  ],
  Persuasion: [
    'Jane Austen',
    [
      [
        90,
        'All the privilege I claim for my own sex (it is not a very enviable one; you need not covet it), is that of loving longest, when existence or when hope is gone.',
      ],
      [92, 'You pierce my soul. I am half agony, half hope.', 'The letter!'],
    ],
  ],
  'Jane Eyre': [
    'Charlotte Brontë',
    [
      [
        55,
        'I am no bird; and no net ensnares me: I am a free human being with an independent will, which I now exert to leave you.',
      ],
      [70, 'I would always rather be happy than dignified.'],
      [98, 'Reader, I married him.'],
    ],
  ],
  'Wuthering Heights': [
    'Emily Brontë',
    [
      [
        25,
        'I have dreamt in my life, dreams that have stayed with me ever after, and changed my ideas; they have gone through and through me, like wine through water, and altered the colour of my mind.',
      ],
      [26, 'Whatever our souls are made of, his and mine are the same.'],
    ],
  ],
  'Great Expectations': [
    'Charles Dickens',
    [
      [
        10,
        'In a word, I was too cowardly to do what I knew to be right, as I had been too cowardly to avoid doing what I knew to be wrong.',
      ],
      [
        20,
        'Heaven knows we need never be ashamed of our tears, for they are rain upon the blinding dust of earth, overlying our hard hearts.',
      ],
      [
        99,
        'Suffering has been stronger than all other teaching, and has taught me to understand what your heart used to be.',
      ],
    ],
  ],
  'A Tale of Two Cities': [
    'Charles Dickens',
    [
      [
        0.1,
        'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.',
      ],
      [
        99.6,
        'It is a far, far better thing that I do, than I have ever done; it is a far, far better rest that I go to than I have ever known.',
      ],
    ],
  ],
  'A Christmas Carol': [
    'Charles Dickens',
    [
      [22, 'Mankind was my business. The common welfare was my business.'],
      [82, 'I will honour Christmas in my heart, and try to keep it all the year.'],
    ],
  ],
  Middlemarch: [
    'George Eliot',
    [
      [
        20,
        'If we had a keen vision and feeling of all ordinary human life, it would be like hearing the grass grow and the squirrel’s heart beat, and we should die of that roar which lies on the other side of silence.',
        'Beautiful, even if the book is slow going.',
      ],
    ],
  ],
  'Moby-Dick': [
    'Herman Melville',
    [
      [0.1, 'Call me Ishmael.'],
      [
        0.3,
        'Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; then, I account it high time to get to sea as soon as I can.',
      ],
      [20, 'I know not all that may be coming, but be it what it will, I’ll go to it laughing.'],
    ],
  ],
  'The Great Gatsby': [
    'F. Scott Fitzgerald',
    [
      [
        0.5,
        'Whenever you feel like criticizing any one, just remember that all the people in this world haven’t had the advantages that you’ve had.',
      ],
      [99.8, 'So we beat on, boats against the current, borne back ceaselessly into the past.'],
    ],
  ],
  'Little Women': [
    'Louisa May Alcott',
    [[50, 'I’m not afraid of storms, for I’m learning how to sail my ship.']],
  ],
  'The Picture of Dorian Gray': [
    'Oscar Wilde',
    [
      [
        3,
        'There is only one thing in the world worse than being talked about, and that is not being talked about.',
      ],
      [10, 'The only way to get rid of a temptation is to yield to it.', 'Lord Henry, honestly.'],
    ],
  ],
  'Anna Karenina': [
    'Leo Tolstoy',
    [[0.1, 'Happy families are all alike; every unhappy family is unhappy in its own way.']],
  ],
  'Crime and Punishment': [
    'Fyodor Dostoevsky',
    [[45, 'Pain and suffering are always inevitable for a large intelligence and a deep heart.']],
  ],
  'Treasure Island': [
    'Robert Louis Stevenson',
    [[2, 'Fifteen men on the dead man’s chest— Yo-ho-ho, and a bottle of rum!']],
  ],
  'The Three Musketeers': [
    'Alexandre Dumas',
    [[11, 'All for one, one for all, that is our device.']],
  ],
  'The Call of the Wild': [
    'Jack London',
    [[55, 'There is an ecstasy that marks the summit of life, and beyond which life cannot rise.']],
  ],
  'The Wonderful Wizard of Oz': ['L. Frank Baum', [[10, 'There is no place like home.']]],
  'Through the Looking-Glass': [
    'Lewis Carroll',
    [
      [48, 'It’s a poor sort of memory that only works backwards.'],
      [50, 'Why, sometimes I’ve believed as many as six impossible things before breakfast.'],
    ],
  ],
  'Peter Pan': [
    'J. M. Barrie',
    [
      [0.1, 'All children, except one, grow up.'],
      [60, 'To die will be an awfully big adventure.'],
    ],
  ],
  Frankenstein: [
    'Mary Shelley',
    [
      [40, 'I was benevolent and good; misery made me a fiend.'],
      [72, 'Beware; for I am fearless, and therefore powerful.'],
    ],
  ],
  Dracula: [
    'Bram Stoker',
    [[5, 'Listen to them, the children of the night. What music they make!', 'Brr.']],
  ],
  'Strange Case of Dr Jekyll and Mr Hyde': [
    'Robert Louis Stevenson',
    [[86, 'Man is not truly one, but truly two.']],
  ],
  Walden: [
    'Henry David Thoreau',
    [
      [3, 'The mass of men lead lives of quiet desperation.'],
      [
        20,
        'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.',
        'Re-read this one.',
      ],
    ],
  ],
  Meditations: [
    'Marcus Aurelius',
    [[70, 'Waste no more time arguing about what a good man should be. Be one.']],
  ],
};

/** Moon+'s highlight colours, as the signed ARGB integers it stores. */
const COLOURS = [0xffffff00, 0xff99cc66, 0xff66ccff, 0xffff9999].map((c) => c | 0);

/** A highlight, note or bookmark as Moon+ stores it, made on a day of the demo history. */
export interface DemoNote {
  day: number;
  /** Minutes after midnight, local time. */
  minute: number;
  chapter: number;
  position: number;
  colour: number;
  original: string;
  note: string;
  bookmark: string;
}

/**
 * When in the day a highlight is made: mostly in bed on weekdays, with some on the commute
 * and at lunch; spread through the afternoon and evening at weekends.
 */
function minuteOfDay(rng: Random, weekend: boolean): number {
  const slots = weekend
    ? [
        [10, 12, 2],
        [14, 18, 4],
        [20, 24, 4],
      ]
    : [
        [7, 9, 2],
        [12, 14, 1.5],
        [21, 24, 6],
        [0, 1, 0.5],
      ];
  const total = slots.reduce((s, [, , w]) => s + w, 0);
  let r = rng.random() * total;
  for (const [from, to, w] of slots) {
    if ((r -= w) <= 0) return Math.floor(rng.uniform(from * 60, to * 60));
  }
  return 22 * 60;
}

/**
 * Highlights for the simulated history: each passage is highlighted on the first day the
 * reader got that far (so abandoned books stop short), plus the odd bookmark. Uses its
 * own random numbers so the reading history stays the same for a seed.
 */
export function simulateHighlights(
  log: Map<string, DemoDay[]>,
  seed: number,
): Map<string, DemoNote[]> {
  const rng = new Random(seed + 101);
  const out = new Map<string, DemoNote[]>();
  for (const [title, [author, quotes]] of Object.entries(QUOTES)) {
    const entries = log.get(fileName(title, author));
    if (!entries) continue;
    const chapters = rng.randint(18, 40);
    const notes: DemoNote[] = [];
    const place = (
      at: number,
    ): Omit<DemoNote, 'colour' | 'original' | 'note' | 'bookmark'> | null => {
      const e = entries.find((d) => d.progress >= at);
      if (!e) return null;
      const weekend = (e.day + 3) % 7 >= 5;
      const where = (at / 100) * chapters;
      return {
        day: e.day,
        minute: minuteOfDay(rng, weekend),
        chapter: Math.min(chapters - 1, Math.floor(where)),
        position: Math.floor((where % 1) * 20000),
      };
    };
    for (const [at, text, note] of quotes) {
      const p = place(at);
      if (!p) continue;
      notes.push({
        ...p,
        colour: rng.pick(COLOURS),
        original: text,
        note: note ?? '',
        bookmark: '',
      });
    }
    // a bookmark or two in the longer reads
    if (rng.random() < 0.5) {
      const p = place(rng.uniform(30, 80));
      if (p) {
        notes.push({
          ...p,
          colour: 0,
          original: '',
          note: '',
          bookmark: `Chapter ${p.chapter + 1}`,
        });
      }
    }
    if (notes.length) out.set(fileName(title, author), notes);
  }
  rehighlight(log, out, seed);
  return out;
}

/**
 * On a re-read, some of the passages highlighted the first time are highlighted again (for
 * the Highlights tab's "passages you came back to"). Its own random numbers, so the
 * first-read highlights stay the same for a seed.
 */
function rehighlight(log: Map<string, DemoDay[]>, out: Map<string, DemoNote[]>, seed: number) {
  const rng = new Random(seed + 202);
  for (const title of REREADS) {
    const quotes = QUOTES[title];
    if (!quotes) continue;
    const file = fileName(title, quotes[0]);
    const entries = log.get(file);
    const notes = out.get(file);
    if (!entries || !notes) continue;
    // the second read starts where progress goes back down
    const i = entries.findIndex((d, k) => k > 0 && d.progress < entries[k - 1].progress);
    if (i < 0) continue;
    const again = entries.slice(i);
    for (const n of notes.filter((x) => x.original && rng.random() < 0.6)) {
      const at = (quotes[1].find(([, text]) => text === n.original) ?? [0])[0];
      const e = again.find((d) => d.progress >= at);
      if (!e) continue;
      const weekend = (e.day + 3) % 7 >= 5;
      notes.push({ ...n, day: e.day, minute: minuteOfDay(rng, weekend), note: '' });
    }
  }
}

/**
 * Moves one highlight onto the same date as `today` in an earlier year (the nearest year
 * whose book that day has a passage to move), so the Overview's "On this day" card has a
 * highlight to show in the demo. `firstDay` is the history's day 0, as days since 1970.
 */
export function anniversaryHighlight(
  log: Map<string, DemoDay[]>,
  notes: Map<string, DemoNote[]>,
  firstDay: number,
  today: string,
): void {
  const [y, md] = [+today.slice(0, 4), today.slice(5)];
  for (let back = 1; back <= 20; back++) {
    const date = `${y - back}-${md === '02-29' ? '02-28' : md}`;
    const day = Date.parse(date) / 86_400_000 - firstDay;
    if (day < 0) return;
    for (const [file, entries] of log) {
      if (!entries.some((e) => e.day === day && e.minutes > 0)) continue;
      const list = notes.get(file)?.filter((n) => !n.bookmark && n.original);
      if (!list?.length) continue;
      // the passage nearest that day, so it stays roughly where it comes in the book
      const n = list.reduce((a, b) => (Math.abs(b.day - day) < Math.abs(a.day - day) ? b : a));
      n.day = day;
      return;
    }
  }
}
