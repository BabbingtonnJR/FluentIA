// Builds the reading sentences for the Japanese pack from Tatoeba (CC BY 2.0 FR).
// Keeps only sentences whose every content word is in the pack's N5–N3 vocabulary,
// so each one is readable with what the app teaches, and links those words to vocab
// entries so the app can pick sentences made of words the learner already studied.
//
// Usage: node scripts/build-sentences.mjs <rawDir> <packDir>
//   rawDir/tatoeba/*.tsv.bz2 come from fetch-content.mjs; packDir must already hold vocab.json.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Bunzip from 'seek-bzip';
import { createTokenizer, isFunctionToken, vocabLookup } from './lib/japanese.mjs';

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

// --- Vocabulary lookup ---------------------------------------------------------
const vocab = JSON.parse(await readFile(path.join(packDir, 'vocab.json'), 'utf8'));
const lookup = vocabLookup(vocab);

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
const tokenizer = await createTokenizer();

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
