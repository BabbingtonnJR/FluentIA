/**
 * Romaji → hiragana, for searching. Accepts Hepburn (shi, chi, tsu, fu, ja), Kunrei and
 * IME-style spellings (si, ti, tu, hu, zi, xtu), doubled consonants (kitte → きって),
 * n / nn / n' for ん, macrons (tōkyō → とうきょう) and "-" for ー.
 */
const TABLE: Record<string, string> = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', dzu: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  la: 'ら', li: 'り', lu: 'る', le: 'れ', lo: 'ろ',
  wa: 'わ', wo: 'を',
  va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  she: 'しぇ', je: 'じぇ', che: 'ちぇ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ', xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ', xtu: 'っ', xtsu: 'っ',
  '-': 'ー',
};

// Contracted sounds: kya/kyu/kyo, sya/sha, tya/cha, zya/jya/ja, …
const SMALL: Record<string, string> = { a: 'ゃ', u: 'ゅ', o: 'ょ' };
const Y_ROWS: Record<string, string> = {
  ky: 'き', gy: 'ぎ', sy: 'し', zy: 'じ', ty: 'ち', cy: 'ち', dy: 'ぢ', ny: 'に', hy: 'ひ', by: 'び', py: 'ぴ', my: 'み', ry: 'り', jy: 'じ',
  sh: 'し', ch: 'ち', j: 'じ',
};
for (const [c, kana] of Object.entries(Y_ROWS)) {
  for (const [v, small] of Object.entries(SMALL)) TABLE[c + v] = kana + small;
}

const MACRONS: Record<string, string> = { ā: 'aa', ī: 'ii', ū: 'uu', ē: 'ei', ō: 'ou', â: 'aa', î: 'ii', û: 'uu', ê: 'ei', ô: 'ou' };
const CONSONANT = /[bcdfghjklmnpqrstvwxyz]/;

/** Converts as much as possible; letters that don't form a syllable stay as they are. */
export function romajiToHiragana(input: string): string {
  const s = input.toLowerCase().replace(/[āīūēōâîûêô]/g, (m) => MACRONS[m]);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (c === 'n') {
      // n' is ん; nn is ん, and the second n starts the next syllable if a vowel follows
      // (onna → おんな, konnichiwa → こんにちわ), otherwise it is swallowed (honn → ほん).
      if (next === "'" || (next === 'n' && !/[aiueoy]/.test(s[i + 2] ?? ''))) {
        out += 'ん';
        i += 2;
        continue;
      }
      // n at the end or before a consonant other than y is ん.
      if (next === undefined || (CONSONANT.test(next) && next !== 'y')) {
        out += 'ん';
        i += 1;
        continue;
      }
    }
    // Hepburn writes ん as m before b, p and m (shimbun, sempai).
    if (c === 'm' && next !== undefined && /[bp]/.test(next)) {
      out += 'ん';
      i += 1;
      continue;
    }
    // Doubled consonant → っ (kk, tt, ss, pp…, and tch as in matcha)
    if (CONSONANT.test(c) && (next === c || (c === 't' && next === 'c'))) {
      out += 'っ';
      i += 1;
      continue;
    }
    let matched = false;
    for (let len = 3; len > 0; len--) {
      const kana = TABLE[s.slice(i, i + len)];
      if (kana) {
        out += kana;
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += c;
      i += 1;
    }
  }
  return out;
}

export const isLatin = (s: string) => /^[a-zāīūēōâîûêô' -]+$/i.test(s);

/** Katakana → hiragana, so readings in either script compare equal. */
export const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * The kana form of a search query, or null if it has none. A latin query is read as romaji, and a
 * half-typed final syllable ("mats") is dropped so results show up while typing; `partial` says so,
 * since such a query may just as well be English ("wait" is not わい).
 */
export function kanaQuery(query: string): { kana: string; partial: boolean } | null {
  const q = query.trim();
  if (!q) return null;
  if (!isLatin(q)) return { kana: toHiragana(q), partial: false };
  const full = romajiToHiragana(q.replace(/\s+/g, ''));
  const kana = full.replace(/[a-z']+$/, '');
  return kana && !/[a-z]/.test(kana) ? { kana, partial: kana !== full } : null;
}

/** 0 = exact, 1 = starts with, 2 = contains, -1 = no match. */
export function matchRank(text: string, query: string): number {
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  return text.includes(query) ? 2 : -1;
}
