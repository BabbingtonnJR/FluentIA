// Builds examples.json for the Japanese pack: example sentences for every word card, and for
// every kanji the words that use each of its readings.
//
// - Words: Tatoeba sentences (CC BY 2.0 FR) that use the word with the right reading. Tatoeba's
//   furigana tells readings apart (十 read じゅう or とお, 〜中 read ちゅう or じゅう), so words
//   written the same way get sentences for each of their readings. Short sentences made of words
//   in the list, with human-checked furigana, are preferred.
// - Kanji: each word's reading is lined up with its kanji (十日 とおか → 十 とお + 日 か), so
//   a kanji card can show which words use which reading, and leave rare readings aside.
// - Notes: content/ja/senses.json, written for Fluentia, says when each reading of a word
//   written the same way is used; it can also give a clearer meaning and its own examples.
//
// Usage: node scripts/build-examples.mjs <rawDir> <sensesFile> <packDir>   (packDir must hold vocab.json and kanji.json)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Bunzip from 'seek-bzip';
import { createTokenizer, fixedReading, fixedToken, hasKanji, toHiragana, vocabLookup } from './lib/japanese.mjs';
import { alignReading, normReading, wordKey } from '../shared/japanese/senses.mjs';

const [rawDir, sensesFile, packDir] = process.argv.slice(2);
if (!rawDir || !sensesFile || !packDir) {
  console.error('Usage: node scripts/build-examples.mjs <rawDir> <sensesFile> <packDir>');
  process.exit(1);
}

const PER_WORD = 2;
const MIN_LEN = 4;
const MAX_LEN = 40;
const WORDS_PER_READING = 4;

async function tsv(name) {
  const buf = await readFile(path.join(rawDir, 'tatoeba', `${name}.tsv.bz2`));
  return Bunzip.decode(buf).toString('utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
}

const vocab = JSON.parse(await readFile(path.join(packDir, 'vocab.json'), 'utf8'));
const packKanji = JSON.parse(await readFile(path.join(packDir, 'kanji.json'), 'utf8'));
const allKanji = JSON.parse(await readFile(path.join(rawDir, 'kanji.json'), 'utf8'));
const senses = JSON.parse(await readFile(sensesFile, 'utf8'));
const lookup = vocabLookup(vocab);

// --- Words written the same way --------------------------------------------------
const groups = new Map();
vocab.forEach((v, i) => {
  const k = wordKey(v.word);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(i);
});
const groupOf = (i) => groups.get(wordKey(vocab[i].word));

const problems = [];
for (const id of Object.keys(senses)) if (!vocab.some((v) => v.id === id)) problems.push(`senses.json: no word ${id}`);
for (const g of groups.values()) {
  if (g.length < 2) continue;
  for (const i of g) if (!senses[vocab[i].id]?.note) problems.push(`senses.json: ${vocab[i].id} needs a note (written like ${g.map((j) => vocab[j].id).join(', ')})`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

// --- Tatoeba ---------------------------------------------------------------------
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
  if (/[A-Za-zＡ-Ｚａ-ｚ0-9０-９「」『』]/.test(t)) continue;
  const f = furigana.get(id);
  if (f.text.replace(/\[([^|\]]+)\|[^\]]*\]/g, '$1') !== t) continue;
  seenText.add(t);
  candidates.push({ id, text: t, ruby: f.text, reviewed: f.reviewed });
}
const engNeeded = new Set(candidates.flatMap((c) => links.get(c.id)));
const english = new Map();
for (const [id, , text] of await tsv('eng_sentences')) if (engNeeded.has(id)) english.set(id, text);

/** Readings by character span from Tatoeba's markup: [start, end, reading]. */
function rubySpans(markup) {
  const spans = [];
  const re = /\[([^|\]]+)\|([^\]]*)\]/g;
  let pos = 0;
  let last = 0;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    pos += m.index - last;
    const base = [...m[1]];
    const readings = m[2].split('|');
    if (readings.length === base.length && readings.length > 1) {
      base.forEach((c, i) => spans.push([pos + i, pos + i + c.length, readings[i]]));
    } else spans.push([pos, pos + m[1].length, readings.join('')]);
    pos += m[1].length;
    last = re.lastIndex;
  }
  return spans;
}

/** The reading of plain[start, end) from the markup, or null when a reading runs across its edges. */
function spanReading(plain, spans, start, end) {
  let out = '';
  for (let p = start; p < end; ) {
    const s = spans.find(([a, b]) => a <= p && p < b);
    if (!s) {
      out += toHiragana(plain[p]);
      p++;
      continue;
    }
    if (s[0] < start || s[1] > end) return null;
    out += toHiragana(s[2]);
    p = s[1];
  }
  return out;
}

const commonPrefix = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** Which entry of the word's group the token is, judged by its reading. */
function pickEntry(idx, reading, isSuffix) {
  const group = groupOf(idx);
  if (!hasKanji(vocab[idx].word)) return idx;
  if (!reading) return undefined;
  let best;
  let bestScore = 0;
  for (const i of group) {
    const r = normReading(vocab[i].reading);
    // Inflected words share their stem with the dictionary form: 辛く → からい.
    const shared = commonPrefix(r, reading);
    const score = r === reading ? 100 : shared >= Math.max(1, Math.min(2, r.length - 1)) ? shared : 0;
    const bonus = /^[～〜]/.test(vocab[i].word) === isSuffix ? 0.5 : 0;
    if (score && score + bonus > bestScore) {
      best = i;
      bestScore = score + bonus;
    }
  }
  return best;
}

const compounds = new Set(vocab.map((v) => wordKey(v.word)).filter((w) => hasKanji(w) && [...w].length > 1));
/** Whether text[start, end) is part of a longer word from the list. */
function inLongerWord(text, start, end) {
  for (let a = Math.max(0, start - 3); a <= start; a++) {
    for (let b = end; b <= Math.min(text.length, end + 3); b++) {
      if (b - a > end - start && compounds.has(text.slice(a, b))) return true;
    }
  }
  return false;
}

const tokenizer = await createTokenizer();
const SKIP_POS = new Set(['助詞', '助動詞', '記号', 'フィラー']);
/** Per word: the best few candidate sentences as { c, score }, lowest score first. */
const found = new Map();
const keep = (i, c, score) => {
  if (!found.has(i)) found.set(i, []);
  const list = found.get(i);
  list.push({ c, score });
  list.sort((a, b) => a.score - b.score);
  if (list.length > 8) list.pop();
};

let processed = 0;
for (const c of candidates) {
  const spans = rubySpans(c.ruby);
  let pos = 0;
  const hits = [];
  let unknown = 0;
  for (const raw of tokenizer.tokenize(c.text)) {
    const start = pos;
    pos += raw.surface_form.length;
    if (SKIP_POS.has(raw.pos)) continue;
    const tok = fixedToken(raw, c.text);
    const idx = lookup(tok);
    if (idx === undefined) {
      if (!['非自立', '数', '固有名詞', '代名詞'].includes(raw.pos_detail_1)) unknown++;
      continue;
    }
    // 十 split out of 十分 (enough) shows 十 badly; that sentence is 十分's.
    if (inLongerWord(c.text, start, pos)) continue;
    const given = spanReading(c.text, spans, start, pos);
    const reading = given ?? (raw.reading ? toHiragana(fixedReading(raw, c.text)) : null);
    const entry = pickEntry(idx, reading, raw.pos_detail_1 === '接尾');
    if (entry === undefined) continue;
    const word = wordKey(vocab[entry].word);
    // A one-kanji word written in kana is too often another word: うわ (oh!) is not 上, かみ may be 紙 or 神.
    if ([...word].length === 1 && hasKanji(word) && !hasKanji(tok.surface_form ?? raw.surface_form)) continue;
    if (raw.pos === '感動詞' && hasKanji(word)) continue;
    // Telling readings of the same written word apart needs furigana someone checked.
    if (groupOf(entry).length > 1 && (!c.reviewed || given === null)) continue;
    hits.push(entry);
  }
  c.score = unknownPenalty(unknown, c);
  c.spans = spans;
  for (const i of new Set(hits)) keep(i, c, c.score);
  if (++processed % 50000 === 0) console.log(`  ${processed} / ${candidates.length} sentences`);
}

const NUMBER = /[〇一二三四五六七八九十百千万何数半毎両]/;

// Words the tokenizer splits (誕生日, 十日) or suffixes (〜回, 〜枚) and particles (〜だけ) aren't
// found by token; look for their written form with the right reading instead.
for (const [i, v] of vocab.entries()) {
  if (found.get(i)?.length >= PER_WORD) continue;
  const word = wordKey(v.word);
  const reading = normReading(v.reading);
  const kanaOnly = !hasKanji(word);
  if (kanaOnly && [...word].length < 2) continue;
  // Suffixes follow a number or a word, so they never start a sentence.
  const suffix = /^[～〜]/.test(v.word);
  for (const c of candidates) {
    let at = c.text.indexOf(word);
    while (at >= 0) {
      // Counters follow a number (三回), not any word (迂回).
      const after = at > 0 && (!hasKanji(word) || NUMBER.test(c.text[at - 1]));
      const ok =
        (!suffix || after) &&
        (kanaOnly || spanReading(c.text, c.spans, at, at + word.length) === reading) &&
        (groupOf(i).length < 2 || c.reviewed);
      if (ok) {
        keep(i, c, c.score + 4);
        break;
      }
      at = c.text.indexOf(word, at + 1);
    }
    if (found.get(i)?.length >= 8) break;
  }
}

function unknownPenalty(unknown, c) {
  const len = [...c.text].length;
  return unknown * 8 + len + (len < 7 ? 6 : 0) + (c.reviewed ? 0 : 6);
}

const shortestEnglish = (c) =>
  links
    .get(c.id)
    .map((e) => english.get(e))
    .filter(Boolean)
    .sort((a, b) => a.length - b.length)[0];

// --- Words: sentences and notes ------------------------------------------------------
const words = {};
for (const g of groups.values()) {
  // Each reading of a word gets its own sentences.
  const usedInGroup = new Set();
  for (const i of g) {
    const s = senses[vocab[i].id];
    const ex = (s?.examples ?? []).map(([r, e]) => [r, e]);
    for (const { c } of found.get(i) ?? []) {
      if (ex.length >= PER_WORD) break;
      if (usedInGroup.has(c.id)) continue;
      const en = shortestEnglish(c);
      if (!en) continue;
      ex.push([c.ruby, en, Number(c.id)]);
      usedInGroup.add(c.id);
    }
    const entry = {};
    if (ex.length) entry.x = ex;
    if (s?.meaning) entry.m = s.meaning;
    if (s?.note) entry.n = s.note;
    if (Object.keys(entry).length) words[i] = entry;
  }
}

// --- Kanji: words per reading -----------------------------------------------------------
const readingsOf = (c) => {
  const k = allKanji[c];
  if (!k) return [];
  return [...(k.readings_on ?? []).map((r) => ({ r: toHiragana(r), on: true })), ...(k.readings_kun ?? []).map((r) => ({ r, on: false }))];
};
const byKanjiReading = new Map();
vocab.forEach((v, i) => {
  const word = wordKey(v.word);
  if (!hasKanji(word)) return;
  const parts = alignReading(word, normReading(v.reading), (c) => readingsOf(c).map((x) => x.r));
  if (!parts) return;
  for (const p of parts) {
    const key = `${p.kanji}|${p.reading}`;
    if (!byKanjiReading.has(key)) byKanjiReading.set(key, []);
    byKanjiReading.get(key).push(i);
  }
});
const toKatakana = (s) => s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
const kanji = {};
let withWords = 0;
for (const k of packKanji) {
  const readings = [];
  const rare = [];
  const seen = new Set();
  for (const { r, on } of readingsOf(k.id)) {
    // Words are lined up by the part the kanji itself reads: う.まれる, う.む → う.
    const [stem, okurigana] = r.replace(/-/g, '').split('.');
    if (seen.has(stem)) continue;
    seen.add(stem);
    const ws = [...new Set(byKanjiReading.get(`${k.id}|${stem}`) ?? [])]
      // The kanji on its own first, then easiest, then the shortest words, which show the reading most plainly.
      .sort(
        (a, b) =>
          Number(wordKey(vocab[b].word) === k.id) - Number(wordKey(vocab[a].word) === k.id) ||
          vocab[b].level - vocab[a].level ||
          wordKey(vocab[a].word).length - wordKey(vocab[b].word).length ||
          a - b,
      )
      .filter((i, n, arr) => arr.findIndex((j) => wordKey(vocab[j].word) === wordKey(vocab[i].word)) === n)
      .slice(0, WORDS_PER_READING);
    const shown = on ? toKatakana(stem) : okurigana ? `${stem}(${okurigana})` : stem;
    if (ws.length) readings.push([shown, ws]);
    else rare.push(shown);
  }
  if (readings.length) withWords++;
  kanji[k.id] = rare.length ? { r: readings, rare } : { r: readings };
}

await writeFile(path.join(packDir, 'examples.json'), JSON.stringify({ words, kanji }));

const missing = vocab.filter((_, i) => !words[i]?.x?.length);
console.log(`Words with example sentences: ${vocab.length - missing.length} / ${vocab.length}`);
console.log(`Kanji with words for a reading: ${withWords} / ${packKanji.length}`);
console.log(`Words without a sentence (${missing.length}): ${missing.slice(0, 80).map((v) => v.id).join('  ')}`);
