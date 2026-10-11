import type { GrammarPoint, KanjiItem, VocabItem } from '../content/types';
import { kanaQuery, matchRank, toHiragana } from './romaji';

/** The better of several match ranks (lower is better, -1 is no match). */
export function best(...ranks: number[]): number {
  return ranks.reduce((b, r) => (r >= 0 && (b < 0 || r < b) ? r : b), -1);
}

/** English glosses: a whole word or phrase between separators beats a substring. */
export function englishRank(meaning: string, q: string): number {
  const m = meaning.toLowerCase();
  if (!m.includes(q)) return -1;
  const parts = m.split(/[;,()]/).map((p) => p.trim().replace(/^to /, ''));
  if (parts.includes(q) || parts.includes(q.replace(/^to /, ''))) return 0;
  return new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(m) ? 1 : 2;
}

export const readingsOf = (reading: string) => reading.split(/[;、,]/).map((r) => toHiragana(r.replace(/[～~\s]/g, '')));

/** Filters to matches and orders them best match first, keeping list order within a rank. */
export function rankBy<T>(items: T[], q: string, rank: (t: T) => number): T[] {
  if (!q) return items;
  return items
    .map((t, i) => ({ t, i, r: rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

/**
 * Rankers for one search query over words, kanji and grammar. Romaji is also searched as kana
 * ("matsu" → まつ, "youni" → ように); a half-typed romaji match ranks after English ones.
 */
export function searcher(query: string) {
  const q = query.trim().toLowerCase();
  const kq = kanaQuery(q);
  const kanaRank = (texts: string[]) => {
    if (!kq) return -1;
    const r = best(...texts.map((t) => matchRank(t, kq.kana)));
    return r >= 0 && kq.partial ? r + 3 : r;
  };
  // Grammar patterns read as kana: 〜ように (as) → ように; their kanji stay as written.
  const patternKana = (g: GrammarPoint) =>
    g.pattern
      .split(/[/／]/)
      .map((p) => toHiragana(p.replace(/\(.*?\)|（.*?）|[〜~\s]/g, '')))
      .filter(Boolean);
  const english = (meaning: string) => {
    const r = englishRank(meaning, q);
    return r >= 0 ? r + 1 : -1;
  };
  return {
    q,
    vocab: (v: VocabItem) => best(matchRank(v.word, q), kanaRank(readingsOf(v.reading)), englishRank(v.meaning, q)),
    kanji: (k: KanjiItem) =>
      best(k.id === q ? 0 : -1, kanaRank([...k.on, ...k.kun].map((r) => toHiragana(r.replace(/[.-]/g, '')))), englishRank(k.meanings.join('; '), q)),
    grammar: (g: GrammarPoint) =>
      best(
        g.pattern.includes(q) ? 0 : -1,
        kanaRank(patternKana(g)),
        // The romaji id (n4-youni) and the formation lines (Noun + のように) find it too.
        q && g.id.slice(3).replace(/-/g, '').includes(q.replace(/[\s-]/g, '')) ? 1 : -1,
        kq && g.formation.some((f) => toHiragana(f).includes(kq.kana)) ? 3 : -1,
        english(g.meaning),
      ),
  };
}
