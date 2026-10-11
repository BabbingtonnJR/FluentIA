// Japanese text analysis shared by the content build scripts (Node) and the app (browser), so
// stories, comics and imported subtitles get the same breakdown: furigana markup
// ([漢字|かん|じ]), every word's dictionary form, part of speech, conjugation and link to the word
// list, and the grammar points the app teaches. No Node or DOM APIs here; the caller brings the
// kuromoji tokenizer.

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

// The same in context for the dictionary form, which picks the word-list entry: 雨が降り(そう) is
// 降る (fall), not 降りる (get off).
const BASE_FIXES = [{ surface: /^降り$/, when: /[雨雪]/, base: '降る' }];

export function fixedToken(token, sentence) {
  const fix = BASE_FIXES.find((f) => f.surface.test(token.surface_form) && f.when.test(sentence));
  return fix ? { ...token, basic_form: fix.base } : token;
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

// --- Sentence breakdown -------------------------------------------------------------

/** Plain text plus the explicit ruby spans: 狐《きつね》 and ｜十米《メートル》 (｜ marks where the base starts). */
export function splitRuby(marked) {
  let plain = '';
  const spans = [];
  const re = /(?:｜([^｜《]+)|([\p{Script=Han}々〆ヶ]+))《([^》]+)》/gu;
  let last = 0;
  for (const m of marked.matchAll(re)) {
    plain += marked.slice(last, m.index).replace(/｜/g, '');
    const base = m[1] ?? m[2];
    spans.push({ start: plain.length, end: plain.length + base.length, reading: m[3] });
    plain += base;
    last = m.index + m[0].length;
  }
  plain += marked.slice(last).replace(/｜/g, '');
  return { plain, spans };
}

const POS = {
  名詞: (t) =>
    ({ 代名詞: 'pron', 固有名詞: 'name', 数: 'num', 形容動詞語幹: 'adj-na', サ変接続: 'noun-suru', 非自立: 'noun-dep', 接尾: 'suffix' })[t.pos_detail_1] ?? 'noun',
  動詞: (t) => (['非自立', '接尾'].includes(t.pos_detail_1) ? 'verb-aux' : 'verb'),
  形容詞: (t) => (t.pos_detail_1 === '非自立' ? 'adj-aux' : 'adj-i'),
  副詞: () => 'adv',
  連体詞: () => 'prenoun',
  接続詞: () => 'conj',
  感動詞: () => 'interj',
  助動詞: () => 'aux',
  助詞: (t) =>
    ({ 格助詞: 'p-case', 係助詞: 'p-topic', 副助詞: 'p-adv', 接続助詞: 'p-conj', 終助詞: 'p-end', 連体化: 'p-no', 並立助詞: 'p-list', 副詞化: 'p-adv', '副助詞／並立助詞／終助詞': 'p-adv' })[
      t.pos_detail_1
    ] ?? 'p',
  記号: () => 'sym',
  接頭詞: () => 'prefix',
  フィラー: () => 'filler',
};
const FORM = {
  基本形: 'dict',
  音便基本形: 'dict',
  連用形: 'stem',
  連用ゴザイ接続: 'stem',
  連用ニ接続: 'stem',
  連用タ接続: 'ta',
  連用テ接続: 'te',
  未然形: 'nai',
  未然ヌ接続: 'nai',
  未然レル接続: 'nai',
  未然ウ接続: 'vol',
  仮定形: 'ba',
  仮定縮約１: 'ba',
  命令ｅ: 'imp',
  命令ｒｏ: 'imp',
  命令ｙｏ: 'imp',
  命令ｉ: 'imp',
  体言接続: 'attr',
  ガル接続: 'garu',
};

/**
 * Furigana markup and word breakdown for one sentence. Each word is
 * [surface, dictionary form (if different), part of speech, reading (if it has kanji), vocab index or -1, form],
 * with empty trailing fields dropped.
 */
export function analyse(marked, tokenizer, lookup, matchers) {
  const { plain, spans } = splitRuby(marked);
  const tokens = tokenizer.tokenize(plain);
  let markup = '';
  let cursor = 0;
  let pos = 0;
  const bounds = new Set([0]);
  const words = [];
  for (const raw of tokens) {
    const t = fixedToken(raw, plain);
    const a = pos;
    const b = pos + t.surface_form.length;
    pos = b;
    bounds.add(b);
    const explicit = spans.filter((s) => s.start < b && s.end > a);
    const reading = fixedReading(t, plain);

    // Furigana: explicit spans win, and the text they cover may run past this token.
    if (b > cursor) {
      const from = Math.max(a, cursor);
      if (explicit.length) {
        let c = from;
        while (c < b) {
          const s = spans.find((x) => x.start === c);
          if (s) {
            markup += `[${plain.slice(s.start, s.end)}|${s.reading}]`;
            c = s.end;
          } else markup += plain[c++];
        }
        cursor = c;
      } else {
        markup += from === a ? tokenRuby(t.surface_form, reading) : plain.slice(from, b);
        cursor = b;
      }
    }

    const p = POS[t.pos]?.(t) ?? 'other';
    if (p === 'sym') {
      words.push([t.surface_form, '', 'sym']);
      continue;
    }
    // The author's reading beats the dictionary's when the word is exactly one ruby span.
    const own = explicit.length === 1 && explicit[0].start === a && explicit[0].end === b ? explicit[0].reading : null;
    const kana = hasKanji(t.surface_form) ? (own ?? (reading && reading !== '*' ? toHiragana(reading) : '')) : '';
    // Grammar words are looked up too where the word list has them (できる, こと, ある), but not
    // particles, auxiliaries, helper verbs (ている) or suffixes, which would match unrelated words by sound (は → 歯, さん → 三).
    const linkable = !isFunctionToken(t) || t.pos === '感動詞' || (t.pos === '動詞' && t.pos_detail_1 !== '非自立') || (t.pos === '名詞' && ['代名詞', '非自立'].includes(t.pos_detail_1));
    const idx = linkable ? lookup(t) : undefined;
    const base = t.basic_form === '*' ? t.surface_form : t.basic_form;
    const word = [t.surface_form, base === t.surface_form ? '' : base, p, kana, idx ?? -1, FORM[t.conjugated_form] ?? ''];
    while (word.length > 3 && (word.at(-1) === '' || word.at(-1) === -1)) word.pop();
    words.push(word);
  }

  const grammar = [];
  for (const { id, re } of matchers) {
    const span = grammarSpan(re, plain, bounds);
    if (span) grammar.push([id, ...span]);
  }
  const s = { r: markup, w: words };
  if (grammar.length) s.g = grammar;
  return s;
}
