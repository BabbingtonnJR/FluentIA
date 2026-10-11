// Sentence breakdown shared by the literature and comics builds: furigana markup plus every word
// with its dictionary form, part of speech, conjugation and link to the word list, and the grammar
// points the app teaches found in the sentence.
import { fixedReading, grammarSpan, hasKanji, isFunctionToken, toHiragana, tokenRuby } from './japanese.mjs';

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
  for (const t of tokens) {
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
