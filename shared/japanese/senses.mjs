// Words written the same way with different readings (十 じゅう / とお, 〜中 ちゅう / じゅう) are
// studied as one card, and a word's reading is lined up with its kanji so a kanji card can show
// which words use which reading. Shared by the build scripts (Node) and the app (browser).

const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const isHan = (c) => /\p{Script=Han}/u.test(c);

/** The written form that groups entries: 〜中 and 中 are one card, as are 十 じゅう and 十 とお. */
export function wordKey(word) {
  return word.split(/[;；]/)[0].replace(/[～〜~]/g, '').trim();
}

/** A reading as hiragana without the list's decorations: "(〜を) とお" → "とお", "～ちゅう" → "ちゅう". */
export function normReading(reading) {
  return kata2hira(
    reading
      .split(/[;；、,]/)[0]
      .replace(/[(（][^)）]*[)）]/g, '')
      .replace(/[～〜~\s.\-]/g, ''),
  );
}

const VOICED = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
const HALF = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };

/** How a kanji reading can sound inside a word: voiced (はし → ばし), cut short (いち → いっ). */
function soundings(reading) {
  const out = new Set([reading]);
  const first = reading[0];
  const rest = reading.slice(1);
  if (VOICED[first]) out.add(VOICED[first] + rest);
  if (HALF[first]) out.add(HALF[first] + rest);
  if (first === 'ち') out.add('じ' + rest);
  if (first === 'つ') out.add('ず' + rest);
  for (const r of [...out]) if (r.length > 1 && /[つちくきぢ]$/.test(r)) out.add(r.slice(0, -1) + 'っ');
  return [...out];
}

/**
 * Lines a word's reading up with its kanji: alignReading('十日', 'とおか', readings) gives
 * [{ kanji: '十', reading: 'とお' }, { kanji: '日', reading: 'か' }], naming each kanji's
 * dictionary reading (kun readings without their okurigana). Null when the word is read as a
 * whole (今日 きょう) or a reading isn't listed.
 * `readings(kanji)` lists a kanji's readings: on in hiragana, kun as in KANJIDIC (ひと.つ, -や).
 */
export function alignReading(word, reading, readings) {
  const chars = [...word];
  const target = kata2hira(reading);
  const options = chars.map((c, i) => {
    const k = c === '々' && i > 0 ? chars[i - 1] : c;
    if (!isHan(k)) return null;
    const list = [];
    for (const r of readings(k)) {
      const stem = kata2hira(r.split('.')[0].replace(/-/g, ''));
      if (stem) for (const s of soundings(stem)) list.push({ said: s, reading: stem });
    }
    // Longest first, so じゅう is tried before じゅ.
    return { kanji: k, list: list.sort((a, b) => b.said.length - a.said.length) };
  });
  const walk = (i, j) => {
    if (i === chars.length) return j === target.length ? [] : null;
    const opt = options[i];
    if (!opt) {
      const c = kata2hira(chars[i]);
      return target.startsWith(c, j) ? walk(i + 1, j + c.length) : null;
    }
    for (const { said, reading: r } of opt.list) {
      if (!target.startsWith(said, j)) continue;
      const rest = walk(i + 1, j + said.length);
      if (rest) return [{ kanji: opt.kanji, reading: r }, ...rest];
    }
    return null;
  };
  return walk(0, 0);
}
