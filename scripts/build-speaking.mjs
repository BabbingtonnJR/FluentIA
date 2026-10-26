// Builds the speaking and exam practice content written for Fluentia: dialogues for role-play,
// shadowing and listening questions, quick responses (即時応答) and situations (発話表現), and
// reading passages with questions. Every line gets furigana and a word breakdown, like stories.
//
// Readings for numbers are given Aozora-style (三時《さんじ》, ｜九時《くじ》 after another kanji); the
// voice reads those spans by their reading, so 十分《じゅっぷん》 is never said じゅうぶん.
//
// Usage: node scripts/build-speaking.mjs <contentDir> <grammarSrcDir> <packDir>
//   contentDir holds speaking/dialogues.json, speaking/responses.json and reading/passages.json.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyse, createTokenizer, grammarMatchers, splitRuby, vocabLookup } from './lib/japanese.mjs';

const [contentDir, grammarDir, packDir] = process.argv.slice(2);
if (!contentDir || !grammarDir || !packDir) {
  console.error('Usage: node scripts/build-speaking.mjs <contentDir> <grammarSrcDir> <packDir>');
  process.exit(1);
}

const read = async (p) => JSON.parse(await readFile(path.join(contentDir, p), 'utf8'));
const vocab = JSON.parse(await readFile(path.join(packDir, 'vocab.json'), 'utf8'));
const lookup = vocabLookup(vocab);
const matchers = await grammarMatchers(grammarDir);
const tokenizer = await createTokenizer();

/** What the voice should read: the text with every given reading in place of its kanji. */
function spoken(marked) {
  const { plain, spans } = splitRuby(marked);
  let out = '';
  let at = 0;
  for (const s of spans) {
    out += plain.slice(at, s.start) + s.reading;
    at = s.end;
  }
  return out + plain.slice(at);
}

/** A line as the app uses it: the breakdown (furigana markup, words, grammar) and what to say. */
const line = (jp, en) => ({ s: { ...analyse(jp, tokenizer, lookup, matchers), ...(en ? { e: en } : {}) }, say: spoken(jp) });

const problems = [];
function checkQuestion(where, q) {
  if (q.options.length < 3 || q.answer < 0 || q.answer >= q.options.length) problems.push(`${where}: bad options or answer`);
  if (new Set(q.options).size !== q.options.length) problems.push(`${where}: repeated option`);
}

const dialogues = (await read('speaking/dialogues.json')).map((d) => {
  d.questions.forEach((q, i) => checkQuestion(`${d.id} q${i + 1}`, q));
  for (const [who] of d.lines) if (!d.roles[who]) problems.push(`${d.id}: no role ${who}`);
  return {
    id: d.id,
    level: d.level,
    title: d.title,
    titleEn: d.titleEn,
    situation: d.situation,
    roles: d.roles.map(([jp, en]) => ({ jp, en })),
    lines: d.lines.map(([who, jp, en]) => ({ who, ...line(jp, en) })),
    questions: d.questions.map((q) => ({ ...q, say: spoken(q.q) })),
  };
});

const responses = (await read('speaking/responses.json')).map((r) => {
  if (!!r.prompt === !!r.situation) problems.push(`${r.id}: needs a prompt or a situation`);
  if (r.bad.length < 2) problems.push(`${r.id}: needs two wrong replies`);
  return {
    id: r.id,
    level: r.level,
    kind: r.prompt ? 'reply' : 'situation',
    ...(r.prompt ? { prompt: line(r.prompt, r.en) } : { situation: r.situation }),
    good: line(r.good, r.goodEn),
    bad: r.bad.map((b) => line(b)),
  };
});

const passages = (await read('reading/passages.json')).map((p) => {
  p.questions.forEach((q, i) => checkQuestion(`${p.id} q${i + 1}`, q));
  if (p.en.length !== p.paragraphs.length) problems.push(`${p.id}: ${p.paragraphs.length} paragraphs but ${p.en.length} translations`);
  const paragraphs = p.paragraphs.map((para) => para.map((jp) => analyse(jp, tokenizer, lookup, matchers)));
  const chars = p.paragraphs.flat().reduce((n, jp) => n + splitRuby(jp).plain.length, 0);
  return { id: p.id, level: p.level, kind: p.kind, title: p.title, titleEn: p.titleEn, paragraphs, en: p.en, questions: p.questions, chars };
});

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

await writeFile(path.join(packDir, 'speaking.json'), JSON.stringify({ dialogues, responses }));
await writeFile(path.join(packDir, 'passages.json'), JSON.stringify(passages));
const count = (lv) => `N${lv}: ${dialogues.filter((d) => d.level === lv).length} dialogues, ${responses.filter((r) => r.level === lv).length} responses, ${passages.filter((p) => p.level === lv).length} passages`;
console.log([5, 4, 3].map(count).join('\n'));
