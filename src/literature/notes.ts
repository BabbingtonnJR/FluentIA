import type { LitWord } from '../content/types';

/** Part-of-speech keys written by build-literature.mjs, in plain English. */
export const POS_LABEL: Record<string, string> = {
  noun: 'noun',
  'noun-suru': 'noun (can take する)',
  'noun-dep': 'formal noun',
  pron: 'pronoun',
  name: 'name',
  num: 'number',
  suffix: 'suffix',
  prefix: 'prefix',
  'adj-na': 'na-adjective',
  'adj-i': 'i-adjective',
  'adj-aux': 'helper adjective',
  verb: 'verb',
  'verb-aux': 'helper verb',
  adv: 'adverb',
  prenoun: 'pre-noun adjectival',
  conj: 'conjunction',
  interj: 'interjection',
  aux: 'auxiliary',
  'p-case': 'case particle',
  'p-topic': 'binding particle',
  'p-adv': 'adverbial particle',
  'p-conj': 'conjunctive particle',
  'p-end': 'sentence-ending particle',
  'p-no': 'particle',
  'p-list': 'listing particle',
  p: 'particle',
  filler: 'filler',
  sym: 'punctuation',
  other: 'other',
};

/** Conjugation keys: which form the word is in, and what usually follows it. */
export const FORM_LABEL: Record<string, string> = {
  dict: 'dictionary form',
  stem: 'masu-stem (連用形)',
  ta: 'stem before た / て',
  te: 'stem before て',
  nai: 'nai-stem (未然形)',
  vol: 'volitional stem (〜う / よう)',
  ba: 'conditional (〜ば)',
  imp: 'command form',
  attr: 'before a noun',
  garu: 'stem before がる',
};

// Particles do different jobs; these are the usual ones, keyed by the particle itself.
const PARTICLE: Record<string, string> = {
  は: 'topic: "as for …"',
  が: 'subject; or "but" between clauses',
  を: 'direct object; or the place moved through',
  に: 'target, time, place where something is, or the doer of a passive',
  で: 'place of an action, means, or cause',
  へ: 'direction: "towards"',
  と: '"and" / "with"; or quotes what is said or thought',
  も: '"also" / "even"',
  の: 'links nouns ("\'s", "of"); or turns a clause into a noun',
  から: '"from"; or "because" after a clause',
  まで: '"until" / "as far as"',
  より: '"than"; or "from"',
  や: 'lists examples: "… and … (among others)"',
  か: 'question; or "or"',
  ね: 'seeks agreement: "isn\'t it?"',
  よ: 'tells the listener something: "you know"',
  な: 'emphasis or "don\'t" (after a verb); or a feeling to oneself',
  わ: 'soft emphasis',
  さ: 'casual emphasis',
  ぞ: 'strong emphasis',
  ので: '"because" (explaining)',
  のに: '"although", with surprise or regret',
  けれど: '"but" / "although"',
  けれども: '"but" / "although"',
  けど: '"but" (casual)',
  が_conj: '"but"',
  て: 'joins actions: "and then", "and"',
  で_conj: 'joins actions (after ん / ぶ / む verbs): "and then"',
  ば: 'condition: "if"',
  ながら: '"while" doing two things at once',
  たり: 'lists actions: "things like … and …"',
  し: 'lists reasons: "and also"',
  ても: '"even if"',
  でも: '"even"; or "but"',
  ばかり: '"only" / "just"',
  だけ: '"only"',
  しか: '"only" (with a negative verb)',
  ほど: '"to the extent"; "about"',
  くらい: '"about" / "to the extent"',
  ぐらい: '"about" / "to the extent"',
  など: '"and so on"',
  なんか: '"things like" (casual)',
  って: 'casual quote: "that …", "called …"',
  かしら: 'wondering: "I wonder" (soft)',
  とも: '"of course"; or "both"',
  さえ: '"even"',
  こそ: 'emphasis: "precisely"',
};

// Auxiliaries, keyed by dictionary form.
const AUX: Record<string, string> = {
  た: 'past tense, or a finished action',
  だ: 'copula: "is"',
  です: 'polite copula: "is"',
  ます: 'polite verb ending',
  ない: 'negative: "not"',
  ぬ: 'negative (old or written style)',
  ん: 'negative (short for ぬ / ない)',
  れる: 'passive, potential, or respectful',
  られる: 'passive, potential, or respectful',
  せる: 'causative: "make / let someone do"',
  させる: 'causative: "make / let someone do"',
  たい: 'wanting: "want to"',
  たがる: 'someone else wants to',
  う: 'volitional: "let\'s" / "I will"; or a guess',
  よう: 'volitional: "let\'s" / "I will"; or a guess',
  まい: 'negative will or guess: "won\'t"',
  らしい: '"seems" (from what one hears)',
  そうだ: '"looks like" or "I hear that"',
  ようだ: '"seems" / "like"',
  べし: '"should" (written style)',
  たり: 'listing actions',
  ござる: 'very polite "to be"',
};

/** A one-line explanation of what a grammar word does, if there is one. */
export function wordNote(w: LitWord): string | null {
  const [surface, base, pos = ''] = w;
  if (pos === 'aux') return AUX[base || surface] ?? null;
  if (pos.startsWith('p')) {
    if (pos === 'p-conj' && (surface === 'が' || surface === 'で')) return PARTICLE[`${surface}_conj`];
    return PARTICLE[surface] ?? null;
  }
  if (pos === 'verb-aux') {
    const helper: Record<string, string> = {
      いる: 'after て: an ongoing action or a resulting state',
      しまう: 'after て: finished completely, or regret',
      ある: 'after て: left in a state on purpose',
      おく: 'after て: done in advance',
      くる: 'after て: change coming towards now, or "go and come back"',
      いく: 'after て: change going on from now',
      みる: 'after て: "try doing"',
      くれる: 'after て: someone does it for me',
      もらう: 'after て: I get someone to do it',
      やる: 'after て: do it for someone (casual)',
      あげる: 'after て: do it for someone',
    };
    return helper[base || surface] ?? null;
  }
  if (pos === 'noun-dep') {
    const formal: Record<string, string> = {
      の: 'turns the clause before it into a noun; のだ explains',
      こと: 'turns the clause before it into a noun: "the act of"',
      もの: '"thing"; or a general truth',
      よう: '"the way" / "like"',
      ところ: '"the point (in time)" / "place"',
      はず: '"should be" (expectation)',
      わけ: '"reason" / "it means that"',
      ため: '"for the sake of" / "because of"',
      まま: '"as it is", unchanged',
    };
    return formal[base || surface] ?? null;
  }
  return null;
}
