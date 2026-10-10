// Builds the reading sentences for the Japanese pack from Tatoeba (CC BY 2.0 FR).
// Keeps only sentences whose every content word is in the pack's N5–N3 vocabulary,
// so each one is readable with what the app teaches, and links those words to vocab
// entries so the app can pick sentences made of words the learner already studied.
//
// Usage: node scripts/build-sentences.mjs <rawDir> <packDir>
//   rawDir/tatoeba/*.tsv.bz2 come from fetch-content.mjs; packDir must already hold vocab.json.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import kuromoji from 'kuromoji';
import Bunzip from 'seek-bzip';

const [rawDir, packDir] = process.argv.slice(2);
if (!rawDir || !packDir) {
  console.error('Usage: node scripts/build-sentences.mjs <rawDir> <packDir>');
  process.exit(1);
}

const MAX_SENTENCES = 12000;
const MIN_LEN = 4;
const MAX_LEN = 36;

async function tsv(name) {
  const buf = await readFile(path.join(rawDir, 'tatoeba', `${name}.tsv.bz2`));
  return Bunzip.decode(buf).toString('utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
}

const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const isKana = (s) => /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(s);

// --- Vocabulary lookup ---------------------------------------------------------
// Tokens are matched by dictionary form; words usually written in kana (分かる → わかる)
// fall back to matching the reading, preferring kana-only entries, then the easiest level.
const vocab = JSON.parse(await readFile(path.join(packDir, 'vocab.json'), 'utf8'));
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

// e-row → u-row, to turn potential verbs back into their dictionary form (行ける → 行く).
const E_TO_U = { け: 'く', げ: 'ぐ', せ: 'す', て: 'つ', ね: 'ぬ', べ: 'ぶ', め: 'む', れ: 'る', え: 'う' };
// i-row → u-row, for nouns made from a verb stem (願い → 願う).
const I_TO_U = { き: 'く', ぎ: 'ぐ', し: 'す', ち: 'つ', に: 'ぬ', び: 'ぶ', み: 'む', り: 'る', い: 'う' };
const ALIASES = { 出来る: 'できる', 子ども: '子供', 有る: 'ある', 下さい: 'ください', 解る: '分かる', 判る: '分かる' };

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

function lookup(token) {
  for (const form of [...variants(token.basic_form), token.surface_form]) {
    if (byWord.has(form)) return byWord.get(form);
    if (isKana(form) && form.length > 1 && byReading.has(toHiragana(form))) return byReading.get(toHiragana(form));
  }
  // Okurigana variant: also require the reading to start the same, so 上がる never links to 上る (のぼる).
  const sk = skeleton(token.basic_form);
  const idx = sk ? bySkeleton.get(sk) : undefined;
  if (idx !== undefined && token.reading && toHiragana(vocab[idx].reading).startsWith(toHiragana(token.reading).slice(0, 2))) return idx;
  return undefined;
}

/** Grammar glue and names do not need to be in the word list. */
function isFunctionToken(t) {
  if (['助詞', '助動詞', '記号', 'フィラー', '接頭詞', '感動詞'].includes(t.pos)) return true;
  if (['非自立', '接尾', '代名詞', '数', '固有名詞'].includes(t.pos_detail_1)) return true;
  // Light verbs and copula-like words used as grammar.
  return ['する', 'ある', 'いる', 'なる', 'できる', 'くる', '来る', 'いう', 'ない', 'よう', 'こと', 'もの', 'の', 'そう', 'これ', 'それ', 'あれ', 'どれ', 'ここ', 'そこ', 'あそこ', 'どこ', 'しれる'].includes(t.basic_form);
}

// --- Tatoeba -------------------------------------------------------------------
const links = new Map();
for (const [jpn, eng] of await tsv('jpn-eng_links')) {
  if (!links.has(jpn)) links.set(jpn, []);
  links.get(jpn).push(eng);
}

const furigana = new Map();
for (const [id, , script, user, text] of await tsv('jpn_transcriptions')) {
  if (script !== 'Hrkt' || !text) continue;
  const reviewed = !!user;
  const prev = furigana.get(id);
  if (!prev || (reviewed && !prev.reviewed)) furigana.set(id, { text, reviewed });
}

const candidates = [];
const seenText = new Set();
for (const [id, , text] of await tsv('jpn_sentences')) {
  if (!links.has(id) || !furigana.has(id)) continue;
  const t = text.trim();
  if (t.length < MIN_LEN || t.length > MAX_LEN || seenText.has(t)) continue;
  if (/[A-Za-zＡ-Ｚａ-ｚ0-9０-９「」『』]/.test(t)) continue; // skip romaji, numerals and quoted dialogue
  const f = furigana.get(id);
  if (f.text.replace(/\[([^|\]]+)\|[^\]]*\]/g, '$1') !== t) continue; // transcription out of date
  seenText.add(t);
  candidates.push({ id, text: t, ruby: f.text, reviewed: f.reviewed });
}

const engNeeded = new Set(candidates.flatMap((c) => links.get(c.id)));
const english = new Map();
for (const [id, , text] of await tsv('eng_sentences')) if (engNeeded.has(id)) english.set(id, text);

// --- Filter by vocabulary coverage --------------------------------------------
const require = createRequire(import.meta.url);
const dicPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t))),
);

const missing = new Map();
const kept = [];
for (const c of candidates) {
  const words = new Set();
  let ok = true;
  for (const tok of tokenizer.tokenize(c.text)) {
    if (tok.basic_form === '*' && tok.pos !== '記号') {
      ok = false;
      break;
    }
    // Grammar first: otherwise particles match words by sound (は → 歯, に → 二).
    // Pronouns are optional, but linked when the word list has them (私, 彼女).
    if (isFunctionToken(tok)) {
      const pronoun = tok.pos_detail_1 === '代名詞' ? lookup(tok) : undefined;
      if (pronoun !== undefined) words.add(pronoun);
      continue;
    }
    const idx = lookup(tok);
    if (idx !== undefined) {
      words.add(idx);
      continue;
    }
    missing.set(tok.basic_form, (missing.get(tok.basic_form) ?? 0) + 1);
    ok = false;
    break;
  }
  if (!ok || words.size === 0) continue;
  // Shortest English translation reads best next to a short sentence.
  const en = links
    .get(c.id)
    .map((e) => english.get(e))
    .filter(Boolean)
    .sort((a, b) => a.length - b.length)[0];
  if (!en) continue;
  const w = [...words]; // in sentence order, so the word list reads along with the sentence
  kept.push({ i: Number(c.id), r: c.ruby, e: en, w, l: Math.min(...w.map((i) => vocab[i].level)), reviewed: c.reviewed });
}

// Spread the budget across levels (a sentence's level is its hardest word), so beginners get
// enough easy material. Within a level prefer human-checked furigana, then sentences with
// at least three linked words, then older (more reviewed) Tatoeba entries.
const QUOTA = { 5: 0.3, 4: 0.3, 3: 0.4 };
const rank = (a, b) => Number(b.reviewed) - Number(a.reviewed) || Number(b.w.length >= 3) - Number(a.w.length >= 3) || a.i - b.i;
const out = [];
for (const n of [5, 4, 3]) {
  const level = kept.filter((s) => s.l === n).sort(rank);
  out.push(...level.slice(0, Math.round(MAX_SENTENCES * QUOTA[n])));
}
// Top up from any level if one ran short.
const chosen = new Set(out);
out.push(...kept.filter((s) => !chosen.has(s)).sort(rank).slice(0, MAX_SENTENCES - out.length));
for (const s of out) delete s.reviewed;
out.sort((a, b) => b.l - a.l || a.i - b.i);

await writeFile(path.join(packDir, 'sentences.json'), JSON.stringify(out));

const byLevel = [5, 4, 3].map((n) => `N${n}: ${out.filter((s) => s.l === n).length}`).join(', ');
console.log(`Candidates ${candidates.length}, readable ${kept.length}, written ${out.length} (${byLevel})`);
console.log(
  'Most common words outside the vocabulary:',
  [...missing.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([w, n]) => `${w}×${n}`)
    .join(' '),
);
