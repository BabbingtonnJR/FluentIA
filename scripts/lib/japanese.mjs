// Japanese text helpers shared by the content build scripts: the kuromoji tokenizer, furigana
// markup ([漢字|かん|じ]) and matching tokens to the pack's vocabulary.
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import kuromoji from 'kuromoji';

export async function createTokenizer() {
  const require = createRequire(import.meta.url);
  const dicPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
  return new Promise((resolve, reject) => kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t))));
}

export const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const isKana = (s) => /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(s);
export const hasKanji = (s) => /\p{Script=Han}/u.test(s);
export const plainText = (markup) => markup.replace(/\[([^|\]]+)\|[^\]]*\]/g, '$1');

// --- Furigana ------------------------------------------------------------------

/** Furigana markup for one token: kana around the kanji is left outside the brackets (降っ → [降|ふ]っ). */
export function tokenRuby(surface, readingKatakana) {
  if (!hasKanji(surface) || !readingKatakana || readingKatakana === '*') return surface;
  const s = [...surface];
  const r = [...toHiragana(readingKatakana)];
  let head = '';
  let tail = '';
  while (s.length > 1 && r.length > 1 && !hasKanji(s.at(-1)) && toHiragana(s.at(-1)) === r.at(-1)) {
    tail = s.pop() + tail;
    r.pop();
  }
  while (s.length > 1 && r.length > 1 && !hasKanji(s[0]) && toHiragana(s[0]) === r[0]) {
    head += s.shift();
    r.shift();
  }
  return `${head}[${s.join('')}|${r.join('')}]${tail}`;
}

// IPADIC picks the wrong reading for a few common words; fix them in context (katakana readings).
const READING_FIXES = [
  { surface: /^日本(人|語)?$/, reading: (s) => s.replace('日本', 'ニホン').replace('人', 'ジン').replace('語', 'ゴ') },
  { surface: /^間$/, reading: () => 'アイダ' }, // standalone 間 in 〜間に / 長い間 (間に合う is one token)
  { surface: /^辛$/, reading: () => 'カラ' },
  { surface: /^降り/, when: /[雨雪]/, reading: (s) => s.replace('降', 'フ').replace('り', 'リ') },
  { surface: /^開[きいくけ]/, reading: (s) => `ア${[...s].slice(1).join('')}` }, // 開く (open, intransitive) — 開かれる stays ひら
];

export function fixedReading(token, sentence) {
  const fix = READING_FIXES.find((f) => f.surface.test(token.surface_form) && (!f.when || f.when.test(sentence)));
  return fix ? fix.reading(token.surface_form) : token.reading;
}

/** Furigana markup for a whole sentence, plus the character offsets where tokens start and end. */
export function annotate(tokenizer, text) {
  const tokens = tokenizer.tokenize(text);
  const bounds = new Set([0]);
  let pos = 0;
  let markup = '';
  for (const t of tokens) {
    markup += tokenRuby(t.surface_form, fixedReading(t, text));
    pos += t.surface_form.length;
    bounds.add(pos);
  }
  return { markup, bounds, tokens };
}

// --- Vocabulary lookup ---------------------------------------------------------
// Tokens are matched by dictionary form; words usually written in kana (分かる → わかる)
// fall back to matching the reading, preferring kana-only entries, then the easiest level.

// e-row → u-row, to turn potential verbs back into their dictionary form (行ける → 行く).
const E_TO_U = { け: 'く', げ: 'ぐ', せ: 'す', て: 'つ', ね: 'ぬ', べ: 'ぶ', め: 'む', れ: 'る', え: 'う' };
// i-row → u-row, for nouns made from a verb stem (願い → 願う).
const I_TO_U = { き: 'く', ぎ: 'ぐ', し: 'す', ち: 'つ', に: 'ぬ', び: 'ぶ', み: 'む', り: 'る', い: 'う' };
// いる / ある are listed under kanji, which the reading alone can't pick (いる is also 要る).
const ALIASES = { いる: '居る', ある: '在る', 出来る: 'できる', 子ども: '子供', 有る: 'ある', 下さい: 'ください', 解る: '分かる', 判る: '分かる' };

/** Forms a dictionary word may be listed under, most specific first. */
function variants(base) {
  const out = [base];
  if (ALIASES[base]) out.push(ALIASES[base]);
  if (/^[御ごお]/.test(base) && base.length > 1) out.push(base.slice(1), `御${base.slice(1)}`, `ご${base.slice(1)}`, `お${base.slice(1)}`);
  if (base.endsWith('々')) out.push(base.slice(0, -1));
  if (base.endsWith('に')) out.push(base.slice(0, -1));
  else out.push(`${base}に`);
  if (base.endsWith('く')) out.push(`${base.slice(0, -1)}い`); // 多く → 多い
  if (base.endsWith('す')) out.push(`${base}る`); // 愛す → 愛する
  // Stem guesses are only safe with a kanji anchor; on kana words they hit unrelated entries.
  if (/\p{Script=Han}/u.test(base)) {
    const last = base.at(-1);
    if (base.endsWith('る') && E_TO_U[base.at(-2)]) out.push(base.slice(0, -2) + E_TO_U[base.at(-2)]);
    if (I_TO_U[last]) out.push(base.slice(0, -1) + I_TO_U[last]);
    out.push(`${base}る`); // 助け → 助ける
  }
  return out;
}

/** Returns lookup(token) → vocab index or undefined. */
export function vocabLookup(vocab) {
  const byWord = new Map();
  const byReading = new Map();
  const bySkeleton = new Map();
  const splitForms = (s) => s.split(/[、,;・]/).map((x) => x.trim()).filter(Boolean);
  // Okurigana varies (終る / 終わる): kanji plus the final kana identifies a word well enough.
  const skeleton = (w) => (/\p{Script=Han}/u.test(w) ? w.replace(/[\p{Script=Hiragana}]+(?=\p{Script=Han})|[\p{Script=Hiragana}]+(?=[\p{Script=Hiragana}]$)/gu, '') : null);
  vocab.forEach((v, i) => {
    for (const form of splitForms(v.word)) {
      if (!byWord.has(form)) byWord.set(form, i);
      const sk = skeleton(form);
      if (sk && !bySkeleton.has(sk)) bySkeleton.set(sk, i);
    }
    for (const reading of splitForms(v.reading)) {
      const r = toHiragana(reading);
      const prev = byReading.get(r);
      const better = prev === undefined || (isKana(v.word) && !isKana(vocab[prev].word)) || (isKana(v.word) === isKana(vocab[prev].word) && v.level > vocab[prev].level);
      if (better) byReading.set(r, i);
    }
  });

  return function lookup(token) {
    for (const form of [...variants(token.basic_form), token.surface_form]) {
      if (byWord.has(form)) return byWord.get(form);
      if (isKana(form) && form.length > 1 && byReading.has(toHiragana(form))) return byReading.get(toHiragana(form));
    }
    // Okurigana variant: also require the reading to start the same, so 上がる never links to 上る (のぼる).
    const sk = skeleton(token.basic_form);
    const idx = sk ? bySkeleton.get(sk) : undefined;
    if (idx !== undefined && token.reading && toHiragana(vocab[idx].reading).startsWith(toHiragana(token.reading).slice(0, 2))) return idx;
    return undefined;
  };
}

/** Grammar glue and names do not need to be in the word list. */
export function isFunctionToken(t) {
  if (['助詞', '助動詞', '記号', 'フィラー', '接頭詞', '感動詞'].includes(t.pos)) return true;
  if (['非自立', '接尾', '代名詞', '数', '固有名詞'].includes(t.pos_detail_1)) return true;
  // Light verbs and copula-like words used as grammar.
  return ['する', 'ある', 'いる', 'なる', 'できる', 'くる', '来る', 'いう', 'ない', 'よう', 'こと', 'もの', 'の', 'そう', 'これ', 'それ', 'あれ', 'どれ', 'ここ', 'そこ', 'あそこ', 'どこ', 'しれる'].includes(t.basic_form);
}

// --- Grammar ---------------------------------------------------------------------

/** Grammar point source files, easiest level first, then file order (teaching order). */
export async function grammarFiles(srcDir) {
  return (await readdir(srcDir)).filter((f) => /^n\d[a-z]?\.json$/.test(f)).sort((a, b) => Number(b[1]) - Number(a[1]) || a.localeCompare(b));
}

/** The grammar points that have a `match` regex, as { id, re }, with ids as in grammar.json. */
export async function grammarMatchers(srcDir) {
  const out = [];
  for (const f of await grammarFiles(srcDir)) {
    const level = Number(f[1]);
    for (const p of JSON.parse(await readFile(path.join(srcDir, f), 'utf8'))) {
      if (p.match) out.push({ id: `n${level}-${p.id}`, re: new RegExp(p.match, 'u') });
    }
  }
  return out;
}

/**
 * Where a grammar regex matches a sentence, as [start, end] of the capture group (or whole match),
 * only if it lines up with token boundaries, so ても never matches inside とても.
 */
export function grammarSpan(re, plain, bounds) {
  const m = re.exec(plain);
  if (!m) return null;
  const text = m[1] ?? m[0];
  const start = m.index + m[0].indexOf(text);
  const end = start + text.length;
  return bounds.has(start) && bounds.has(end) ? [start, end] : null;
}
