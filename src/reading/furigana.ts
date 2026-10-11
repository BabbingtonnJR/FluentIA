/** A run of text, with the reading to show above it when it contains kanji. */
export interface RubySegment {
  text: string;
  ruby?: string;
}

/**
 * Parses Tatoeba's furigana markup: `[場所|ば|しょ]は[今日|きょう]` gives one reading per
 * kanji when the counts match (場→ば, 所→しょ), otherwise one reading for the whole word.
 */
export function parseRuby(markup: string): RubySegment[] {
  const out: RubySegment[] = [];
  const re = /\[([^|\]]+)\|([^\]]*)\]/g;
  let last = 0;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    if (m.index > last) out.push({ text: markup.slice(last, m.index) });
    const base = [...m[1]];
    const readings = m[2].split('|');
    if (readings.length === base.length && readings.length > 1) {
      base.forEach((c, i) => out.push(readings[i] ? { text: c, ruby: readings[i] } : { text: c }));
    } else {
      out.push({ text: m[1], ruby: readings.join('') });
    }
    last = re.lastIndex;
  }
  if (last < markup.length) out.push({ text: markup.slice(last) });
  return out;
}

/** The sentence as written, without readings. */
export function plainText(markup: string): string {
  return markup.replace(/\[([^|\]]+)\|[^\]]*\]/g, '$1');
}

export type FuriganaMode = 'all' | 'unknown' | 'none';

export const FURIGANA_LABEL: Record<FuriganaMode, string> = { all: 'All', unknown: 'New kanji', none: 'Off' };

const KANJI = /\p{Script=Han}/gu;

/** Whether to show a segment's reading: always, never, or only over kanji not studied yet. */
export function showRuby(seg: RubySegment, mode: FuriganaMode, knownKanji: ReadonlySet<string>): boolean {
  if (!seg.ruby || mode === 'none') return false;
  if (mode === 'all') return true;
  return (seg.text.match(KANJI) ?? []).some((c) => !knownKanji.has(c));
}

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const isHan = (c: string) => /\p{Script=Han}/u.test(c);

/** Markup for one word and its whole reading, with kana outside the kanji left bare (知ら, しら → [知|し]ら). */
export function wordMarkup(surface: string, reading: string): string {
  const s = [...surface];
  const r = [...toHira(reading)];
  let head = '';
  let tail = '';
  while (s.length > 1 && r.length > 1 && !isHan(s[s.length - 1]) && toHira(s[s.length - 1]) === r[r.length - 1]) {
    tail = s.pop() + tail;
    r.pop();
  }
  while (s.length > 1 && r.length > 1 && !isHan(s[0]) && toHira(s[0]) === r[0]) {
    head += s.shift();
    r.shift();
  }
  return `${head}[${s.join('')}|${r.join('')}]${tail}`;
}
