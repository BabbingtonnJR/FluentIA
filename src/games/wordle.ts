import type { Pack, VocabItem } from '../content/types';
import { romajiToHiragana, toHiragana } from '../lang/romaji';
import { seededRandom } from '../reading/select';

export const WORD_LENGTH = 4;
export const MAX_GUESSES = 6;

/** hit: right kana, right place · near: in the word, elsewhere · miss: not in the word. */
export type Mark = 'hit' | 'near' | 'miss';

/** Splits a kana string into tiles; small kana (ゃ, っ) and ー are tiles of their own. */
export const tiles = (kana: string) => [...kana];

/** The reading as plain hiragana, or null if it can't be a puzzle word (mixed script, several readings). */
export function puzzleKana(v: VocabItem): string | null {
  if (/[;、,\s～~（(]/.test(v.reading)) return null;
  const kana = toHiragana(v.reading);
  return /^[ぁ-ゖー]+$/.test(kana) && !kana.startsWith('ー') ? kana : null;
}

export interface WordleWord {
  kana: string;
  item: VocabItem;
}

/** Puzzle words for one level, one per reading (the first word listed with it). */
export function wordleWords(pack: Pack, level: number, length = WORD_LENGTH): WordleWord[] {
  const seen = new Set<string>();
  const out: WordleWord[] = [];
  for (const item of pack.vocab) {
    if (item.level !== level) continue;
    const kana = puzzleKana(item);
    if (!kana || tiles(kana).length !== length || seen.has(kana)) continue;
    seen.add(kana);
    out.push({ kana, item });
  }
  return out;
}

/** Every reading of that length in the pack: guesses must be real words. */
export function validGuesses(pack: Pack, length = WORD_LENGTH): Set<string> {
  const out = new Set<string>();
  for (const item of pack.vocab) {
    const kana = puzzleKana(item);
    if (kana && tiles(kana).length === length) out.add(kana);
  }
  return out;
}

/** The same word for everyone on a given day and level. */
export function dailyWord(words: WordleWord[], day: string, level: number): WordleWord | undefined {
  if (!words.length) return undefined;
  return words[Math.floor(seededRandom(`wordle:${level}:${day}`)() * words.length)];
}

/** Wordle marking: exact hits first, then "near" only as many times as the kana is left over. */
export function scoreGuess(guess: string, target: string): Mark[] {
  const g = tiles(guess);
  const t = tiles(target);
  const marks: Mark[] = g.map(() => 'miss');
  const left = new Map<string, number>();
  g.forEach((k, i) => {
    if (k === t[i]) marks[i] = 'hit';
    else left.set(t[i], (left.get(t[i]) ?? 0) + 1);
  });
  g.forEach((k, i) => {
    if (marks[i] === 'hit') return;
    const n = left.get(k) ?? 0;
    if (n > 0) {
      marks[i] = 'near';
      left.set(k, n - 1);
    }
  });
  return marks;
}

const RANK: Record<Mark, number> = { miss: 0, near: 1, hit: 2 };

/** Best mark seen so far for each kana, to colour the keyboard. */
export function keyMarks(guesses: string[], target: string): Map<string, Mark> {
  const out = new Map<string, Mark>();
  for (const g of guesses) {
    scoreGuess(g, target).forEach((m, i) => {
      const k = tiles(g)[i];
      const prev = out.get(k);
      if (!prev || RANK[m] > RANK[prev]) out.set(k, m);
    });
  }
  return out;
}

/**
 * What is being typed: the kana so far plus unfinished romaji ("neko" → ねこ, "nek" → ね + "k").
 * A lone final n stays pending, since it may still become な, に…
 */
export function typingKana(typed: string): { kana: string; pending: string } {
  const lone = /(^|[^n])n$/i.test(typed);
  const body = lone ? typed.slice(0, -1) : typed;
  const converted = romajiToHiragana(body);
  const latin = converted.match(/[a-z'-]*$/i)?.[0] ?? '';
  return { kana: converted.slice(0, converted.length - latin.length), pending: latin + (lone ? 'n' : '') };
}

/** Score for XP: fewer guesses and hints score more; an unsolved puzzle scores nothing. */
export function wordleScore(solved: boolean, guesses: number, hints: number): number {
  return solved ? Math.max(1, MAX_GUESSES + 1 - guesses - hints) : 0;
}

const DAKUTEN = ['かきくけこさしすせそたちつてとはひふへほう', 'がぎぐげござじずぜぞだぢづでどばびぶべぼゔ'];
const HANDAKUTEN = ['はひふへほばびぶべぼ', 'ぱぴぷぺぽぱぴぷぺぽ'];
const SMALL_KANA = ['あいうえおやゆよつわ', 'ぁぃぅぇぉゃゅょっゎ'];

function swap(c: string, [plain, marked]: string[]): string {
  const i = plain.indexOf(c);
  if (i >= 0) return marked[i];
  const j = marked.indexOf(c);
  // Back to the plain kana, unless this map only adds marks (ぱ is not undone by ゛).
  return j >= 0 && plain[j] !== marked[j] ? plain[j] : c;
}

/**
 * Phone-keyboard modifiers for the last kana: ゛ toggles voicing (か ⇄ が), ゜ gives ぱ-row
 * sounds, 小 toggles small kana (つ ⇄ っ).
 */
export function modifyLast(kana: string, mod: '゛' | '゜' | '小'): string {
  const t = tiles(kana);
  const last = t.pop();
  if (!last) return kana;
  const map = mod === '゛' ? DAKUTEN : mod === '゜' ? HANDAKUTEN : SMALL_KANA;
  let next = swap(last, map);
  // ゜ on ぱ goes back to は.
  if (mod === '゜' && next === last) next = swap(last, ['はひふへほ', 'ぱぴぷぺぽ']);
  return [...t, next].join('');
}
